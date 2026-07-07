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
    let addonPlans      = []

    if (gym.stripeSecretKey) {
      const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
      const prices = await stripe.prices.list({
        active: true,
        limit:  100,
        expand: ['data.product'],
      })

      const toplan = p => {
        const name = p.nickname ?? p.product?.name ?? 'Membership'
        return {
          priceId:        p.id,
          name,
          amount:         p.unit_amount / 100,
          interval:       p.recurring.interval,
          intervalCount:  p.recurring.interval_count ?? 1,
          membershipType: name,
        }
      }

      const recurring = prices.data.filter(p => p.recurring && p.unit_amount != null)

      if (gymSlug === 'triumph-barbell') {
        // Membership plans: only General and Student products
        membershipPlans = recurring
          .filter(p => {
            const n = (p.nickname ?? p.product?.name ?? '').toLowerCase()
            return n.includes('general') || n.includes('student')
          })
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)

        // Coaching add-ons: Programming / Communication products
        addonPlans = recurring
          .filter(p => {
            const n = (p.nickname ?? p.product?.name ?? '').toLowerCase()
            return n.includes('programming') || n.includes('communication')
          })
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)
      } else if (gymSlug === 'oasis-boston') {
        const OASIS_PRODUCT_IDS = new Set([
          'prod_Ucv94U6uvm7am9', // Semiannual Student Membership
          'prod_Ucv9fkBOT5aDKS', // Semiannual General Membership
          'prod_Ucv729ZXdrh80c', // Student Membership
          'prod_Ucv6OCNGmeTpA7', // General Membership
          'prod_T4wCwq1jBQDqhy', // Flex Membership
        ])
        membershipPlans = recurring
          .filter(p => OASIS_PRODUCT_IDS.has(p.product?.id))
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)
      } else if (gymSlug === 'hydra-athletic-co') {
        // Membership plans: only Pre-Sale Membership
        membershipPlans = recurring
          .filter(p => {
            const n = (p.nickname ?? p.product?.name ?? '').toLowerCase()
            return n.includes('pre-sale membership')
          })
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)

        // Coaching add-ons: all Coaching/Programs prices
        addonPlans = recurring
          .filter(p => {
            const n = (p.nickname ?? p.product?.name ?? '').toLowerCase()
            return n.includes('coaching/program')
          })
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)
      } else {
        membershipPlans = recurring.map(toplan).sort((a, b) => a.amount - b.amount)
      }
    }

    return NextResponse.json({ gym: { name: gym.name, slug: gymSlug }, membershipPlans, addonPlans })
  } catch (error) {
    console.error('[join GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
