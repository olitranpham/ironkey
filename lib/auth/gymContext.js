import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken, extractBearerToken } from '@/lib/auth'

/**
 * Thrown by getGymContext when the caller may not act on the requested gym.
 * `status` is the HTTP status the route should respond with.
 */
export class GymContextError extends Error {
  constructor(status, message) {
    super(message)
    this.name   = 'GymContextError'
    this.status = status
  }
}

/**
 * Shared checks: gym exists, caller isn't a bare superadmin, user exists,
 * is active, and belongs to this gym.
 * @returns {Promise<{ gym: object, user: object, impersonatedBy: string | null }>}
 */
async function resolveGymContext(gymSlug, { userId, role, impersonatedBy }) {
  const gym = gymSlug ? await prisma.gym.findUnique({ where: { slug: gymSlug } }) : null
  if (!gym) throw new GymContextError(404, 'Gym not found')

  // Superadmin tokens carry no gym — they must impersonate a gym user instead.
  if ((role ?? '').toUpperCase() === 'SUPERADMIN') {
    throw new GymContextError(403, 'Superadmin must impersonate a gym user')
  }

  const user = userId ? await prisma.gymUser.findUnique({ where: { id: userId } }) : null
  if (!user) throw new GymContextError(401, 'Unauthorized')

  // Deactivated accounts lose access immediately, even with an unexpired JWT.
  if (user.active === false) throw new GymContextError(401, 'Unauthorized')

  // 404 rather than 403 so we don't confirm another gym's slug exists.
  if (user.gymId !== gym.id) throw new GymContextError(404, 'Gym not found')

  return { gym, user, impersonatedBy: impersonatedBy || null }
}

/**
 * Resolve the gym named in the URL and confirm the JWT's user belongs to it.
 *
 * Reads identity from the x-gym-* headers that middleware.js sets after
 * verifying the JWT — only call this from JWT-protected routes. (Middleware
 * strips client-sent x-gym-* everywhere, so on public routes they're absent.)
 *
 * @param {Request} request
 * @param {string}  gymSlug
 * @returns {Promise<{ gym: object, user: object, impersonatedBy: string | null }>}
 * @throws {GymContextError}
 */
export async function getGymContext(request, gymSlug) {
  return resolveGymContext(gymSlug, {
    userId:         request.headers.get('x-gym-user-id'),
    role:           request.headers.get('x-gym-role'),
    // Set by middleware from the JWT's impersonatedBy claim (superadmin impersonation)
    impersonatedBy: request.headers.get('x-gym-impersonated-by'),
  })
}

/**
 * Same as getGymContext, but verifies the request's Bearer JWT itself instead
 * of trusting middleware headers. For public routes that optionally accept a
 * staff token (middleware does not verify tokens there).
 *
 * @param {Request} request
 * @param {string}  gymSlug
 * @returns {Promise<{ gym: object, user: object, impersonatedBy: string | null }>}
 * @throws {GymContextError} 401 if the token is missing, invalid or expired
 */
export async function getGymContextFromToken(request, gymSlug) {
  const token   = extractBearerToken(request.headers.get('authorization'))
  const payload = token ? verifyToken(token) : null
  if (!payload) throw new GymContextError(401, 'Invalid or expired token')

  return resolveGymContext(gymSlug, {
    userId:         payload.id,
    role:           payload.role,
    impersonatedBy: payload.impersonatedBy,
  })
}

/**
 * Route-friendly wrapper: returns { ctx } on success, or { errorResponse }
 * (a NextResponse JSON error) when access is denied. Unexpected errors
 * are rethrown so the route's own catch handles them.
 *
 *   const { ctx, errorResponse } = await withGymContext(request, gymSlug)
 *   if (errorResponse) return errorResponse
 */
export async function withGymContext(request, gymSlug) {
  try {
    return { ctx: await getGymContext(request, gymSlug) }
  } catch (err) {
    if (err instanceof GymContextError) {
      return { errorResponse: NextResponse.json({ error: err.message }, { status: err.status }) }
    }
    throw err
  }
}
