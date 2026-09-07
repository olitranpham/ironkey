import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

async function getGym(gymSlug) {
  return prisma.gym.findUnique({
    where:  { slug: gymSlug },
    select: { id: true, stripeSecretKey: true },
  })
}

function formatDiscount(coupon) {
  if (coupon.percent_off != null) return `${coupon.percent_off}% off`
  if (coupon.amount_off != null)  return `$${(coupon.amount_off / 100).toFixed(2)} off`
  return '—'
}

/**
 * GET /api/[gymSlug]/stripe/coupons
 * Lists this gym's Stripe promotion codes (with their underlying coupon
 * expanded), resolving any product-restricted coupon's product IDs to names
 * for display.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const gym = await getGym(gymSlug)
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const promotionCodes = await stripe.promotionCodes.list({ limit: 100, expand: ['data.coupon'] })

    // Resolve restricted-product IDs to names once, up front, rather than
    // per-coupon — several coupons commonly restrict to the same product.
    const productIds = new Set()
    for (const pc of promotionCodes.data) {
      for (const id of pc.coupon?.applies_to?.products ?? []) productIds.add(id)
    }
    const productNames = {}
    await Promise.all([...productIds].map(async id => {
      try {
        const product = await stripe.products.retrieve(id)
        productNames[id] = product.name
      } catch {
        productNames[id] = id
      }
    }))

    const coupons = promotionCodes.data.map(pc => {
      const c = pc.coupon
      const restrictedProductIds = c.applies_to?.products ?? []
      return {
        id:                pc.id,
        code:              pc.code,
        active:            pc.active,
        discount:          formatDiscount(c),
        duration:          c.duration,
        durationInMonths:  c.duration_in_months ?? null,
        restrictedProducts: restrictedProductIds.map(id => productNames[id] ?? id),
        expiresAt:         pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null,
        maxRedemptions:    pc.max_redemptions ?? null,
        timesRedeemed:     pc.times_redeemed ?? 0,
      }
    })

    coupons.sort((a, b) => a.code.localeCompare(b.code))

    return NextResponse.json({ coupons })
  } catch (error) {
    console.error('[stripe/coupons GET]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/[gymSlug]/stripe/coupons
 * Creates a Stripe Coupon (the discount definition) and a PromotionCode
 * wrapping it (the human-readable redeemable code).
 *
 * Body: {
 *   code, discountType: 'percent' | 'amount', value,
 *   duration: 'once' | 'repeating', durationInMonths,
 *   restrictedProductIds, expiresAt, maxRedemptions,
 * }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()
    const {
      code, discountType, value, duration, durationInMonths,
      restrictedProductIds, expiresAt, maxRedemptions,
    } = body

    if (!code?.trim()) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }
    if (!['percent', 'amount'].includes(discountType)) {
      return NextResponse.json({ error: "discountType must be 'percent' or 'amount'" }, { status: 400 })
    }
    if (!value || Number(value) <= 0) {
      return NextResponse.json({ error: 'a valid value is required' }, { status: 400 })
    }
    if (discountType === 'percent' && Number(value) > 100) {
      return NextResponse.json({ error: 'percent value cannot exceed 100' }, { status: 400 })
    }
    if (!['once', 'repeating'].includes(duration)) {
      return NextResponse.json({ error: "duration must be 'once' or 'repeating'" }, { status: 400 })
    }
    if (duration === 'repeating' && (!durationInMonths || Number(durationInMonths) < 1)) {
      return NextResponse.json({ error: 'durationInMonths is required when duration is repeating' }, { status: 400 })
    }

    const gym = await getGym(gymSlug)
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const couponParams = {
      duration,
      ...(duration === 'repeating' ? { duration_in_months: Math.max(1, parseInt(durationInMonths, 10)) } : {}),
      ...(discountType === 'percent'
        ? { percent_off: Number(value) }
        : { amount_off: Math.round(Number(value)), currency: 'usd' }),
      ...(Array.isArray(restrictedProductIds) && restrictedProductIds.length > 0
        ? { applies_to: { products: restrictedProductIds } }
        : {}),
    }

    const coupon = await stripe.coupons.create(couponParams)

    let promotionCode
    try {
      promotionCode = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code:   code.trim(),
        ...(maxRedemptions ? { max_redemptions: Math.max(1, parseInt(maxRedemptions, 10)) } : {}),
        ...(expiresAt ? { expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
      })
    } catch (err) {
      // Don't leave an orphaned coupon behind if the promo code step fails
      // (e.g. the code string is already in use).
      await stripe.coupons.del(coupon.id).catch(() => {})
      throw err
    }

    return NextResponse.json({
      promotionCode: {
        id:     promotionCode.id,
        code:   promotionCode.code,
        active: promotionCode.active,
      },
      coupon: {
        id:       coupon.id,
        discount: formatDiscount(coupon),
        duration: coupon.duration,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[stripe/coupons POST]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
