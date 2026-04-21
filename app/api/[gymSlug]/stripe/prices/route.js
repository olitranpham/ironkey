import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/stripe/prices?ids=price_xxx,price_yyy
 * Returns { priceId: { amount, interval } } for each requested price ID.
 * Fetches from Stripe using the gym's secret key.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { searchParams } = new URL(request.url)

    const ids = (searchParams.get('ids') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    if (ids.length === 0) {
      return NextResponse.json({ prices: {} })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { stripeSecretKey: true },
    })
    if (!gym?.stripeSecretKey) {
      return NextResponse.json({ error: 'Stripe not configured for this gym' }, { status: 400 })
    }

    const results = await Promise.allSettled(
      ids.map(id =>
        fetch(`https://api.stripe.com/v1/prices/${id}`, {
          headers: { Authorization: `Bearer ${gym.stripeSecretKey}` },
        }).then(r => r.json())
      )
    )

    const prices = {}
    ids.forEach((id, i) => {
      const result = results[i]
      if (result.status === 'fulfilled' && result.value?.unit_amount != null) {
        prices[id] = {
          amount:   result.value.unit_amount / 100,
          interval: result.value.recurring?.interval ?? 'mo',
        }
      } else {
        prices[id] = null
      }
    })

    return NextResponse.json({ prices })
  } catch (error) {
    console.error('[stripe/prices]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
