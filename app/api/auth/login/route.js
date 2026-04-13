import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyPassword, signToken } from '@/lib/auth'

/**
 * POST /api/auth/login
 * Body: { gymSlug, email, password }
 */
export async function POST(request) {
  try {
    const { gymSlug, email, password } = await request.json()

    if (!gymSlug || !email || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug } })

    if (!gym) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const user = await prisma.gymUser.findUnique({
      where: { gymId_email: { gymId: gym.id, email } },
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await verifyPassword(password, user.password)

    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken({ id: user.id, gymId: gym.id, role: user.role })

    return NextResponse.json({
      token,
      gym: { id: gym.id, name: gym.name, slug: gym.slug },
      role: user.role,
    })
  } catch (error) {
    console.error('[login]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
