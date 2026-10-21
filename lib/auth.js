import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'crypto'

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

// ─── Superadmin credentials ───────────────────────────────────────────────────

function safeEqual(a, b) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * True when superadmin login is configured: ADMIN_EMAIL plus either
 * ADMIN_PASSWORD_HASH (preferred) or the legacy plaintext ADMIN_PASSWORD.
 * @returns {boolean}
 */
export function isSuperadminConfigured() {
  return Boolean(process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD))
}

/**
 * Check email/password against the superadmin env vars.
 * Uses bcrypt against ADMIN_PASSWORD_HASH; falls back to a plaintext
 * ADMIN_PASSWORD comparison (with a warning) only when the hash is unset.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function verifySuperadminCredentials(email, password) {
  const adminEmail = process.env.ADMIN_EMAIL
  const adminHash  = process.env.ADMIN_PASSWORD_HASH
  const adminPlain = process.env.ADMIN_PASSWORD
  if (!adminEmail || (!adminHash && !adminPlain)) return false

  // Bail before bcrypt for non-admin emails — /api/auth/login runs this
  // ahead of every gym-user login.
  if (!safeEqual(email, adminEmail)) return false

  if (adminHash) {
    // Fail closed on a malformed hash (e.g. `$` segments eaten by .env expansion)
    if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(adminHash)) {
      console.error('[auth] ADMIN_PASSWORD_HASH is set but is not a valid bcrypt hash — superadmin login rejected')
      return false
    }
    return bcrypt.compare(password, adminHash)
  }

  console.warn('[auth] ADMIN_PASSWORD_HASH is not set — falling back to plaintext ADMIN_PASSWORD comparison')
  return safeEqual(password, adminPlain)
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
