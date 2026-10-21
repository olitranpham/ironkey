import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { getGymContextFromToken, GymContextError } from '@/lib/auth/gymContext'
import { verifyToken, extractBearerToken } from '@/lib/auth'
import { can, forbidden } from '@/lib/permissions'

/**
 * True when the request's x-webhook-secret header matches WEBHOOK_SECRET.
 * Always false if WEBHOOK_SECRET is unset or the header is missing.
 * @param {Request} request
 * @returns {boolean}
 */
export function checkWebhookSecret(request) {
  const expected = process.env.WEBHOOK_SECRET
  const provided = request.headers.get('x-webhook-secret')
  if (!expected || !provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * True when the Bearer token equals WEBHOOK_SECRET — the format .env.example
 * originally documented for Zapier. Accepted for compatibility.
 */
function isLegacyBearerSecret(request) {
  const expected = process.env.WEBHOOK_SECRET
  const token    = extractBearerToken(request.headers.get('authorization'))
  if (!expected || !token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Gate for public intake routes that accept EITHER a staff JWT (verified
 * here, never from headers) with `perm`, OR a valid webhook secret.
 *
 *  - Bearer JWT that verifies → must be for this gym, active, with `perm` (403/404/401 otherwise)
 *  - else valid x-webhook-secret (or legacy `Bearer <WEBHOOK_SECRET>`) → allowed
 *  - else WEBHOOK_ENFORCE === 'true' → 401
 *  - else allowed with a console.warn (rollout mode)
 *
 * @param {Request} request
 * @param {string}  gymSlug
 * @param {string}  perm       — permission a staff token must hold
 * @param {string}  routeLabel — for the unauthenticated-call warning
 * @returns {Promise<{ via: 'jwt' | 'secret' | 'unauthenticated', ctx?: object } | { errorResponse: NextResponse }>}
 */
export async function authorizeIntake(request, gymSlug, perm, routeLabel) {
  const token = extractBearerToken(request.headers.get('authorization'))
  if (token && verifyToken(token)) {
    try {
      const ctx = await getGymContextFromToken(request, gymSlug)
      if (!can(ctx.user, perm)) return { errorResponse: forbidden() }
      return { via: 'jwt', ctx }
    } catch (err) {
      if (err instanceof GymContextError) {
        return { errorResponse: NextResponse.json({ error: err.message }, { status: err.status }) }
      }
      throw err
    }
  }

  if (checkWebhookSecret(request)) return { via: 'secret' }

  if (isLegacyBearerSecret(request)) {
    console.warn('[webhook-legacy-bearer] route=%s gym=%s — send the secret as x-webhook-secret', routeLabel, gymSlug)
    return { via: 'secret' }
  }

  if (process.env.WEBHOOK_ENFORCE === 'true') {
    return { errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  console.warn('[webhook-unauth] route=%s gym=%s', routeLabel, gymSlug)
  return { via: 'unauthenticated' }
}
