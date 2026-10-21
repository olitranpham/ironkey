import { NextResponse } from 'next/server'
import { withGymContext } from '@/lib/auth/gymContext'
import { effectivePermissions } from '@/lib/permissions'

/**
 * GET /api/[gymSlug]/me
 * The calling gym user and their effective permissions — for UI gating.
 * Any active user of the gym may call this.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await withGymContext(request, gymSlug)
    if (errorResponse) return errorResponse

    const { user } = ctx
    return NextResponse.json({
      id:                user.id,
      email:             user.email,
      role:              user.role,
      permissions:       effectivePermissions(user),
      personalTrainerId: user.personalTrainerId ?? null,
    })
  } catch (error) {
    console.error('[me]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
