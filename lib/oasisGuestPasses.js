// Oasis Boston guest passes, keyed by Stripe product ID (never by name).
// Single source for the kiosk listing, the staff products page, checkout and
// the platform Stripe webhook.

export const OASIS_GYM_SLUG = 'oasis-boston'

export const OASIS_GUEST_PASS_PRODUCTS = {
  'prod_UdG5qNSMCuYDhN': { passType: 'SINGLE', passesLeft: 1  }, // Single — $22.50
  'prod_UdG5tLURJQAEog': { passType: 'VALUE',  passesLeft: 5  }, // Value  — $85
  'prod_UdG5qpIhMMjmyA': { passType: 'DELUXE', passesLeft: 10 }, // Deluxe — $135
}

/**
 * True for an Oasis guest-pass product: one of the mapped product IDs, or a
 * product created on the staff products page (metadata.ironkey_kind ===
 * 'guest_pass', e.g. the student pass). Same rule the kiosk uses to list them.
 *
 * @param {string | { id?: string, metadata?: object } | null | undefined} product — a product object or ID
 * @returns {boolean}
 */
export function isOasisGuestPassProduct(product) {
  if (!product) return false
  if (typeof product === 'string') return product in OASIS_GUEST_PASS_PRODUCTS
  return (product.id in OASIS_GUEST_PASS_PRODUCTS) || product.metadata?.ironkey_kind === 'guest_pass'
}
