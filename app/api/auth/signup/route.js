import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { hashPassword, signToken } from '@/lib/auth'

/**
 * POST /api/auth/signup
 * Body: { gymName, gymSlug, email, password }
 *
 * Creates a new Gym and an OWNER GymUser in one transaction.
 */
export async function POST(request) {
  try {
    const { gymName, gymSlug, email, password } = await request.json()

    if (!gymName || !gymSlug || !email || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(gymSlug)) {
      return NextResponse.json(
        { error: 'Slug may only contain lowercase letters, numbers, and hyphens' },
        { status: 400 },
      )
    }

    const hashed = await hashPassword(password)

    const { gym, user } = await prisma.$transaction(async (tx) => {
      const gym = await tx.gym.create({
        data: { name: gymName, slug: gymSlug },
      })

      const user = await tx.gymUser.create({
        data: { gymId: gym.id, email, password: hashed, role: 'OWNER' },
      })

      return { gym, user }
    })

    const token = signToken({ id: user.id, gymId: gym.id, role: user.role })

    return NextResponse.json(
      { token, gym: { id: gym.id, name: gym.name, slug: gym.slug }, role: user.role },
      { status: 201 },
    )
  } catch (error) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Gym slug or email already exists' }, { status: 409 })
    }
    console.error('[signup]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
