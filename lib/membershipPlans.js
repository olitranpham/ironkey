import Stripe from 'stripe'
import { OASIS_GYM_SLUG } from '@/lib/oasisGuestPasses'

// Oasis Boston membership products, by Stripe product ID (never by name).
// Shared by the join page plan list and the staff "change membership" control.
export const OASIS_MEMBERSHIP_PRODUCT_IDS = new Set([
  'prod_Ucv94U6uvm7am9', // Semiannual Student Membership
  'prod_Ucv9fkBOT5aDKS', // Semiannual General Membership
  'prod_Ucv729ZXdrh80c', // Student Membership
  'prod_Ucv6OCNGmeTpA7', // General Membership
  'prod_T4wCwq1jBQDqhy', // Flex Membership
])

/**
 * A product staff may switch a member onto: tagged ironkey_kind=membership
 * (any gym), or one of Oasis's membership product IDs. Must be active.
 */
export function isSwappableMembershipProduct(gymSlug, product) {
  if (!product || typeof product !== 'object' || !product.active) return false
  if (product.metadata?.ironkey_kind === 'membership') return true
  return gymSlug === OASIS_GYM_SLUG && OASIS_MEMBERSHIP_PRODUCT_IDS.has(product.id)
}

const describePrice = price => ({
  priceId:       price.id,
  productId:     typeof price.product === 'object' ? price.product.id : price.product,
  name:          typeof price.product === 'object' ? price.product.name : null,
  amount:        price.unit_amount,
  currency:      price.currency,
  interval:      price.recurring?.interval ?? null,
  intervalCount: price.recurring?.interval_count ?? 1,
})

/**
 * Everything the "change membership" control needs, using ONE read-only
 * subscriptions.retrieve plus a prices.list on the gym's own Stripe account.
 *
 * Result: { canChange: true, ... } or { canChange: false, reason, message }.
 * reason ∈ canceled | no_subscription | stripe_not_configured | stripe_error |
 *          external_subscription | multiple_items | no_plans
 *
 * @param {{ slug: string, stripeSecretKey: string | null }} gym
 * @param {{ status: string, stripeSubscriptionId: string | null, priceId: string | null }} member
 */
export async function getPlanChangeContext(gym, member) {
  const no = (reason, message) => ({ canChange: false, reason, message })

  if (member.status === 'CANCELED') return no('canceled', 'canceled memberships cannot be changed')
  if (!member.stripeSubscriptionId) return no('no_subscription', 'no stripe subscription on file for this member')
  if (!gym.stripeSecretKey)         return no('stripe_not_configured', 'stripe is not connected for this gym')

  const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

  let subscription
  try {
    subscription = await stripe.subscriptions.retrieve(member.stripeSubscriptionId, { expand: ['items.data.price.product'] })
  } catch (err) {
    return no('stripe_error', err.message || 'could not load the subscription from stripe')
  }

  // Only subscriptions created through our Connect app can be updated via the API
  const appId = typeof subscription.application === 'string' ? subscription.application : subscription.application?.id
  if (!process.env.STRIPE_CLIENT_ID || appId !== process.env.STRIPE_CLIENT_ID) {
    return no('external_subscription', 'this subscription was created outside ironkey and must be changed in stripe')
  }

  const items = subscription.items?.data ?? []
  const item  = items.length === 1 ? items[0] : items.find(i => i.price?.id === member.priceId)
  if (!item) return no('multiple_items', 'this subscription has several items — change it in stripe')

  const current = describePrice(item.price)

  // Same billing interval only: Stripe resets the billing cycle when the
  // interval changes, which would break "new price applies at next renewal".
  const options = []
  for await (const price of stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product'], limit: 100 })) {
    if (price.id === current.priceId) continue
    if (!isSwappableMembershipProduct(gym.slug, price.product)) continue
    if (price.recurring?.interval !== current.interval || (price.recurring?.interval_count ?? 1) !== current.intervalCount) continue
    if (price.currency !== current.currency) continue
    options.push(describePrice(price))
  }
  options.sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0))
  if (options.length === 0) return no('no_plans', 'no plans available')

  return {
    canChange:      true,
    subscriptionId: subscription.id,
    itemId:         item.id,
    current,
    options,
    effectiveAt:    subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    paused:         Boolean(subscription.pause_collection),
    stripe,
  }
}

/** membershipType string for a product — same as checkout: its name, lowercased. */
export const membershipTypeFor = productName => (productName ?? '').trim().toLowerCase()
