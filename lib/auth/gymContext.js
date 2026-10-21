import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

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
 * Resolve the gym named in the URL and confirm the JWT's user belongs to it.
 *
 * Reads identity from the x-gym-* headers that middleware.js sets after
 * verifying the JWT — only call this from JWT-protected routes.
 *
 * @param {Request} request
 * @param {string}  gymSlug
 * @returns {Promise<{ gym: object, user: object }>}
 * @throws {GymContextError}
 */
export async function getGymContext(request, gymSlug) {
  const gym = gymSlug ? await prisma.gym.findUnique({ where: { slug: gymSlug } }) : null
  if (!gym) throw new GymContextError(404, 'Gym not found')

  const userId = request.headers.get('x-gym-user-id')
  const role   = (request.headers.get('x-gym-role') ?? '').toUpperCase()

  // Superadmin tokens carry no gym — they must impersonate a gym user instead.
  if (role === 'SUPERADMIN') {
    throw new GymContextError(403, 'Superadmin must impersonate a gym user')
  }

  const user = userId ? await prisma.gymUser.findUnique({ where: { id: userId } }) : null
  if (!user) throw new GymContextError(401, 'Unauthorized')

  // Deactivated accounts lose access immediately, even with an unexpired JWT.
  if (user.active === false) throw new GymContextError(401, 'Unauthorized')

  // 404 rather than 403 so we don't confirm another gym's slug exists.
  if (user.gymId !== gym.id) throw new GymContextError(404, 'Gym not found')

  return { gym, user }
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
