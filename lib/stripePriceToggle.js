// Disable / re-enable / delete one price from the products page, on the
// gym's connected account, without tripping Stripe's "price cannot be
// archived because it is the default price of its product".

// Set on the product when we move default_price off a price we disabled, so
// re-enabling that price can put it back
const PREV_DEFAULT_KEY = 'ironkey_prev_default_price'

const idOf = v => (typeof v === 'string' ? v : v?.id ?? null)

/**
 * Disable (active: false) or re-enable (active: true) a single price.
 *
 * Disable:
 *  - not the product's default_price → archive the price
 *  - the default, other active prices exist → default_price moves to the
 *    newest other active price (the original is kept in product metadata),
 *    then the price is archived
 *  - the product's only active price → archive the product, price untouched
 * Re-enable reverses it: unarchive the product and/or the price, and give
 * the price back its default_price if we moved it.
 *
 * `permanent` (the delete action) archives the same way but without the
 * ironkey_toggle_disabled tag, so the products list drops the row for good.
 *
 * @returns {Promise<{ active: boolean, archived: 'price'|'product'|null }>}
 */
export async function setPriceActive(stripe, productId, priceId, active, { permanent = false } = {}) {
  const tag = { ironkey_toggle_disabled: active || permanent ? '' : 'true' }
  const [price, product] = await Promise.all([
    stripe.prices.retrieve(priceId),
    stripe.products.retrieve(productId),
  ])
  if (idOf(price.product) !== productId) throw Object.assign(new Error('price does not belong to product'), { code: 'price_product_mismatch' })

  if (active) {
    if (!product.active) await stripe.products.update(productId, { active: true, metadata: tag })
    if (!price.active)   await stripe.prices.update(priceId, { active: true, metadata: tag })
    if (product.metadata?.[PREV_DEFAULT_KEY] === priceId) {
      await stripe.products.update(productId, { default_price: priceId, metadata: { [PREV_DEFAULT_KEY]: '' } })
    }
    return { active: true, archived: null }
  }

  if (idOf(product.default_price) !== priceId) {
    await stripe.prices.update(priceId, { active: false, metadata: tag })
    return { active: false, archived: 'price' }
  }

  const others = (await stripe.prices.list({ product: productId, active: true, limit: 100 })).data
    .filter(p => p.id !== priceId)
    .sort((a, b) => b.created - a.created)
  if (others.length) {
    await stripe.products.update(productId, {
      default_price: others[0].id,
      metadata:      { [PREV_DEFAULT_KEY]: permanent ? '' : priceId },
    })
    await stripe.prices.update(priceId, { active: false, metadata: tag })
    return { active: false, archived: 'price' }
  }

  // Its only active price — the product itself goes; the price stays as is
  await stripe.products.update(productId, { active: false, metadata: tag })
  return { active: false, archived: 'product' }
}

/** Plain lowercase copy for a Stripe failure — never Stripe's raw message. */
export function stripeErrorCopy(err) {
  if (err?.code === 'price_product_mismatch') return "that price doesn't belong to this product — refresh and try again"
  switch (err?.type) {
    case 'StripeRateLimitError':      return 'stripe is busy right now — please try again in a minute'
    case 'StripePermissionError':
    case 'StripeAuthenticationError': return "ironkey can't update this gym's stripe account — reconnect stripe in settings"
    case 'StripeConnectionError':
    case 'StripeAPIError':            return "couldn't reach stripe — please try again"
    case 'StripeInvalidRequestError':
      if (err.code === 'resource_missing') return 'this product no longer exists in stripe — refresh the page'
      return "stripe couldn't make that change — refresh the page and try again"
    default:                          return 'something went wrong — please try again'
  }
}

/**
 * The first of the given price IDs that can't be bought right now (the price
 * or its product is disabled / archived), or null when all are live.
 */
export async function findUnavailablePrice(stripe, priceIds) {
  for (const id of priceIds.filter(Boolean)) {
    const price = await stripe.prices.retrieve(id, { expand: ['product'] })
    if (!price.active || !price.product?.active) return id
  }
  return null
}
