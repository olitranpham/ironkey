import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/join
 * Public — returns gym name + available membership plans for the signup form.
 * Plans are fetched live from the gym's own Stripe account and returned as-is,
 * with no keyword-based type mapping or filtering.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, stripeSecretKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    let membershipPlans = []

    if (gym.stripeSecretKey) {
      const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
      const prices = await stripe.prices.list({
        active: true,
        limit:  100,
        expand: ['data.product'],
      })

      membershipPlans = prices.data
        .filter(p => p.recurring && p.unit_amount != null)
        .map(p => {
          const name = p.nickname ?? p.product?.name ?? 'Membership'
          return {
            priceId:        p.id,
            name,
            amount:         p.unit_amount / 100,
            interval:       p.recurring.interval,
            membershipType: name,
          }
        })
        .sort((a, b) => a.amount - b.amount)
    }

    return NextResponse.json({ gym: { name: gym.name, slug: gymSlug }, membershipPlans, addonPlans: [] })
  } catch (error) {
    console.error('[join GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
