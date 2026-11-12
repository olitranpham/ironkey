import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { signToken } from '@/lib/auth'
import { clientIp } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'

/**
 * POST /api/admin/gyms/[gymId]/impersonate
 * Returns a short-lived (1h) JWT scoped to the gym's owner so the super-admin
 * can open that gym's staff portal directly. Carries impersonatedBy: 'SUPERADMIN'.
 */
export async function POST(request, { params }) {
  try {
    const { gymId } = await params

    const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { id: true, name: true, slug: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    // Prefer OWNER, fall back to any user in the gym
    const user =
      (await prisma.gymUser.findFirst({ where: { gymId, role: 'OWNER' } })) ??
      (await prisma.gymUser.findFirst({ where: { gymId } }))

    if (!user) {
      return NextResponse.json({ error: 'No users found for this gym' }, { status: 404 })
    }

    const token = signToken(
      { id: user.id, gymId: gym.id, role: user.role, impersonatedBy: 'SUPERADMIN' },
      { expiresIn: '1h' },
    )

    // Who was impersonated, when and from where (actor null = superadmin)
    writeAudit({ gym, user: null }, 'admin.impersonate_start', 'GymUser', user.id, {
      impersonatedBy: 'SUPERADMIN',
      targetRole:     user.role,
      startedAt:      new Date().toISOString(),
      ip:             clientIp(request),
      expiresIn:      '1h',
    })

    return NextResponse.json({
      token,
      gym:  { id: gym.id, name: gym.name, slug: gym.slug },
      role: user.role,
    })
  } catch (error) {
    console.error('[admin/impersonate]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
