import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// Hydra's bundled Student/Military/Police/EMT membership product — matched by
// ID rather than name so a staff rename (e.g. to "student membership") can't
// silently drop it out of the join page. Update if this product is ever
// recreated under a new ID.
const HYDRA_STUDENT_MILITARY_EMT_PRODUCT_ID = 'prod_Uc7pO4ZOBrs4AH'

// Rutgers Powerlifting Club — one-off $5 non-recurring membership. It's a
// one-time Stripe price, so it's excluded by the `recurring` filter below
// like every other one-time price; allowlisted back in explicitly by price
// ID for hydra-athletic-co only, rather than widening that filter for all gyms.
const HYDRA_RUTGERS_POWERLIFTING_PRICE_ID = 'price_1U84lzAHpnGUkbkC2kNFvTwD'

/**
 * GET /api/[gymSlug]/join
 * Public — returns gym name + available membership plans for the signup form.
 * Plans are fetched live from the gym's own Stripe account and returned as-is,
 * with no keyword-based type mapping or filtering.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const planParam = new URL(request.url).searchParams.get('plan')

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, logoUrl: true, stripeSecretKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    let membershipPlans   = []
    let addonPlans        = []
    let ptPlans           = []
    let programmingPlans  = []
    let groupTrainingPlans = []

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

      // Exclude prices whose parent product has been disabled from the
      // products page — an inactive product should never show as an option.
      const recurring = prices.data.filter(p => p.recurring && p.unit_amount != null && p.product?.active)

      // Products created via the staff "products" page are tagged with this
      // metadata so they always qualify as a membership plan here, regardless
      // of name — new plans shouldn't need a code change to show up on join.
      const isTaggedMembership = p => p.product?.metadata?.ironkey_kind === 'membership'

      if (gymSlug === 'triumph-barbell') {
        // Membership plans: General and Student products, or anything tagged
        // as a membership plan by the products page
        membershipPlans = recurring
          .filter(p => {
            const n = (p.nickname ?? p.product?.name ?? '').toLowerCase()
            return n.includes('general') || n.includes('student') || isTaggedMembership(p)
          })
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)

        // Personal Training plans (gym membership included)
        ptPlans = recurring
          .filter(p => p.product?.id === 'prod_UrUgF0FkeB0IJx')
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)

        // Programming plans (gym membership included)
        programmingPlans = recurring
          .filter(p => p.product?.id === 'prod_UrtfMuPRgjfdsd')
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
          .filter(p => OASIS_PRODUCT_IDS.has(p.product?.id) || isTaggedMembership(p))
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)

        // Personal Training plans (gym membership included)
        ptPlans = recurring
          .filter(p => p.product?.id === 'prod_Uqf1w4GB1ESyRI')
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)

        // Group Training add-on (additional line item alongside base membership)
        groupTrainingPlans = recurring
          .filter(p => p.product?.id === 'prod_V0Vdl6bPgfqgud')
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)
      } else if (gymSlug === 'hydra-athletic-co') {
        // Membership plans: Pre-Sale, Standard, and Student/Military/Police/EMT
        // memberships, or anything tagged as a membership plan by the products page
        membershipPlans = recurring
          .filter(p => {
            const n = (p.nickname ?? p.product?.name ?? '').toLowerCase()
            return n.includes('pre-sale membership')
                || n.includes('standard membership')
                || p.product?.id === HYDRA_STUDENT_MILITARY_EMT_PRODUCT_ID
                || isTaggedMembership(p)
          })
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)

        // One-off Rutgers Powerlifting Club price — not recurring, so it isn't
        // in `recurring` at all; pull it straight from the full price list.
        // Hidden-link gated: only included when the request carries
        // ?plan=rutgers-powerlifting, so it isn't discoverable on the plain
        // join page — it's meant to only be reachable via a link handed
        // directly to the club.
        const rutgersPrice = planParam === 'rutgers-powerlifting'
          ? prices.data.find(p => p.id === HYDRA_RUTGERS_POWERLIFTING_PRICE_ID && p.product?.active)
          : null
        if (rutgersPrice) {
          membershipPlans.push({
            priceId:        rutgersPrice.id,
            name:           rutgersPrice.nickname ?? rutgersPrice.product?.name ?? 'Rutgers Powerlifting',
            amount:         rutgersPrice.unit_amount / 100,
            interval:       null,
            intervalCount:  1,
            membershipType: rutgersPrice.nickname ?? rutgersPrice.product?.name ?? 'Rutgers Powerlifting',
          })
          membershipPlans.sort((a, b) => a.amount - b.amount)
        }

        // Coaching add-ons: members-only Coaching/Programs (non-member tier excluded)
        addonPlans = recurring
          .filter(p => {
            const n = (p.nickname ?? p.product?.name ?? '').toLowerCase()
            return n.includes('coaching/program') && !n.includes('non-member')
          })
          .map(toplan)
          .sort((a, b) => a.amount - b.amount)
      } else {
        membershipPlans = recurring.map(toplan).sort((a, b) => a.amount - b.amount)
      }
    }

    return NextResponse.json({ gym: { name: gym.name, slug: gymSlug, logoUrl: gym.logoUrl ?? null }, membershipPlans, addonPlans, ptPlans, programmingPlans, groupTrainingPlans })
  } catch (error) {
    console.error('[join GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
