import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { limitRequest } from '@/lib/rateLimit'
import { normalizeEmail, preparePromotionCode, rethrowPromoSessionError, PromoCodeError, promoCodeErrorResponse } from '@/lib/couponRedemption'

/**
 * POST /api/[gymSlug]/concessions/checkout
 * Public — creates a Stripe Checkout session (one-time payment) for a
 * concessions order.
 *
 * Body: { items: [{ stripeProductId, quantity }], email, promotionCode? }
 * email is required so a once-per-customer promo code can be checked before
 * the session exists; it's also the session's customer_email.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()
    const selections = Array.isArray(body.items) ? body.items : []
    const clean = selections
      .filter(i => i?.stripeProductId && Number(i.quantity) > 0)
      .map(i => ({ stripeProductId: i.stripeProductId, quantity: Math.floor(Number(i.quantity)) }))

    if (!clean.length) return NextResponse.json({ error: 'No items selected' }, { status: 400 })

    const email = normalizeEmail(body.email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'a valid email is required' }, { status: 400 })
    }

    const limited = await limitRequest(request, 'concessions-checkout', email)
    if (limited) return limited

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, stripeSecretKey: true },
    })
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    // Look up current price/name for each product straight from the DB —
    // never trust client-submitted prices.
    const dbItems = await prisma.inventoryItem.findMany({
      where:  { gymId: gym.id, stripeProductId: { in: clean.map(i => i.stripeProductId) } },
      select: { name: true, price: true, quantity: true, stripeProductId: true },
    })
    const byProductId = Object.fromEntries(dbItems.map(i => [i.stripeProductId, i]))

    const line_items = clean.map(({ stripeProductId, quantity }) => {
      const item = byProductId[stripeProductId]
      if (!item || item.price == null) throw new Error('One or more items are no longer available')
      if (quantity > item.quantity)     throw new Error(`Not enough "${item.name}" in stock`)
      return {
        quantity,
        price_data: {
          currency:    'usd',
          product:     stripeProductId,
          unit_amount: Math.round(item.price * 100),
        },
      }
    })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const origin = process.env.NEXT_PUBLIC_APP_URL
      ?? request.headers.get('origin')
      ?? `https://${request.headers.get('host')}`

    const promo = await preparePromotionCode(stripe, gym, body.promotionCode, email)

    const session = await stripe.checkout.sessions.create({
      mode:                  'payment',
      customer_email:        email,
      line_items,
      ...(promo ? { discounts: promo.discounts } : {}),
      success_url: `${origin}/${gymSlug}/concessions/success`,
      cancel_url:  `${origin}/${gymSlug}/concessions`,
      metadata: {
        source: 'concessions',
        gymId:  gym.id,
        gymSlug,
        email,
        ...(promo?.metadata ?? {}),
      },
    }).catch(err => rethrowPromoSessionError(err, promo))

    return NextResponse.json({ url: session.url })
  } catch (error) {
    if (error instanceof PromoCodeError) return promoCodeErrorResponse(error)
    console.error('[concessions/checkout POST]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
