import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/[gymSlug]/stripe/products/[productId]
 * Body: {
 *   priceId?:        string,   // scopes the `active` toggle to this specific
 *                               // price instead of the whole product — see below
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
 * - priceId + active: toggles just that ONE price active/inactive. A product
 *   can have several prices (e.g. Oasis's "Personal Training" product has 6 —
 *   three "$X/4 weeks" tiers plus three "X session(s)/week" tiers), so this
 *   must never touch the shared product — doing so would flip every sibling
 *   price's visibility at once. Tags the price's own metadata
 *   (ironkey_toggle_disabled) so the GET route can tell "staff toggled this
 *   off" (stays visible in the list, grayed out, re-enable available) apart
 *   from a price that was superseded by the edit-price flow below (archived
 *   for good, never shown again).
 * - passes: updates the number of guest passes stored in metadata.
 * - name: renames the product.
 * - archivePriceId: also archives the given price (active: false on the
 *   Price object itself) with no replacement — the delete/trash action.
 *   The products GET route treats any archived price with no toggle-disabled
 *   tag as gone for good, since a price with existing subscriptions/checkout
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

    // A price can't be archived while it's still its product's default_price
    // — Stripe rejects that outright. Products with a single price (guest
    // passes, always 1:1) always hit this, since their one price is always
    // the default. Products with several prices (e.g. membership PT tiers)
    // don't have this problem in the common case, so their existing
    // price-level archive/toggle behavior is left untouched — archiving the
    // whole product there would wrongly take out every sibling price too.
    async function hasSingleActivePrice() {
      const activePrices = await stripe.prices.list({ product: productId, active: true, limit: 2 })
      return activePrices.data.length <= 1
    }

    // ── Price-level active toggle ─────────────────────────────────────────
    if (typeof body.active === 'boolean' && body.priceId) {
      if (await hasSingleActivePrice()) {
        const singlePriceProduct = await stripe.products.update(productId, {
          active:   body.active,
          metadata: { ironkey_toggle_disabled: body.active ? '' : 'true' },
        })
        return NextResponse.json({ product: { id: singlePriceProduct.id, priceId: body.priceId, active: singlePriceProduct.active } })
      }
      const price = await stripe.prices.update(body.priceId, {
        active:   body.active,
        metadata: { ironkey_toggle_disabled: body.active ? '' : 'true' },
      })
      return NextResponse.json({ product: { id: productId, priceId: price.id, active: price.active } })
    }

    const update = {}
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
      await stripe.prices.update(body.priceUpdate.oldPriceId, { active: false, metadata: { ironkey_toggle_disabled: '' } })
    }
    if (body.archivePriceId) {
      if (await hasSingleActivePrice()) {
        // No toggle-disabled tag — the GET route treats an inactive product
        // with no tag as gone for good, same convention as an archived price
        // with no tag today.
        await stripe.products.update(productId, { active: false, metadata: { ironkey_toggle_disabled: '' } })
      } else {
        await stripe.prices.update(body.archivePriceId, { active: false, metadata: { ironkey_toggle_disabled: '' } })
      }
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
