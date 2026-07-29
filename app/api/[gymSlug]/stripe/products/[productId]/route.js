import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/[gymSlug]/stripe/products/[productId]
 * Body: {
 *   active?:         boolean,
 *   passes?:         number,
 *   name?:           string,
 *   archivePriceId?: string,
 *   priceUpdate?: {
 *     oldPriceId: string,
 *     amount:     number,                              // dollars
 *     nickname?:  string | null,
 *     recurring?: { interval: 'week'|'month'|'year', intervalCount: number } | null,
 *   },
 * }
 *
 * - active: toggles the product active/inactive. A disabled product stays
 *   visible in the products list (grayed out) and can be re-enabled.
 * - passes: updates the number of guest passes stored in metadata.
 * - name: renames the product.
 * - archivePriceId: also archives the given price (active: false on the
 *   Price object itself) with no replacement — the delete/trash action.
 *   The products GET route treats any product with an archived price as
 *   gone for good, since a price with existing subscriptions/checkout
 *   history can't be truly deleted from Stripe.
 * - priceUpdate: the edit-price flow. Stripe prices are immutable once
 *   created (amount/recurring terms can't change), so an amount or interval
 *   edit creates a brand new Price on the same product, points the
 *   product's default_price at it, and archives the old one.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, productId } = await params
    const body = await request.json()

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { stripeSecretKey: true },
    })
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const update = {}
    if (typeof body.active === 'boolean') update.active = body.active
    if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim()
    if (body.passes !== undefined) {
      update.metadata = { passes: String(Math.max(1, parseInt(body.passes, 10) || 1)) }
    }

    let newPrice = null
    if (body.priceUpdate) {
      const { amount, nickname, recurring, oldPriceId } = body.priceUpdate
      if (!oldPriceId || !amount || Number(amount) <= 0) {
        return NextResponse.json({ error: 'priceUpdate requires oldPriceId and a valid amount' }, { status: 400 })
      }
      newPrice = await stripe.prices.create({
        product:     productId,
        unit_amount: Math.round(Number(amount) * 100),
        currency:    'usd',
        ...(nickname ? { nickname } : {}),
        ...(recurring
          ? { recurring: { interval: recurring.interval, interval_count: Math.max(1, parseInt(recurring.intervalCount, 10) || 1) } }
          : {}),
      })
      update.default_price = newPrice.id
    }

    if (Object.keys(update).length === 0 && !body.archivePriceId) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    let product = null
    if (Object.keys(update).length > 0) {
      product = await stripe.products.update(productId, update)
    }

    // Archive the superseded price only after the product's default_price
    // has already moved off of it (avoids a moment where the product points
    // at an archived price).
    if (body.priceUpdate) {
      await stripe.prices.update(body.priceUpdate.oldPriceId, { active: false })
    }
    if (body.archivePriceId) {
      await stripe.prices.update(body.archivePriceId, { active: false })
    }

    return NextResponse.json({
      product: {
        id:      productId,
        active:  product?.active,
        name:    product?.name,
        passes:  product?.metadata?.passes ? parseInt(product.metadata.passes, 10) : undefined,
        priceId: newPrice?.id,
        deleted: Boolean(body.archivePriceId),
      },
    })
  } catch (error) {
    console.error('[stripe/products/[productId] PATCH]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
