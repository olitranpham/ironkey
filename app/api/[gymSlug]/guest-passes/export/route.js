import prisma from '@/lib/prisma'
import { NextResponse } from 'next/server'
import { requirePermission, can } from '@/lib/permissions'
import { latest, archivePredicate } from '@/lib/guestPassArchive'
import { monthKey, DEFAULT_GYM_TIME_ZONE } from '@/lib/etMonth'
import { toCsv } from '@/lib/csv'

// Export dates are always Boston time, YYYY-MM-DD
const EXPORT_TIME_ZONE = 'America/New_York'

const PASS_TYPES = new Set(['SINGLE', 'THREE_PACK', 'FIVE_PACK', 'TEN_PACK', 'VALUE', 'DELUXE'])

function day(date) {
  return date ? new Date(date).toLocaleDateString('en-CA', { timeZone: EXPORT_TIME_ZONE }) : ''
}

function normName(s) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * GET /api/[gymSlug]/guest-passes/export?archived=&search=&type=&month=
 * CSV of the guest passes page's current view, one row per pass.
 *
 * - archived=true → archived guests, else active (same 6-month rule as the
 *   list). A search spans both lists, as it does on the page.
 * - search: guest name or email contains it (case-insensitive)
 * - type: a PassType (the page's pass-type tab)
 * - month: 'YYYY-MM' purchase month in the gym's timezone (the month filter)
 *
 * Same permission as the page (guestpasses.manage). The amount paid column is
 * only included for users with billing.view.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'guestpasses.manage')
    if (errorResponse) return errorResponse

    const url      = new URL(request.url)
    const archived = url.searchParams.get('archived') === 'true'
    const search   = (url.searchParams.get('search') ?? '').trim().toLowerCase()
    const type     = url.searchParams.get('type')
    const month    = url.searchParams.get('month') ?? ''
    if (type && !PASS_TYPES.has(type))           return NextResponse.json({ error: 'invalid type' }, { status: 400 })
    if (month && !/^\d{4}-\d{2}$/.test(month))   return NextResponse.json({ error: 'invalid month' }, { status: 400 })

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true, timezone: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    const gymTimeZone = gym.timezone || DEFAULT_GYM_TIME_ZONE
    const withAmount  = can(ctx.user, 'billing.view')

    const [passes, checkIns, waivers] = await Promise.all([
      prisma.guestVisit.findMany({
        where:  { gymId: gym.id },
        select: {
          id: true, guestProfileId: true, guestName: true, guestEmail: true, guestPhone: true,
          passType: true, passesLeft: true, usedAt: true, expiresAt: true, createdAt: true,
          amountPaid: true,
          guestProfile: { select: { name: true, email: true, phone: true, isMinor: true, guardianName: true } },
        },
      }),
      prisma.guestCheckIn.findMany({ where: { gymId: gym.id }, select: { guestProfileId: true, createdAt: true } }),
      prisma.guestWaiver.findMany({ where: { gymId: gym.id }, select: { guestProfileId: true, signedAt: true } }),
    ])
    const waiverByProfile = new Map(waivers.map(w => [w.guestProfileId, w.signedAt]))

    // Archive state — per profile (all its passes + check-ins here), or per
    // unlinked pass on its own dates, exactly as the list does
    const isArchived  = archivePredicate()
    const profileLast = new Map()
    for (const p of passes) {
      if (p.guestProfileId) profileLast.set(p.guestProfileId, latest(profileLast.get(p.guestProfileId), p.createdAt, p.usedAt))
    }
    for (const c of checkIns) {
      if (c.guestProfileId && profileLast.has(c.guestProfileId)) {
        profileLast.set(c.guestProfileId, latest(profileLast.get(c.guestProfileId), c.createdAt))
      }
    }
    const passArchived = p => isArchived(p.guestProfileId ? profileLast.get(p.guestProfileId) : latest(p.createdAt, p.usedAt))

    // First time = this guest's earliest pass at this gym (by profile, else email, else name)
    const guestKey = p => p.guestProfileId
      ?? (p.guestEmail ? `email:${p.guestEmail.toLowerCase()}` : `name:${normName(p.guestName)}`)
    const firstPassByGuest = new Map()
    for (const p of passes) {
      const k = guestKey(p), first = firstPassByGuest.get(k)
      if (!first || p.createdAt < first.createdAt) firstPassByGuest.set(k, p)
    }

    const rows = passes
      .map(p => ({
        ...p,
        name:  p.guestProfile?.name  || p.guestName || '',
        email: p.guestProfile?.email || p.guestEmail || '',
        phone: p.guestProfile?.phone || p.guestPhone || '',
      }))
      // A search spans active and archived, as on the page
      .filter(p => search ? `${p.name} ${p.email}`.toLowerCase().includes(search) : passArchived(p) === archived)
      .filter(p => !type  || p.passType === type)
      .filter(p => !month || monthKey(p.createdAt, gymTimeZone) === month)
      .sort((a, b) => b.createdAt - a.createdAt)

    const header = [
      'guest name', 'email', 'phone', 'pass type', 'passes left', 'purchased', 'expires', 'last visit',
      'first time', 'waiver signed', 'waiver date', 'is minor', 'guardian name',
      ...(withAmount ? ['amount paid'] : []),
    ]
    const body = rows.map(p => {
      const signedAt = p.guestProfileId ? waiverByProfile.get(p.guestProfileId) : null
      return [
        p.name,
        p.email,
        p.phone,
        p.passType.toLowerCase().replace(/_/g, '-'),
        p.passesLeft ?? '',
        day(p.createdAt),
        day(p.expiresAt),
        day(p.usedAt),
        firstPassByGuest.get(guestKey(p))?.id === p.id ? 'y' : 'n',
        signedAt ? 'y' : 'n',
        day(signedAt),
        p.guestProfile?.isMinor ? 'y' : 'n',
        p.guestProfile?.isMinor ? (p.guestProfile.guardianName ?? '') : '',
        ...(withAmount ? [p.amountPaid != null ? (p.amountPaid / 100).toFixed(2) : ''] : []),
      ]
    })

    const view     = search ? 'search' : (archived ? 'archived' : 'active')
    const filename = `${gymSlug}-guest-passes-${view}-${day(new Date())}.csv`
    console.log('[guest-passes export] gym=%s view=%s rows=%d amount=%s', gymSlug, view, body.length, withAmount)

    return new NextResponse(toCsv([header, ...body]), {
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (error) {
    console.error('[guest-passes export]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
