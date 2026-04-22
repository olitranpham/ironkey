import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// ── Cache ─────────────────────────────────────────────────────────────────────

const subCache = new Map()
const CACHE_TTL = 5 * 60 * 1000  // 5 minutes

/**
 * GET /api/[gymSlug]/stripe/subscriptions
 * Returns a map of { [subId]: { amount, interval } } for all active subscriptions.
 * Used by the payments page to display the live price for each member.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const cached = subCache.get(gymSlug)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data)
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { stripeSecretKey: true },
    })
    if (!gym?.stripeSecretKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })
    }

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    // Fetch up to 100 active subscriptions — enough for any gym
    const result = await stripe.subscriptions.list({
      status: 'active',
      limit:  100,
      expand: ['data.items.data.price'],
    })

    // Build subId → { amount, interval } map
    const map = {}
    for (const sub of result.data) {
      const item     = sub.items.data[0]
      const price    = item?.price
      const amount   = price?.unit_amount
      const interval = price?.recurring?.interval

      if (amount != null) {
        map[sub.id] = { amount: amount / 100, interval: interval ?? 'mo' }
      }
    }

    subCache.set(gymSlug, { data: { subscriptions: map }, ts: Date.now() })
    return NextResponse.json({ subscriptions: map })
  } catch (error) {
    console.error('[stripe/subscriptions]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
