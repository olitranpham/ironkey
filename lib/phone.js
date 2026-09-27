/**
 * Formats a phone number string to (XXX) XXX-XXXX.
 * Strips all non-digits, drops a leading country code 1 if present (11 digits),
 * then formats if exactly 10 digits remain.
 * Returns the original value unchanged if it can't be formatted (e.g. blank, too short).
 */
export function formatPhone(raw) {
  if (!raw) return raw
  const digits = String(raw).replace(/\D/g, '')
  const ten = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits
  if (ten.length !== 10) return raw
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

/**
 * Converts a US phone number (any common format, or already E.164) to
 * strict E.164 (+1XXXXXXXXXX). Accepts 10 digits, or 11 digits with a
 * leading country code 1 — anything else returns null rather than guess,
 * so callers can treat that as "no usable phone" instead of sending a
 * malformed number to a downstream SMS step.
 */
export function toE164(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return null
}
