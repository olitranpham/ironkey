// Stripe product IDs that count as personal training (PT) revenue, per gym.
// Classification is by product ID only — never by product or price name.
// Bundles (e.g. Triumph "Personal Training + Membership") count in full.

export const PT_PRODUCT_IDS = {
  'triumph-barbell': new Set([
    'prod_UrUgF0FkeB0IJx', // personal training + membership
    'prod_UrtfMuPRgjfdsd', // programming + membership
    'prod_VORHFsyx7SQIZ7', // personal training — 1 client
    'prod_VLT3bpKaxS5Imn', // personal training — 2 clients
  ]),
  'hydra-athletic-co': new Set([
    'prod_UoBtsZTZOcp8it', // programming + private training
    'prod_UibCDN1vBqO2DX', // coaching/programs
    'prod_UnSVOSRMDGPtsK', // coaching/programs (non-members)
    'prod_VFZrQxuqjDjp84', // additional programming
    'prod_VGuqzBbo4YKF2F', // 5-pack personal training
    'prod_UqO5Dt4prfAyaE', // private training session — 1 hour
  ]),
  'oasis-boston': new Set([
    'prod_Uqf1w4GB1ESyRI', // personal training
    'prod_SPQiDT7b8oe29X', // oasis personal training package
    'prod_V0Vdl6bPgfqgud', // group training
    'prod_SPQjHYjKw89Wt2', // oasis group partner training package
  ]),
}

/** True when this Stripe product ID is PT for the gym. */
export function isPtProduct(gymSlug, productId) {
  return Boolean(productId) && (PT_PRODUCT_IDS[gymSlug]?.has(productId) ?? false)
}

// membershipType for an Oasis PT / group training subscription bought outside
// the join form (a Stripe payment link). Current prices use the strings the
// join form writes (the price nickname; "group training: " prefix for group).
// Legacy package prices have no nickname — mapped to the tier at that price.
const OASIS_PT_MEMBERSHIP_TYPES = {
  // personal training (prod_Uqf1w4GB1ESyRI) — same as the join form
  price_1TqxhBGdx1SSAW42sLB2dWPJ: '1 session/week',
  price_1TqxhvGdx1SSAW42DQsoOR7g: '2 sessions/week',
  price_1TqxiIGdx1SSAW42TT4pA9s7: '3 sessions/week',
  price_1UTpS9Gdx1SSAW42roW8ghub: '4 sessions / week',
  // oasis personal training package (prod_SPQiDT7b8oe29X) — legacy
  price_1RuGsuGdx1SSAW428X6XUkoN: '1 session/week',  // $447 / month
  price_1TdsJoGdx1SSAW42QTZDvIQt: '1 session/week',  // $447 / 4 weeks ("1x/ wk")
  price_1RuGsuGdx1SSAW42rsxVK7qw: '2 sessions/week', // $697 / month
  price_1TdsKZGdx1SSAW42sdJetkzH: '2 sessions/week', // $697 / 4 weeks
  price_1RuGsuGdx1SSAW42n9xMhFIN: '3 sessions/week', // $947 / month
  price_1TdsLoGdx1SSAW42FPViLkD6: '3 sessions/week', // $947 / 4 weeks
  price_1UIygGGdx1SSAW42FjSU8r5o: 'online personal training',
  // group training (prod_V0Vdl6bPgfqgud) — same as the join form
  price_1U0WmIGdx1SSAW42SdDW6pKV: 'group training: 1 session/week',
  price_1U0WmWGdx1SSAW42r8ltXr1w: 'group training: 2 sessions/week',
  price_1U0WmeGdx1SSAW42aheVKVko: 'group training: 3 sessions/week',
  // oasis group partner training package (prod_SPQjHYjKw89Wt2) — legacy
  price_1U0TjEGdx1SSAW42zs7ulLJk: 'group training: 1 session/week',  // $313 / 4 weeks
  price_1RUbs9Gdx1SSAW422M5qfozh: 'group training: 1 session/week',  // $313 / month ("4 Sessions")
  price_1U0ThxGdx1SSAW42bct0nI2L: 'group training: 2 sessions/week', // $488 / 4 weeks
  price_1RUbsNGdx1SSAW42lIbXhRRv: 'group training: 2 sessions/week', // $488 / month ("8 Sessions")
  price_1U0ThVGdx1SSAW42Yz3NHJJI: 'group training: 3 sessions/week', // $633 / 4 weeks
}

const OASIS_GROUP_PRODUCT_IDS = new Set(['prod_V0Vdl6bPgfqgud', 'prod_SPQjHYjKw89Wt2'])

/** membershipType for an Oasis PT price; a price not in the map falls back by product. */
export function oasisPtMembershipType(priceId, productId) {
  return OASIS_PT_MEMBERSHIP_TYPES[priceId]
    ?? (OASIS_GROUP_PRODUCT_IDS.has(productId) ? 'group training' : 'personal training')
}

/** "SEVDE KAZANCI" → "Sevde Kazanci"; mixed-case names are left as typed. */
export function titleCaseIfAllCaps(name) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!s || s !== s.toUpperCase() || s === s.toLowerCase()) return s
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

/** "Andrew C Farnitano" → { firstName: 'Andrew C', lastName: 'Farnitano' } */
export function splitFullName(name) {
  const parts = titleCaseIfAllCaps(name).split(' ').filter(Boolean)
  if (parts.length < 2) return { firstName: parts[0] ?? '', lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}
