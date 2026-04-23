import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// Map Stripe price nicknames / product names to our MembershipType enum
function inferMembershipType(name = '') {
  const n = name.toLowerCase()
  if (n.includes('founding'))  return 'FOUNDING'
  if (n.includes('student'))   return 'STUDENT'
  if (n.includes('weekend'))   return 'WEEKEND'
  if (n.includes('flex'))      return 'FLEX'
  return 'GENERAL'
}

// Membership types excluded from the public join form per gym
const EXCLUDED_TYPES = {
  'triumph-barbell': ['FOUNDING'],
}

/**
 * GET /api/[gymSlug]/join
 * Public — returns gym name + available membership plans for the signup form.
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
      const prices = await stripe.prices.list({
        active: true,
        limit:  100,
        expand: ['data.product'],
      })

      const excluded = EXCLUDED_TYPES[gymSlug] ?? []

      plans = prices.data
        .filter(p => p.recurring && p.unit_amount != null)
        .map(p => ({
          priceId:        p.id,
          name:           p.nickname ?? p.product?.name ?? 'Membership',
          amount:         p.unit_amount / 100,
          interval:       p.recurring.interval,
          membershipType: inferMembershipType(p.nickname ?? p.product?.name ?? ''),
        }))
        .filter(p => !excluded.includes(p.membershipType))
        .sort((a, b) => a.amount - b.amount)
    }

    return NextResponse.json({ gym: { name: gym.name, slug: gymSlug }, plans })
  } catch (error) {
    console.error('[join GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
