/**
 * Per-gym accent color configuration.
 * Keys are gym slugs. Values are partial theme overrides applied on top of the defaults.
 *
 * Structural styling (row dividers, column headers, avatars, status text, etc.) is handled
 * globally in each page component and is never gym-specific.
 *
 * Only accent colors for membership types and pass types are configurable here, because
 * those represent the gym's visual identity / product taxonomy.
 *
 * Usage in page components:
 *   const { membershipBorder, passTypeBorder } = getGymTheme(gymSlug)
 *
 * Future: replace GYM_THEMES entries with a DB lookup on Gym.brandColors.
 */

const DEFAULT_MEMBERSHIP_BORDER = {
  FOUNDING: 'border-zinc-400 text-zinc-300',
  GENERAL:  'border-blue-400 text-blue-400',
  STUDENT:  'border-yellow-400 text-yellow-400',
}

const DEFAULT_PASS_TYPE_BORDER = {
  SINGLE:     'border-zinc-400 text-zinc-300',
  THREE_PACK: 'border-blue-400 text-blue-400',
  FIVE_PACK:  'border-yellow-400 text-yellow-400',
  TEN_PACK:   'border-zinc-800 text-zinc-100',
  VALUE:      'border-amber-600/50 text-neutral-400',
  DELUXE:     'border-rose-400/50 text-neutral-400',
}

/**
 * Per-gym overrides. Each entry can override any subset of the default maps.
 *
 * Example:
 * 'some-gym-slug': {
 *   membershipBorder: { FOUNDING: 'border-emerald-400 text-emerald-300' },
 *   passTypeBorder:   { SINGLE: 'border-violet-400 text-violet-300' },
 * },
 */
const GYM_THEMES = {
  // 'triumph-barbell': { ... },
  // 'oasis-powerlifting-club': { ... },
}

export function getGymTheme(slug) {
  const override = GYM_THEMES[slug] ?? {}
  return {
    membershipBorder: { ...DEFAULT_MEMBERSHIP_BORDER, ...override.membershipBorder },
    passTypeBorder:   { ...DEFAULT_PASS_TYPE_BORDER,  ...override.passTypeBorder  },
  }
}
