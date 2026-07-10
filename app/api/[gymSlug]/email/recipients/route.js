import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/email/recipients
 * Returns all active members' names and emails for this gym.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const members = await prisma.member.findMany({
      where:   { gymId: gym.id, status: 'ACTIVE' },
      select:  { id: true, firstName: true, lastName: true, email: true },
      orderBy: { lastName: 'asc' },
    })

    return NextResponse.json({ members })
  } catch (error) {
    console.error('[email/recipients GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
