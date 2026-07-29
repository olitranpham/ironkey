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

// Bucket an exact pass count (from products-page metadata) into the closest
// PassType enum value — the enum only has SINGLE/3/5/10-pack buckets, so a
// count like 15 still reads as a "pack"; passesLeft carries the real number.
function passTypeForCount(n) {
  if (n >= 10) return 'TEN_PACK'
  if (n >= 5)  return 'FIVE_PACK'
  if (n >= 3)  return 'THREE_PACK'
  return 'SINGLE'
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
      select: { id: true, name: true, logoUrl: true, stripeSecretKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    let plans = []
    if (gym.stripeSecretKey) {
      const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
      const prices = await stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] })

      const OASIS_PRODUCT_MAP = {
        'prod_UdG5qNSMCuYDhN': { passType: 'SINGLE', passesLeft: 1  }, // Single — $22.50
        'prod_UdG5tLURJQAEog': { passType: 'VALUE',  passesLeft: 5  }, // Value  — $85
        'prod_UdG5qpIhMMjmyA': { passType: 'DELUXE', passesLeft: 10 }, // Deluxe — $135
      }

      plans = prices.data
        .filter(p => !p.recurring && p.unit_amount != null && p.product?.active)   // one-time only, not subscriptions, product not disabled
        .filter(p => {
          if (gymSlug === 'oasis-boston') return p.product?.id in OASIS_PRODUCT_MAP
          const name = p.nickname ?? p.product?.name ?? ''
          // Products created via the staff "products" page are tagged with
          // this metadata, so they always qualify regardless of name.
          return p.product?.metadata?.ironkey_kind === 'guest_pass' || isGuestPassPrice(name)
        })
        .map(p => {
          const name = p.nickname ?? p.product?.name ?? 'Guest Pass'
          let passType, passesLeft
          if (gymSlug === 'oasis-boston' && OASIS_PRODUCT_MAP[p.product?.id]) {
            ({ passType, passesLeft } = OASIS_PRODUCT_MAP[p.product.id])
          } else if (p.product?.metadata?.passes) {
            // Trust the exact count set on the products page over name-guessing
            passesLeft = parseInt(p.product.metadata.passes, 10)
            passType   = passTypeForCount(passesLeft)
          } else {
            ({ passType, passesLeft } = inferPassType(name))
          }
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

    return NextResponse.json({ gym: { name: gym.name, slug: gymSlug, logoUrl: gym.logoUrl ?? null }, plans })
  } catch (error) {
    console.error('[guest GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
