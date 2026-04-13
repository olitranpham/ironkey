/**
 * Edge-Runtime-safe JWT helpers used exclusively by middleware.js.
 * Uses jose (Web Crypto API) instead of jsonwebtoken (Node.js crypto).
 *
 * lib/auth.js keeps jsonwebtoken for API routes, which run in Node.js runtime.
 */
import { jwtVerify } from 'jose'

function secret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

/**
 * Verify a JWT and return its payload, or null if invalid/expired.
 * @param {string} token
 * @returns {Promise<{ id: string, gymId: string, role: string } | null>}
 */
export async function verifyTokenEdge(token) {
  try {
    const { payload } = await jwtVerify(token, secret())
    return payload
  } catch {
    return null
  }
}

/**
 * Extract the Bearer token from an Authorization header value.
 * @param {string | null} header
 * @returns {string | null}
 */
export function extractBearerToken(header) {
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7)
}
