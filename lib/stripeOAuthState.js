import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const STATE_TTL_SECONDS = 10 * 60

function getSecret() {
  const secret = process.env.STRIPE_STATE_SECRET
  if (!secret) throw new Error('STRIPE_STATE_SECRET is not set')
  return secret
}

function sign(payloadB64, secret) {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

/**
 * Build a signed OAuth `state` value binding the Stripe Connect flow to one
 * gym and the user who started it.
 *
 * Format: base64url(JSON { gymId, userId, nonce, exp }) + '.' + base64url(HMAC-SHA256)
 *
 * @param {{ gymId: string, userId: string }} params
 * @returns {string}
 */
export function createStripeState({ gymId, userId }) {
  const secret  = getSecret()
  const payload = {
    gymId,
    userId,
    nonce: randomBytes(16).toString('base64url'),
    exp:   Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${sign(payloadB64, secret)}`
}

/**
 * Verify a `state` value from the Stripe OAuth callback.
 * Returns the payload if the signature is valid and it hasn't expired, else null.
 *
 * @param {string | null} state
 * @returns {{ gymId: string, userId: string, nonce: string, exp: number } | null}
 */
export function verifyStripeState(state) {
  try {
    const secret = process.env.STRIPE_STATE_SECRET
    if (!secret || typeof state !== 'string') return null

    const [payloadB64, sigB64, ...rest] = state.split('.')
    if (!payloadB64 || !sigB64 || rest.length) return null

    const expected = Buffer.from(sign(payloadB64, secret))
    const actual   = Buffer.from(sigB64)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (!payload?.gymId || !payload?.userId || typeof payload.exp !== 'number') return null
    if (Math.floor(Date.now() / 1000) > payload.exp) return null

    return payload
  } catch {
    return null
  }
}
