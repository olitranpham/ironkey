import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/join/session-result?session_id=xxx
 * Public — called by the membership success page to show the new member their access code.
 * Retrieves the Stripe checkout session to get the member email, then looks up
 * their Member record for the access code.
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

    const member = await prisma.member.findFirst({
      where: { gymId: gym.id, email },
    })

    return NextResponse.json({
      email,
      accessCode: member?.accessCode ?? null,
    })
  } catch (error) {
    console.error('[join/session-result]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
