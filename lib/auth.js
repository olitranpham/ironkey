import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const JWT_SECRET = process.env.JWT_SECRET
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

// ─── Password helpers ─────────────────────────────────────────────────────────

/**
 * Hash a plain-text password.
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, 12)
}

/**
 * Compare a plain-text password against a bcrypt hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

/**
 * Sign a JWT containing the gym user's id, gymId, and role.
 * @param {{ id: string, gymId: string, role: string }} payload
 * @returns {string}
 */
export function signToken(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not set')
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

/**
 * Verify and decode a JWT.  Returns null if invalid / expired.
 * @param {string} token
 * @returns {{ id: string, gymId: string, role: string } | null}
 */
export function verifyToken(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not set')
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

/**
 * Extract a Bearer token from the Authorization header value.
 * @param {string | null} header
 * @returns {string | null}
 */
export function extractBearerToken(header) {
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7)
}
