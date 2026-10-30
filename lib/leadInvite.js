import { createHmac, timingSafeEqual } from 'crypto'

// Signed "join invite" links for leads. The token carries only IDs and an
// expiry — never the lead's name/email/phone — so no personal data sits in an
// emailed URL. The join page exchanges it at GET /api/[gymSlug]/join/invite
// for the prefill fields.

const TTL_SECONDS = 30 * 24 * 60 * 60   // 30 days
const PURPOSE     = 'ironkey:lead-invite:v1'

function key() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  // Purpose-bound key so a lead-invite signature can never be reused elsewhere
  return createHmac('sha256', secret).update(PURPOSE).digest()
}

const sign = payloadB64 => createHmac('sha256', key()).update(payloadB64).digest('base64url')

/**
 * @param {{ gymId: string, guestProfileId: string }} ids
 * @returns {string} base64url(JSON { g, p, exp }) + '.' + HMAC-SHA256
 */
export function createLeadInviteToken({ gymId, guestProfileId }) {
  const payload = { g: gymId, p: guestProfileId, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${sign(payloadB64)}`
}

/**
 * Verify signature, expiry and that the token is for this gym.
 * @param {string | null} token
 * @param {string} gymId
 * @returns {{ gymId: string, guestProfileId: string } | null}
 */
export function verifyLeadInviteToken(token, gymId) {
  try {
    if (typeof token !== 'string') return null
    const [payloadB64, sig, ...rest] = token.split('.')
    if (!payloadB64 || !sig || rest.length) return null
    const expected = Buffer.from(sign(payloadB64))
    const actual   = Buffer.from(sig)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) return null
    if (payload.g !== gymId || !payload.p) return null
    return { gymId: payload.g, guestProfileId: payload.p }
  } catch {
    return null
  }
}

/** The gym's existing join page with the invite token. */
export function leadJoinLink(origin, gymSlug, token) {
  return `${origin}/${gymSlug}/join?invite=${encodeURIComponent(token)}`
}
