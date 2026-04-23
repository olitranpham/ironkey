import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// ── Cache ─────────────────────────────────────────────────────────────────────

const subCache = new Map()
const CACHE_TTL = 5 * 60 * 1000  // 5 minutes

/**
 * GET /api/[gymSlug]/stripe/subscriptions
 *
 * Returns:
 *   subscriptions: { [subId]: { amount, interval } }  — from active + paused subs
 *   prices:        { [priceId]: { amount, interval } } — fallback for members with no sub match
 *
 * Amount resolution order (applied by the client per member):
 *   1. subscriptions[member.stripeSubscriptionId]  (active)
 *   2. subscriptions[member.stripeSubscriptionId]  (paused — merged into same map)
 *   3. prices[member.priceId]                      (price fallback)
 *   4. null → display —
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
      select: { id: true, stripeSecretKey: true },
    })
    if (!gym?.stripeSecretKey) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })
    }

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    // ── 1. Fetch active + paused subscriptions in parallel ────────────────────
    const [activeResult, pausedResult] = await Promise.all([
      stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.items.data.price'] }),
      stripe.subscriptions.list({ status: 'paused', limit: 100, expand: ['data.items.data.price'] }),
    ])

    // Build subId → { amount, interval } map from both sets
    const subscriptions = {}
    for (const sub of [...activeResult.data, ...pausedResult.data]) {
      const item     = sub.items.data[0]
      const price    = item?.price
      const amount   = price?.unit_amount
      const interval = price?.recurring?.interval
      if (amount != null) {
        subscriptions[sub.id] = { amount: amount / 100, interval: interval ?? 'mo' }
      }
    }

    // ── 2. Find members whose sub is still missing an amount ──────────────────
    // Pull all members for this gym that have a priceId stored
    const members = await prisma.member.findMany({
      where:  { gymId: gym.id, priceId: { not: null } },
      select: { stripeSubscriptionId: true, priceId: true },
    })

    // Collect unique priceIds for members not already covered by the sub map
    const missingPriceIds = [
      ...new Set(
        members
          .filter(m => m.stripeSubscriptionId && !subscriptions[m.stripeSubscriptionId])
          .map(m => m.priceId)
          .filter(Boolean)
      ),
    ]

    // ── 3. Fetch missing prices in parallel ───────────────────────────────────
    const prices = {}
    if (missingPriceIds.length > 0) {
      const priceResults = await Promise.all(
        missingPriceIds.map(id =>
          stripe.prices.retrieve(id).catch(() => null)
        )
      )
      for (const price of priceResults) {
        if (!price || price.unit_amount == null) continue
        prices[price.id] = {
          amount:   price.unit_amount / 100,
          interval: price.recurring?.interval ?? 'mo',
        }
      }
    }

    const data = { subscriptions, prices }
    subCache.set(gymSlug, { data, ts: Date.now() })
    return NextResponse.json(data)
  } catch (error) {
    console.error('[stripe/subscriptions]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
