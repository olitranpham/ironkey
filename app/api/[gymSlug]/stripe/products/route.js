import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// Legacy guest-pass products (created before this page existed) are only
// identifiable by name — mirrors the keyword list in /api/[gymSlug]/guest.
const GUEST_PASS_KEYWORDS = ['day pass', 'single', '3-pack', 'three-pack', '5-pack', 'five-pack', '10-pack', 'ten-pack']
function isLegacyGuestPassName(name = '') {
  const n = name.toLowerCase()
  return GUEST_PASS_KEYWORDS.some(kw => n.includes(kw))
}

// Oasis Boston's real guest-pass products don't follow the keyword naming
// convention above ("Value Pack", "Deluxe Pack" don't contain any of those
// substrings) — mirrors the OASIS_PRODUCT_MAP hardcoded in the live guest
// checkout route (/api/[gymSlug]/guest) so this admin page shows exactly the
// same three products actually sold to the public.
const OASIS_GUEST_PASS_PRODUCT_IDS = new Set([
  'prod_UdG5qNSMCuYDhN', // Single Pass
  'prod_UdG5tLURJQAEog', // Value Pack
  'prod_UdG5qpIhMMjmyA', // Deluxe Pack
])

function inferPasses(name = '') {
  const n = name.toLowerCase()
  if (n.includes('10') || n.includes('ten'))   return 10
  if (n.includes('5')  || n.includes('five'))  return 5
  if (n.includes('3')  || n.includes('three')) return 3
  return 1
}

const INTERVAL_LABEL = {
  'week:1':  '/ week',
  'week:4':  '/ 4 weeks',
  'month:1': '/ month',
  'month:6': '/ 6 months',
  'year:1':  '/ year',
}

function intervalLabel(price) {
  if (!price?.recurring) return null
  const key = `${price.recurring.interval}:${price.recurring.interval_count ?? 1}`
  return INTERVAL_LABEL[key] ?? `/ ${price.recurring.interval_count > 1 ? `${price.recurring.interval_count} ` : ''}${price.recurring.interval}${price.recurring.interval_count > 1 ? 's' : ''}`
}

async function getGym(gymSlug) {
  return prisma.gym.findUnique({
    where:  { slug: gymSlug },
    select: { id: true, stripeSecretKey: true },
  })
}

/**
 * GET /api/[gymSlug]/stripe/products
 * Public to gym staff — returns Stripe prices for this gym's account, split
 * into membership plans (recurring prices) and guest pass types (one-time
 * prices tagged as guest passes, by metadata or legacy name).
 *
 * Fetches by PRICE (not by product's default_price) so a product with
 * multiple active prices — e.g. Triumph's "Personal Training + Membership"
 * (1/2/3 sessions per week) or "Programming + Membership" (three tiers) —
 * shows every price as its own row, not just whichever one is the default.
 *
 * `active: true` on the prices.list call does double duty: it excludes
 * prices whose PRODUCT is disabled from the products page just as before
 * (a disabled product's price is left untouched, so it still comes back
 * here — the frontend grays it out via `active: false` and offers
 * re-enable), and it's also what makes the delete/trash action permanent —
 * deleting archives the specific price, and an archived price simply never
 * appears in this list again.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const gym = await getGym(gymSlug)
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    // Active prices (the normal case) plus inactive prices the staff
    // explicitly toggled off from this page (tagged via ironkey_toggle_disabled
    // in the PATCH route) — those stay visible here, grayed out, re-enable
    // available. Inactive prices WITHOUT the tag were superseded by the
    // edit-price flow or archived/deleted permanently and never resurface.
    const [activeRes, inactiveRes] = await Promise.all([
      stripe.prices.list({ active: true,  expand: ['data.product'], limit: 100 }),
      stripe.prices.list({ active: false, expand: ['data.product'], limit: 100 }),
    ])
    const toggleDisabled = inactiveRes.data.filter(p => p.metadata?.ironkey_toggle_disabled === 'true')
    const prices = { data: [...activeRes.data, ...toggleDisabled], has_more: activeRes.has_more || inactiveRes.has_more }

    console.log(
      '[stripe/products GET] %s — active=%d toggle-disabled=%d has_more=%s',
      gymSlug, activeRes.data.length, toggleDisabled.length, prices.has_more,
    )
    console.log(
      '[stripe/products GET] %s — raw prices:',
      gymSlug,
      JSON.stringify(prices.data.map(p => ({
        priceId: p.id, nickname: p.nickname, recurring: Boolean(p.recurring), active: p.active,
        productName: typeof p.product === 'object' ? p.product?.name : p.product,
        productActive: typeof p.product === 'object' ? p.product?.active : undefined,
      }))),
    )

    const membershipPlans = []
    const guestPasses      = []

    for (const price of prices.data) {
      const product = price.product
      if (!product || typeof product === 'string') continue  // expand failed — nothing to show

      if (price.recurring) {
        membershipPlans.push({
          id:          product.id,
          priceId:     price.id,
          name:        product.name,
          priceLabel:  price.nickname ?? null,
          active:      price.active,
          amount:      price.unit_amount / 100,
          interval:    intervalLabel(price),
          intervalKey: `${price.recurring.interval}:${price.recurring.interval_count ?? 1}`,
        })
      } else {
        const isGuestPass = product.metadata?.ironkey_kind === 'guest_pass'
          || isLegacyGuestPassName(product.name)
          || (gymSlug === 'oasis-boston' && OASIS_GUEST_PASS_PRODUCT_IDS.has(product.id))
        if (!isGuestPass) continue  // one-time product managed elsewhere (e.g. concessions) — not shown here

        guestPasses.push({
          id:         product.id,
          priceId:    price.id,
          name:       product.name,
          priceLabel: price.nickname ?? null,
          active:     price.active,
          amount:     price.unit_amount / 100,
          passes:     product.metadata?.passes ? parseInt(product.metadata.passes, 10) : inferPasses(product.name),
        })
      }
    }

    membershipPlans.sort((a, b) => a.name.localeCompare(b.name) || a.amount - b.amount)
    guestPasses.sort((a, b) => a.name.localeCompare(b.name) || a.amount - b.amount)

    console.log(
      '[stripe/products GET] %s — final membershipPlans=%d guestPasses=%d: %s',
      gymSlug, membershipPlans.length, guestPasses.length,
      JSON.stringify(membershipPlans.map(p => p.name)),
    )

    return NextResponse.json({ membershipPlans, guestPasses })
  } catch (error) {
    console.error('[stripe/products GET]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/[gymSlug]/stripe/products
 * Creates a new Stripe product + price.
 *
 * Body: {
 *   kind:  'membership' | 'guestPass',
 *   name:  string,
 *   price: number,
 *   // membership only:
 *   interval:      'week' | 'month' | 'year',
 *   intervalCount: number,
 *   // guestPass only:
 *   passes: number,
 * }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()
    const { kind, name, price } = body

    if (!kind || !['membership', 'guestPass'].includes(kind)) {
      return NextResponse.json({ error: 'kind must be "membership" or "guestPass"' }, { status: 400 })
    }
    if (!name?.trim())                       return NextResponse.json({ error: 'name is required' },  { status: 400 })
    if (!price || Number(price) <= 0)        return NextResponse.json({ error: 'a valid price is required' }, { status: 400 })

    const gym = await getGym(gymSlug)
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    if (kind === 'membership') {
      const { interval, intervalCount } = body
      if (!['week', 'month', 'year'].includes(interval)) {
        return NextResponse.json({ error: 'invalid billing interval' }, { status: 400 })
      }
      const product = await stripe.products.create({
        name:     name.trim(),
        metadata: { ironkey_kind: 'membership' },
      })
      const stripePrice = await stripe.prices.create({
        product:     product.id,
        unit_amount: Math.round(Number(price) * 100),
        currency:    'usd',
        recurring:   { interval, interval_count: Math.max(1, parseInt(intervalCount, 10) || 1) },
      })
      await stripe.products.update(product.id, { default_price: stripePrice.id })

      return NextResponse.json({
        product: {
          id: product.id, name: product.name, active: true,
          priceId: stripePrice.id, amount: Number(price),
          interval: intervalLabel(stripePrice), intervalKey: `${interval}:${intervalCount}`,
        },
      }, { status: 201 })
    }

    // ── guestPass ──────────────────────────────────────────────────────────
    const passes = Math.max(1, parseInt(body.passes, 10) || 1)
    const product = await stripe.products.create({
      name:     name.trim(),
      metadata: { ironkey_kind: 'guest_pass', passes: String(passes) },
    })
    const stripePrice = await stripe.prices.create({
      product:     product.id,
      unit_amount: Math.round(Number(price) * 100),
      currency:    'usd',
    })
    await stripe.products.update(product.id, { default_price: stripePrice.id })

    return NextResponse.json({
      product: {
        id: product.id, name: product.name, active: true,
        priceId: stripePrice.id, amount: Number(price), passes,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[stripe/products POST]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
