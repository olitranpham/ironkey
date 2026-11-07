import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { setPriceActive, stripeErrorCopy } from '@/lib/stripePriceToggle'

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
 * - priceId + active: toggles just that ONE price — see setPriceActive
 *   (lib/stripePriceToggle): a non-default price is archived; the default
 *   price hands default_price to the newest other active price first; a
 *   product's only active price archives the product instead. Re-enable
 *   reverses it. Tagged (ironkey_toggle_disabled) so the GET route can tell
 *   "staff toggled this off" (stays visible, grayed out, re-enable
 *   available) apart from a price superseded by the edit-price flow below
 *   (archived for good, never shown again).
 * - passes: updates the number of guest passes stored in metadata.
 * - name: renames the product.
 * - archivePriceId: the delete/trash action — archived the same way as a
 *   disable (default_price moved first; a sole price archives the product),
 *   but untagged, so it's gone for good.
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
    const { errorResponse } = await requirePermission(request, gymSlug, 'products.manage')
    if (errorResponse) return errorResponse
    const body = await request.json()

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { stripeSecretKey: true },
    })
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    // ── Price-level active toggle ─────────────────────────────────────────
    if (typeof body.active === 'boolean' && body.priceId) {
      const result = await setPriceActive(stripe, productId, body.priceId, body.active)
      console.log('[stripe/products PATCH] %s product=%s price=%s active=%s archived=%s', gymSlug, productId, body.priceId, body.active, result.archived)
      return NextResponse.json({ product: { id: productId, priceId: body.priceId, active: result.active } })
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
      // Untagged — the GET route treats an archived price / product with no
      // toggle-disabled tag as gone for good
      await setPriceActive(stripe, productId, body.archivePriceId, false, { permanent: true })
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
    console.error('[stripe/products/[productId] PATCH]', error.type ?? '', error.code ?? '', error.message)
    const isStripe = Boolean(error.type?.startsWith?.('Stripe')) || error.code === 'price_product_mismatch'
    return NextResponse.json({ error: stripeErrorCopy(error) }, { status: isStripe ? 502 : 500 })
  }
}
