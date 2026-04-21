/**
 * Per-gym pass type configuration.
 * Keys are gym slugs. Values are the PassType enum values allowed for that gym.
 * Used by both the guest-passes API route (POST validation) and the page UI (tabs/cards).
 */
export const GYM_PASS_TYPES = {
  'triumph-barbell':          ['SINGLE', 'THREE_PACK', 'FIVE_PACK', 'TEN_PACK'],
  'oasis-powerlifting-club':  ['SINGLE', 'VALUE', 'DELUXE'],
}

/**
 * Returns the allowed pass types for a gym slug.
 * Falls back to all known types if the gym isn't configured.
 */
export const ALL_PASS_TYPES = ['SINGLE', 'THREE_PACK', 'FIVE_PACK', 'TEN_PACK', 'VALUE', 'DELUXE']

export function getAllowedPassTypes(gymSlug) {
  return GYM_PASS_TYPES[gymSlug] ?? ALL_PASS_TYPES
}
