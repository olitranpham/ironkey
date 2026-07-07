import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/guest/session-result?session_id=xxx
 * Public — called by the guest success page to show the guest their access code.
 * Retrieves the Stripe checkout session to get the guest email, then looks up
 * their GuestProfile for the access code and passes remaining.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug }   = await params
    const { searchParams } = new URL(request.url)
    const sessionId     = searchParams.get('session_id')

    if (!sessionId) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, stripeSecretKey: true },
    })
    if (!gym || !gym.stripeSecretKey) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const stripe  = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const email   = (session.customer_email ?? '').toLowerCase()

    if (!email) return NextResponse.json({ error: 'No email on session' }, { status: 400 })

    const profile = await prisma.guest.findUnique({ where: { email } })

    // Find most recent GuestVisit for this gym to get passesLeft
    const latestVisit = await prisma.guestVisit.findFirst({
      where:   { gymId: gym.id, guestEmail: { equals: email, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      email,
      accessCode: profile?.accessCode ?? null,
      passesLeft: latestVisit?.passesLeft ?? null,
      passType:   latestVisit?.passType  ?? null,
    })
  } catch (error) {
    console.error('[guest/session-result]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
