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

// Identify coaching/programming add-on plans by name
function isAddon(name = '') {
  const n = name.toLowerCase()
  return n.includes('programming') || n.includes('coaching') || n.includes('communication') || n.includes('add-on') || n.includes('addon')
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

    let membershipPlans = []
    let addonPlans      = []

    if (gym.stripeSecretKey) {
      const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
      const prices = await stripe.prices.list({
        active: true,
        limit:  100,
        expand: ['data.product'],
      })

      const excluded = EXCLUDED_TYPES[gymSlug] ?? []

      const allPlans = prices.data
        .filter(p => p.recurring && p.unit_amount != null)
        .map(p => ({
          priceId:        p.id,
          name:           p.nickname ?? p.product?.name ?? 'Membership',
          amount:         p.unit_amount / 100,
          interval:       p.recurring.interval,
          membershipType: inferMembershipType(p.nickname ?? p.product?.name ?? ''),
        }))
        .sort((a, b) => a.amount - b.amount)

      const MEMBERSHIP_ORDER = { GENERAL: 0, STUDENT: 1, WEEKEND: 2, FLEX: 3, FOUNDING: 4 }
      membershipPlans = allPlans
        .filter(p => !isAddon(p.name) && !excluded.includes(p.membershipType))
        .sort((a, b) => (MEMBERSHIP_ORDER[a.membershipType] ?? 99) - (MEMBERSHIP_ORDER[b.membershipType] ?? 99))
      addonPlans      = allPlans.filter(p => isAddon(p.name))
    }

    return NextResponse.json({ gym: { name: gym.name, slug: gymSlug }, membershipPlans, addonPlans })
  } catch (error) {
    console.error('[join GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
