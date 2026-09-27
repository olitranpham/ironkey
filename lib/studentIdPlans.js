// Per-gym Stripe product IDs whose membership plan requires a student ID
// photo upload before checkout. Keyed by product ID (not name) so a staff
// rename can't silently drop the requirement — mirrors the reasoning behind
// HYDRA_STUDENT_MILITARY_EMT_PRODUCT_ID in /api/[gymSlug]/join.
//
// Hydra's bundled Student/Military/Police/EMT plan is a single product
// covering all three categories, and there's no signal at checkout time to
// tell them apart (staff assign the real category afterward via
// Member.studentCategory in the admin drawer). Its live product name has
// always contained "student" (currently "student membership"), so the prior
// name-based check already required an upload from every buyer of this plan
// regardless of category — this preserves that exact behavior by ID instead.
//
// Imported by both /api/[gymSlug]/join (to flag plans for the join form) and
// /api/[gymSlug]/join/checkout (to re-check server-side, not trusting the
// client) so the two can never drift out of sync.
export const STUDENT_ID_PRODUCT_IDS_BY_GYM = {
  'triumph-barbell': new Set([
    'prod_SmzwJLtKE9eXCN', // Student Membership
  ]),
  'oasis-boston': new Set([
    'prod_Ucv94U6uvm7am9', // Semiannual Student Membership
    'prod_Ucv729ZXdrh80c', // Student Membership
  ]),
  'hydra-athletic-co': new Set([
    'prod_Uc7pO4ZOBrs4AH', // bundled Student/Military/Police/EMT Membership
  ]),
}

export function planRequiresStudentId(gymSlug, productId) {
  return STUDENT_ID_PRODUCT_IDS_BY_GYM[gymSlug]?.has(productId) ?? false
}
