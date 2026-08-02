// Groups PT/programming membershipType variants into two general categories
// for display and filtering, without ever touching the stored value itself.
//
// Real per-gym data shapes this is built against:
//   - Triumph: webhook already collapses most signups to the bare values
//     'personal training' / 'programming' / 'personal training + programming',
//     but legacy/imported records can still hold a raw tier like
//     '1 session / week' or 'programming only'.
//   - Oasis: no such override exists — raw Stripe price nicknames (e.g.
//     '1 session/week') go straight into membershipType.
//   - Hydra: the webhook conflates PT and programming into one '<plan> + pt'
//     suffix — there's no stored signal to tell them apart, so '+ pt' is
//     treated as 'personal training' (the literal abbreviation used).

export const CATEGORY_OPTIONS = ['personal training', 'programming']

const BARE_CATEGORY_VALUES = new Set([
  'personal training',
  'programming',
  'personal training + programming',
])

/**
 * Classifies a raw Member.membershipType string into the single general
 * category it primarily belongs to, or null for a regular membership type
 * (general, student, flex, etc).
 */
export function classifyMembershipType(rawType) {
  const t = (rawType || '').toLowerCase().trim()
  if (!t) return null
  if (t.includes('personal training'))        return 'personal training'
  if (/\bsessions?\s*\/\s*week\b/.test(t))    return 'personal training'
  if (t.includes('+ pt') || t.includes('+pt')) return 'personal training'
  if (t.includes('program'))                  return 'programming'
  if (t.includes('communication'))            return 'programming'
  if (t.includes('coaching'))                 return 'programming'
  return null
}

/**
 * All categories a raw type belongs to. Usually one, but Triumph's compound
 * 'personal training + programming' belongs to both, so a member with that
 * type matches either filter selection.
 */
export function classifyMembershipTypeAll(rawType) {
  const t = (rawType || '').toLowerCase().trim()
  if (t === 'personal training + programming') return ['personal training', 'programming']
  const c = classifyMembershipType(t)
  return c ? [c] : []
}

/**
 * Display-only formatting: "personal training (1 session/week)" for a
 * specific tier, or just the bare category / lowercased raw type otherwise.
 */
export function formatMembershipTypeDisplay(rawType) {
  const t = (rawType || '').toLowerCase().trim()
  if (!t) return t
  if (BARE_CATEGORY_VALUES.has(t)) return t

  const category = classifyMembershipType(t)
  if (!category) return t

  const tier = t
    .replace(/\s*\+\s*pt\b/i, '')
    .replace(/\bpersonal training\b/i, '')
    .replace(/\bprogramming\b/i, '')
    .trim()

  return tier ? `${category} (${tier})` : category
}
