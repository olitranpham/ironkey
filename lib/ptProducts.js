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
