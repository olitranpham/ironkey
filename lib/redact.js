// Log redaction helpers. For console output only — never use these to
// change what is stored, sent to Stripe/Seam, or returned to a client.

const SENSITIVE_KEY = /key|secret|token|password|pin|code|webhook/i

/**
 * "sk_live_abc123…" → "sk_live…" (first 7 chars). Empty / missing → "[unset]".
 * @param {unknown} v
 * @returns {string}
 */
export function maskSecret(v) {
  if (v === undefined || v === null || v === '') return '[unset]'
  return String(v).slice(0, 7) + '…'
}

/**
 * Door PIN "482913" → "••13" (last 2 digits only). Empty / missing → "[unset]".
 * @param {unknown} v
 * @returns {string}
 */
export function maskPin(v) {
  if (v === undefined || v === null || v === '') return '[unset]'
  return '••' + String(v).slice(-2)
}

/**
 * Deep copy of `obj` with the value of every key matching
 * /key|secret|token|password|pin|code|webhook/i (or named in extraKeys)
 * replaced by "[redacted]" — at any depth, including inside arrays. The
 * original object is not modified.
 * @param {unknown}  obj
 * @param {string[]} [extraKeys]
 * @returns {unknown}
 */
export function redactObject(obj, extraKeys = []) {
  const extra = new Set(extraKeys.map((k) => String(k).toLowerCase()))
  const seen = new WeakSet()
  const isSensitive = (k) => SENSITIVE_KEY.test(k) || extra.has(String(k).toLowerCase())

  function walk(v) {
    if (v === null || typeof v !== 'object') return v
    if (v instanceof Date) return new Date(v.getTime())
    if (seen.has(v)) return '[circular]'
    seen.add(v)
    if (Array.isArray(v)) return v.map(walk)
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = isSensitive(k) ? '[redacted]' : walk(val)
    return out
  }
  return walk(obj)
}

/**
 * A raw response body (e.g. a Seam error from res.text()) for logging:
 * JSON is parsed and passed through redactObject; anything else is not
 * echoed, only its length (it could carry a code we can't find).
 * @param {string} text
 * @returns {unknown}
 */
export function redactJsonText(text) {
  try { return redactObject(JSON.parse(text)) } catch { return `[non-JSON body, ${String(text ?? '').length} chars]` }
}
