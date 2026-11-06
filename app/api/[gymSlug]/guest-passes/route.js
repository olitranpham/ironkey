import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { authorizeIntake } from '@/lib/webhookAuth'
import { intakeGuestPass } from '@/lib/guestPassIntake'
import { DEFAULT_GYM_TIME_ZONE } from '@/lib/etMonth'
import { guestPassMetrics } from '@/lib/guestPassMetrics'

/**
 * POST /api/[gymSlug]/guest-passes
 * Called by Zapier when a guest purchases a pass.
 * Body: { name, email?, phone?, passType?, passesLeft?, accessCode? }
 *
 * Auth: a staff JWT with door.manage, OR x-webhook-secret = WEBHOOK_SECRET (Zapier).
 * Unauthenticated calls are rejected when WEBHOOK_ENFORCE=true, otherwise allowed with a warning.
 * See lib/guestPassIntake.js for the access-code logic.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const auth = await authorizeIntake(request, gymSlug, 'door.manage', 'POST /api/[gymSlug]/guest-passes')
    if (auth.errorResponse) return auth.errorResponse

    // Stripe fields are set only by the platform webhook, never by Zapier
    const { stripeSessionId, stripePriceId, packSize, amountPaid, ...body } = await request.json()
    const { status, json } = await intakeGuestPass(gymSlug, body)
    return NextResponse.json(json, { status })
  } catch (error) {
    console.error('[guest-passes POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// A guest (or unlinked pass) is archived for a gym when its most recent
// activity there is older than this. Computed per request — never stored —
// so a returning guest is back in the active list on their next purchase or
// check-in.
const ARCHIVE_AFTER_MONTHS = 6

/** Latest of the given dates (Date | null), or null. */
function latest(...dates) {
  let max = null
  for (const d of dates) if (d && (!max || d > max)) max = d
  return max
}

/**
 * GET /api/[gymSlug]/guest-passes[?archived=true]
 * Returns guest profiles with their full pass history, plus purchase metrics
 * per month (see lib/guestPassMetrics). Active guests by default; archived=true
 * returns the archived ones instead. archivedCount is always included.
 *
 * Most recent activity at this gym = latest of each pass's createdAt
 * (purchase) and usedAt (last check-in), and GuestCheckIn.createdAt.
 *
 * Student ID images are not included (they made this response hundreds of
 * MB) — passes carry hasStudentId, and GET /guest-passes/[passId] returns
 * the image.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { errorResponse } = await requirePermission(request, gymSlug, 'guestpasses.manage')
    if (errorResponse) return errorResponse

    const archived = new URL(request.url).searchParams.get('archived') === 'true'

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, timezone: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }
    const gymId    = gym.id
    const timeZone = gym.timezone || DEFAULT_GYM_TIME_ZONE

    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - ARCHIVE_AFTER_MONTHS)
    const isArchived = lastActivity => !lastActivity || lastActivity < cutoff

    // ── Fetch all pass records for this gym upfront ─────────────────────────────
    // We deliberately avoid using the nested `passes` relation on Guest, because
    // Guest is a global (cross-gym) model and the nested where: { gymId } filter
    // can return records from other gyms in some Prisma versions. Instead we query
    // GuestVisit directly with an explicit gymId filter, then attach manually.

    const [allLinkedPasses, studentIdPasses, checkIns] = await Promise.all([
      prisma.guestVisit.findMany({
        where:   { gymId, guestProfileId: { not: null } },
        orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
        select: {
          id:             true,
          guestProfileId: true,
          passType:       true,
          passesLeft:     true,
          usedAt:         true,
          expiresAt:      true,
          createdAt:      true,
        },
      }),
      // IS NOT NULL only — the image itself is never read here
      prisma.guestVisit.findMany({
        where:  { gymId, studentIdImage: { not: null } },
        select: { id: true },
      }),
      prisma.guestCheckIn.findMany({
        where:  { gymId },
        select: { createdAt: true, guestProfileId: true },
      }),
    ])
    const hasStudentId = new Set(studentIdPasses.map(p => p.id))

    // Build a map of profileId → passes (already gym-scoped), and each
    // profile's most recent activity here
    const passesByProfileId = new Map()
    const lastActivityById  = new Map()
    for (const pass of allLinkedPasses) {
      const pid = pass.guestProfileId
      if (!passesByProfileId.has(pid)) passesByProfileId.set(pid, [])
      passesByProfileId.get(pid).push({
        id:           pass.id,
        passType:     pass.passType,
        passesLeft:   pass.passesLeft,
        usedAt:       pass.usedAt,
        expiresAt:    pass.expiresAt,
        createdAt:    pass.createdAt,
        hasStudentId: hasStudentId.has(pass.id),
      })
      lastActivityById.set(pid, latest(lastActivityById.get(pid), pass.createdAt, pass.usedAt))
    }
    for (const checkIn of checkIns) {
      if (checkIn.guestProfileId && lastActivityById.has(checkIn.guestProfileId)) {
        lastActivityById.set(checkIn.guestProfileId, latest(lastActivityById.get(checkIn.guestProfileId), checkIn.createdAt))
      }
    }

    const allProfileIds = [...passesByProfileId.keys()]
    const profileIds    = allProfileIds.filter(id => isArchived(lastActivityById.get(id)) === archived)

    const profileRecords = await prisma.guest.findMany({
      where:   { id: { in: profileIds } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id:         true,
        name:       true,
        email:      true,
        phone:      true,
        accessCode: true,
        dateOfBirth:                  true,
        address:                      true,
        emergencyContactName:         true,
        emergencyContactPhone:        true,
        emergencyContactRelationship: true,
        isMinor:              true,
        guardianName:         true,
        guardianEmail:        true,
        guardianPhone:        true,
        guardianRelationship: true,
      },
    })

    const profiles = profileRecords.map(p => ({
      ...p,
      passes: passesByProfileId.get(p.id) ?? [],
    }))

    // Also fetch unlinked passes (no profile / no email)
    const allUnlinked = await prisma.guestVisit.findMany({
      where: {
        gymId,
        guestProfileId: null,
      },
      orderBy: [
        { usedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      select: {
        id:         true,
        guestName:  true,
        guestEmail: true,
        guestPhone: true,
        passType:   true,
        passesLeft: true,
        usedAt:     true,
        expiresAt:  true,
        createdAt:  true,
      },
    })

    // An unlinked pass has no profile, so its own dates are its activity
    const unlinkedArchived = p => isArchived(latest(p.createdAt, p.usedAt))
    const unlinked         = allUnlinked.filter(p => unlinkedArchived(p) === archived)

    const archivedCount = allProfileIds.filter(id => isArchived(lastActivityById.get(id))).length
      + allUnlinked.filter(unlinkedArchived).length

    // Authoritative counts (all passes, archived included) — single DB query,
    // not derived from in-memory arrays
    const [totalCount, typeRows, metricPasses] = await Promise.all([
      prisma.guestVisit.count({ where: { gymId } }),
      prisma.guestVisit.groupBy({
        by:    ['passType'],
        where: { gymId },
        _count: { passType: true },
      }),
      prisma.guestVisit.findMany({
        where:  { gymId },
        select: { createdAt: true, passType: true, packSize: true, amountPaid: true },
      }),
    ])
    // Per purchase month (gym timezone) and `all`
    const metrics = guestPassMetrics(metricPasses, checkIns, timeZone)

    const countByType = Object.fromEntries(
      typeRows.map(r => [r.passType, r._count.passType])
    )

    console.log(`[guest-passes GET] ${archived ? 'archived' : 'active'}: ${profiles.length} profile(s), ${unlinked.length} unlinked; ${archivedCount} archived, ${totalCount} total passes for gym ${gymId}`)
    return NextResponse.json({ profiles, unlinked, archivedCount, totalCount, countByType, timeZone, metrics })
  } catch (error) {
    console.error('[guest-passes GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
