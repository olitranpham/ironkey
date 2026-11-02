import { OASIS_GUEST_PASS_PRODUCTS } from './oasisGuestPasses.js'

/**
 * Per-gym pass type configuration.
 * Keys are gym slugs. Values are the PassType enum values allowed for that gym.
 * Used by both the guest-passes API route (POST validation) and the page UI (tabs/cards).
 */
export const GYM_PASS_TYPES = {
  'triumph-barbell':          ['SINGLE', 'THREE_PACK', 'FIVE_PACK', 'TEN_PACK'],
  'oasis-boston':  ['SINGLE', 'VALUE', 'DELUXE'],
  // Kisi doesn't support time-bound guest access yet — disabled for now,
  // not a permanent decision.
  'dna-strength': [],
}

/**
 * Returns the allowed pass types for a gym slug.
 * Falls back to all known types if the gym isn't configured.
 */
export const ALL_PASS_TYPES = ['SINGLE', 'THREE_PACK', 'FIVE_PACK', 'TEN_PACK', 'VALUE', 'DELUXE']

export function getAllowedPassTypes(gymSlug) {
  return GYM_PASS_TYPES[gymSlug] ?? ALL_PASS_TYPES
}

/**
 * Guest-pass pack sizes by Stripe price ID, for gyms whose products carry no
 * `passes` metadata. Keyed by gym slug. Never inferred from product names.
 */
export const GUEST_PASS_PACK_SIZE_BY_PRICE = {
  'triumph-barbell': {
    price_1RsYgDIubCn5bIn0H7AiqfUj: 1,   // Day Pass — $15
    price_1SSmw0IubCn5bIn0d2MX99Qx: 3,   // 3-Pack   — $40
    price_1SSmwFIubCn5bIn0byq7WZ8s: 5,   // 5-Pack   — $60
    price_1SSmwQIubCn5bIn014WTPu1s: 10,  // 10-Pack  — $110
  },
}

/** Pack size per PassType enum value — the fallback for passes with no packSize. */
export const PASS_TYPE_PACK_SIZE = {
  SINGLE:     1,
  THREE_PACK: 3,
  FIVE_PACK:  5,
  TEN_PACK:   10,
  VALUE:      5,
  DELUXE:     10,
}

/**
 * Pack size for a purchased guest-pass price: the product's `passes`
 * metadata, then the gym's price-ID map, then (Oasis) its product-ID map.
 *
 * @param {string} gymSlug
 * @param {{ priceId?: string | null, product?: string | { id?: string, metadata?: object } | null }} item
 * @returns {number | null} null when the price isn't recognized
 */
export function resolvePackSize(gymSlug, { priceId, product }) {
  const fromMetadata = parseInt(typeof product === 'object' ? product?.metadata?.passes : '', 10)
  if (fromMetadata > 0) return fromMetadata
  const fromPrice = priceId ? GUEST_PASS_PACK_SIZE_BY_PRICE[gymSlug]?.[priceId] : null
  if (fromPrice) return fromPrice
  const productId = typeof product === 'string' ? product : product?.id
  return (productId && OASIS_GUEST_PASS_PRODUCTS[productId]?.passesLeft) || null
}

/** Passes in a GuestPass row's pack: its stored packSize, else its PassType. */
export function packSizeForPass(pass) {
  return pass.packSize ?? PASS_TYPE_PACK_SIZE[pass.passType] ?? 1
}
