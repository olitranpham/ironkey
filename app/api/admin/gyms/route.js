import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'

/**
 * GET /api/admin/gyms
 * Returns all gyms with per-status member counts.
 */
export async function GET() {
  try {
    const [gyms, statusCounts] = await Promise.all([
      prisma.gym.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, name: true, slug: true,
          stripeAccountId: true,
          seamApiKey: true,
          seamDeviceId: true,
          createdAt: true,
        },
      }),
      prisma.member.groupBy({
        by: ['gymId', 'status'],
        _count: { id: true },
      }),
    ])

    // Build a counts map: { [gymId]: { ACTIVE: n, FROZEN: n, ... } }
    const countsMap = {}
    for (const row of statusCounts) {
      if (!countsMap[row.gymId]) countsMap[row.gymId] = {}
      countsMap[row.gymId][row.status] = row._count.id
    }

    const result = gyms.map(gym => ({
      id:           gym.id,
      name:         gym.name,
      slug:         gym.slug,
      hasStripe:    Boolean(gym.stripeAccountId),
      hasSeam:      Boolean(gym.seamApiKey),
      seamDeviceId: gym.seamDeviceId ?? '',
      createdAt:    gym.createdAt,
      active:       countsMap[gym.id]?.ACTIVE    ?? 0,
      frozen:       countsMap[gym.id]?.FROZEN    ?? 0,
      canceled:     countsMap[gym.id]?.CANCELLED ?? 0,
      overdue:      countsMap[gym.id]?.OVERDUE   ?? 0,
    }))

    return NextResponse.json({ gyms: result })
  } catch (error) {
    console.error('[admin/gyms GET]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/gyms
 * Body: { gymName, email, password }
 * Creates a new Gym + OWNER GymUser.
 */
export async function POST(request) {
  try {
    const { gymName, email, password } = await request.json()

    if (!gymName?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: 'gymName, email, and password are required' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const slug   = gymName.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    const hashed = await bcrypt.hash(password, 12)

    const { gym } = await prisma.$transaction(async tx => {
      const gym = await tx.gym.create({ data: { name: gymName.trim(), slug } })
      await tx.gymUser.create({ data: { gymId: gym.id, email: email.trim(), password: hashed, role: 'OWNER' } })
      return { gym }
    })

    return NextResponse.json({
      gym: { id: gym.id, name: gym.name, slug: gym.slug, hasStripe: false, hasSeam: false, active: 0, frozen: 0, canceled: 0, overdue: 0 },
    }, { status: 201 })
  } catch (error) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A gym with that slug or email already exists' }, { status: 409 })
    }
    console.error('[admin/gyms POST]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
