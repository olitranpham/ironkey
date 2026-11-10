import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyPaidCheckoutSession } from '@/lib/checkoutSession'
import { maskEmail } from '@/lib/guestCodeDelivery'
import { accessWindow, accessNotice } from '@/lib/accessHours'

const PENDING = () => NextResponse.json({ ok: false, pending: true })

/**
 * GET /api/[gymSlug]/guest/session-result?session_id=xxx
 * Public — polled by the guest success page after Stripe Checkout.
 *
 * Never returns the access code. Returns { ok: true, sentTo, accessNotice } once the
 * session is a PAID checkout on this gym's Stripe account and the webhook has
 * saved the guest's code (which it emails); otherwise { ok: false, pending: true }
 * with no guest data. accessNotice is the pass's code window for gyms with
 * access hours (lib/accessHours), else null.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug }   = await params
    const { searchParams } = new URL(request.url)
    const sessionId     = searchParams.get('session_id')

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, stripeSecretKey: true, timezone: true, accessHoursStart: true, accessHoursEnd: true, accessLastEntry: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const verified = await verifyPaidCheckoutSession(gym, sessionId, 'guest')
    if (!verified.ok) return PENDING()

    const profile = await prisma.guest.findUnique({
      where:  { email: verified.email },
      select: { email: true, accessCode: true },
    })

    // Paid, but the webhook hasn't saved the code yet — keep polling
    if (!profile?.accessCode) return NextResponse.json({ ok: false, pending: true })

    // The pass's real window (its expiry is the code's end); if the webhook
    // hasn't written the pass yet, the window for right now is the same one
    const pass = await prisma.guestVisit.findUnique({
      where:  { stripeSessionId: sessionId },
      select: { createdAt: true, expiresAt: true },
    })
    const window = pass
      ? { at: pass.createdAt, endsAt: pass.expiresAt }
      : (now => ({ at: now, endsAt: accessWindow(gym, now).endsAt }))(new Date())

    return NextResponse.json({ ok: true, sentTo: maskEmail(profile.email), accessNotice: accessNotice(gym, window) })
  } catch (error) {
    console.error('[guest/session-result]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
