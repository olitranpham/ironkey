// Typed-signature rules for the waiver / agreement, shared by the signup
// forms (to disable submit) and the checkout APIs (to reject a bypass).

export const SIGNATURE_MISMATCH = 'signature must match your name'

/** Lowercased, trimmed, inner whitespace collapsed. */
export function normalizeSignature(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The name the signature has to match: the guardian's for a minor (the
 * guardian signs), otherwise the signer's own full name.
 *
 * @param {{ isMinor?: boolean, guardianName?: string, name?: string, firstName?: string, lastName?: string }} fields
 */
export function expectedSigner({ isMinor, guardianName, name, firstName, lastName }) {
  if (isMinor) return guardianName ?? ''
  return name || [firstName, lastName].filter(Boolean).join(' ')
}

/**
 * null when the signature is present and matches the expected signer,
 * else the error copy to show.
 */
export function signatureError(signatureName, fields) {
  const signed   = normalizeSignature(signatureName)
  const expected = normalizeSignature(expectedSigner(fields))
  if (!signed || !expected || signed !== expected) return SIGNATURE_MISMATCH
  return null
}

/** Stripe metadata values are capped at 500 characters. */
export function metadataValue(value) {
  return String(value ?? '').slice(0, 500)
}
