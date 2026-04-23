import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// Keywords that identify a price as a guest day pass product
const GUEST_PASS_KEYWORDS = ['day pass', 'single', '3-pack', 'three-pack', '5-pack', 'five-pack', '10-pack', 'ten-pack']

function isGuestPassPrice(name = '') {
  const n = name.toLowerCase()
  return GUEST_PASS_KEYWORDS.some(kw => n.includes(kw))
}

function inferPassType(name = '') {
  const n = name.toLowerCase()
  if (n.includes('10') || n.includes('ten'))   return { passType: 'TEN_PACK',   passesLeft: 10 }
  if (n.includes('5')  || n.includes('five'))  return { passType: 'FIVE_PACK',  passesLeft: 5  }
  if (n.includes('3')  || n.includes('three')) return { passType: 'THREE_PACK', passesLeft: 3  }
  return { passType: 'SINGLE', passesLeft: 1 }
}

/**
 * GET /api/[gymSlug]/guest
 * Public — returns gym name + available one-time guest pass plans.
 * Uses the gym's own stripeSecretKey from the DB (looked up by gymSlug).
 * Filters to only prices whose names match guest pass keywords.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, stripeSecretKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    let plans = []
    if (gym.stripeSecretKey) {
      const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
      const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] })

      plans = prices.data
        .filter(p => !p.recurring && p.unit_amount != null)   // one-time only, not subscriptions
        .filter(p => {
          const name = p.nickname ?? p.product?.name ?? ''
          return isGuestPassPrice(name)
        })
        .map(p => {
          const name = p.nickname ?? p.product?.name ?? 'Guest Pass'
          const { passType, passesLeft } = inferPassType(name)
          return {
            priceId:    p.id,
            name,
            amount:     p.unit_amount / 100,
            passType,
            passesLeft,
          }
        })
        .sort((a, b) => a.amount - b.amount)
    }

    return NextResponse.json({ gym: { name: gym.name, slug: gymSlug }, plans })
  } catch (error) {
    console.error('[guest GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
