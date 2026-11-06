import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { limitRequest, clientIp } from '@/lib/rateLimit'
import { signatureError, waiverSignerName } from '@/lib/signature'
import { resolveAgreement } from '@/lib/agreements'

/**
 * POST /api/[gymSlug]/guest/waiver
 * Public — sign-only waiver (no purchase), opened by the kiosk when check-in
 * returns 403 needsWaiver. Only for a guest holding an active pack at this
 * gym (the same pack check-in would use).
 *
 * Body: { email, signatureName, agreementVersion }
 *
 * Same typed-signature rule as checkout (must match the guest's name, or the
 * guardian's for a minor) and the same text snapshot (lib/agreements). Writes
 * this gym's GuestWaiver; a guest already on file gets 200 unchanged.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body  = await request.json().catch(() => ({}))
    const email = (body.email ?? '').trim().toLowerCase()

    const limited = await limitRequest(request, 'guest-waiver', email)
    if (limited) return limited
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    // Only someone with an active pack here — otherwise they sign at checkout
    const pass = await prisma.guestVisit.findFirst({
      where:   { gymId: gym.id, guestEmail: { equals: email, mode: 'insensitive' }, passesLeft: { gt: 0 } },
      orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
      select:  { guestName: true },
    })
    if (!pass) return NextResponse.json({ error: 'no active pass found for that email' }, { status: 404 })

    let profile = await prisma.guest.findUnique({
      where:  { email },
      select: { id: true, name: true, isMinor: true, guardianName: true },
    })

    const existing = profile && await prisma.guestWaiver.findUnique({
      where:  { guestProfileId_gymId: { guestProfileId: profile.id, gymId: gym.id } },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ ok: true, alreadySigned: true })

    // Checked here only — the kiosk never learns the name on file
    const signer = waiverSignerName(profile, pass)
    if (signatureError(body.signatureName, { name: signer })) {
      return NextResponse.json({ error: 'signature must match the name on file' }, { status: 400 })
    }

    // A pack bought without an email-linked profile — create it, as check-in would
    if (!profile) {
      profile = await prisma.guest.create({ data: { name: pass.guestName || email, email }, select: { id: true } })
        .catch(async err => {
          if (err.code === 'P2002') return prisma.guest.findUnique({ where: { email }, select: { id: true } })
          throw err
        })
    }

    const sent = body.agreementVersion || null
    const { text, version, matched } = await resolveAgreement(gymSlug, 'guest', sent)
    if (!matched) {
      console.warn('[guest/waiver] guest waiver version %s not found for %s — storing current text %s', sent ?? '(none)', gymSlug, version)
    }

    const data = {
      guestProfileId:     profile.id,
      gymId:              gym.id,
      signedAt:           new Date(),
      signatureName:      String(body.signatureName).trim().replace(/\s+/g, ' '),
      signatureIp:        clientIp(request),
      signatureUserAgent: (request.headers.get('user-agent') ?? '').slice(0, 500) || null,
      waiverText:         text,
      waiverVersion:      version,
    }
    // upsert: a concurrent submit may have written it — never overwrite
    await prisma.guestWaiver.upsert({
      where:  { guestProfileId_gymId: { guestProfileId: profile.id, gymId: gym.id } },
      create: data,
      update: {},
    })

    console.log('[guest/waiver] signed gym=%s profile=%s version=%s', gymSlug, profile.id, version)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[guest/waiver POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
