import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { limitRequest, hit, tooManyRequests, EMAIL_LIMIT } from '@/lib/rateLimit'
import { maskEmail, findValidSeamCode, deliverGuestCode } from '@/lib/guestCodeDelivery'
import { verifyPaidCheckoutSession } from '@/lib/checkoutSession'

const RESEND_EMAIL_LIMIT = 3

/**
 * POST /api/[gymSlug]/guest-passes/checkin/resend
 * Public "resend my code". Body: { email } (kiosk) or { session_id } (the
 * guest success page, which never learns the email — the session must be a
 * paid checkout on this gym's Stripe account; its email is used server-side).
 *
 * Re-sends the guest's CURRENT active code at this gym (a live, unexpired
 * code for their PIN on this gym's lock) through the guest Zapier webhook to
 * the email on the profile. Never creates a pass or a code, never returns the
 * PIN. The response is identical whether or not there's an active code (or
 * delivery failed), so it can't be used to probe who has one.
 *
 * Rate limits: 3 / 10 min per email, 60 / 10 min per IP.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json().catch(() => ({}))

    // IP limit first — the email may only be known after verifying a session
    const ipLimited = await limitRequest(request, 'guest-checkin-resend', null)
    if (ipLimited) return ipLimited

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true, zapierGuestWebhookUrl: true, stripeSecretKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    let email = (body.email ?? '').trim().toLowerCase()
    if (!email && body.session_id) {
      const verified = await verifyPaidCheckoutSession(gym, body.session_id, 'guest')
      if (!verified.ok) return NextResponse.json({ ok: true, sentTo: maskEmail(null) })
      email = verified.email
    }
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const emailHit = await hit(`guest-checkin-resend:email:${email}`, RESEND_EMAIL_LIMIT, EMAIL_LIMIT.windowSec)
    if (!emailHit.allowed) return tooManyRequests(emailHit.retryAfterSec)

    const generic = NextResponse.json({ ok: true, sentTo: maskEmail(email) })
    if (!gym.seamApiKey || !gym.seamDeviceId) return generic

    const profile = await prisma.guest.findUnique({
      where:  { email },
      select: { id: true, name: true, email: true, accessCode: true },
    })
    if (!profile?.accessCode) return generic

    // Only a code that is live on THIS gym's lock right now counts as active
    const seamHeaders = { Authorization: `Bearer ${gym.seamApiKey}`, 'Content-Type': 'application/json' }
    const activeCode  = await findValidSeamCode(seamHeaders, gym.seamDeviceId, profile.accessCode)
    if (!activeCode) return generic

    const latestPass = await prisma.guestVisit.findFirst({
      where:   { gymId: gym.id, guestProfileId: profile.id },
      orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
      select:  { passType: true, passesLeft: true },
    })

    // Same payload as a check-in so the existing Zap emails it; resend: true for filtering
    await deliverGuestCode(gym, gymSlug, {
      name:       profile.name,
      email:      profile.email,   // the profile's email, never the request's
      accessCode: profile.accessCode,
      passType:   latestPass?.passType ?? null,
      passesLeft: latestPass?.passesLeft ?? null,
      type:       'checkin',
      resend:     true,
    })

    return generic
  } catch (error) {
    console.error('[guest-passes/checkin/resend]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
