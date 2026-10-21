import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withGymContext } from '@/lib/auth/gymContext'

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { errorResponse } = await withGymContext(request, gymSlug)
    if (errorResponse) return errorResponse
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const checkins = await prisma.repGymPassCheckin.findMany({
      where:   { gymId: gym.id },
      orderBy: { createdAt: 'desc' },
      take:    200,
    })
    return NextResponse.json({ checkins })
  } catch (error) {
    console.error('[rep-gym-pass/checkins GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
