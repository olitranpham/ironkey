import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyPaidCheckoutSession } from '@/lib/checkoutSession'
import { maskEmail } from '@/lib/guestCodeDelivery'

const PENDING = () => NextResponse.json({ ok: false, pending: true })

/**
 * GET /api/[gymSlug]/guest/session-result?session_id=xxx
 * Public — polled by the guest success page after Stripe Checkout.
 *
 * Never returns the access code. Returns { ok: true, sentTo } once the
 * session is a PAID checkout on this gym's Stripe account and the webhook has
 * saved the guest's code (which it emails); otherwise { ok: false, pending: true }
 * with no guest data.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug }   = await params
    const { searchParams } = new URL(request.url)
    const sessionId     = searchParams.get('session_id')

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, stripeSecretKey: true },
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

    return NextResponse.json({ ok: true, sentTo: maskEmail(profile.email) })
  } catch (error) {
    console.error('[guest/session-result]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
