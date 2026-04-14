/**
 * Edge-Runtime-safe JWT helpers used exclusively by middleware.js.
 * Uses the Web Crypto API (globalThis.crypto) — no external dependencies,
 * works in both Edge Runtime and Node.js 18+.
 */

// ── Base64url helpers ─────────────────────────────────────────────────────────

function base64UrlToBytes(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded  = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
  const binary  = atob(padded)
  const bytes   = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlToString(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded  = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
  return atob(padded)
}

// ── JWT verification ──────────────────────────────────────────────────────────

/**
 * Verify a HS256 JWT using the Web Crypto API.
 * Returns the payload if valid, null otherwise.
 * @param {string} token
 * @returns {Promise<object | null>}
 */
export async function verifyTokenEdge(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, sigB64] = parts

    const secret = process.env.JWT_SECRET
    if (!secret) return null

    // Import HMAC key
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )

    // Verify signature
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    )

    if (!valid) return null

    // Parse payload
    const payload = JSON.parse(base64UrlToString(payloadB64))

    // Check expiry
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null

    return payload
  } catch {
    return null
  }
}

// ── Bearer token extraction ───────────────────────────────────────────────────

/**
 * Extract the Bearer token from an Authorization header value.
 * Case-insensitive prefix match.
 * @param {string | null} header
 * @returns {string | null}
 */
export function extractBearerToken(header) {
  if (!header) return null
  const lower = header.toLowerCase()
  if (!lower.startsWith('bearer ')) return null
  return header.slice(7).trim()
}
