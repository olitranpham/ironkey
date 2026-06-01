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
