export const VALID_GRAD_SEMESTERS = ['Fall', 'Spring', 'Summer']

/**
 * Normalizes a graduation semester string to its canonical capitalized form
 * ("fall"/"FALL"/"Fall" → "Fall") so stored values always match the member
 * profile drawer's <option> values. Returns null for empty/unrecognized input.
 */
export function normalizeGradSemester(value) {
  if (!value) return null
  const trimmed = String(value).trim()
  return VALID_GRAD_SEMESTERS.find(v => v.toLowerCase() === trimmed.toLowerCase()) ?? null
}
