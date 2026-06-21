import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/[gymSlug]/guest-passes/[passId]
 * Body: { passesLeft: number }
 * Lets staff manually adjust the remaining check-ins on a multi-pass.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, passId } = await params
    const body = await request.json()

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const existing = await prisma.guestVisit.findFirst({
      where: { id: passId, gymId: gym.id },
    })
    if (!existing) return NextResponse.json({ error: 'Pass not found' }, { status: 404 })

    const { passesLeft } = body
    if (passesLeft === undefined || passesLeft === null) {
      return NextResponse.json({ error: 'passesLeft is required' }, { status: 400 })
    }

    const val = parseInt(passesLeft, 10)
    if (isNaN(val) || val < 0) {
      return NextResponse.json({ error: 'passesLeft must be a non-negative integer' }, { status: 400 })
    }

    const pass = await prisma.guestVisit.update({
      where:  { id: passId },
      data:   { passesLeft: val },
      select: {
        id:             true,
        passType:       true,
        passesLeft:     true,
        usedAt:         true,
        expiresAt:      true,
        createdAt:      true,
        guestProfileId: true,
      },
    })

    console.log('[guest-passes/%s PATCH] passesLeft set to %s', passId, val)
    return NextResponse.json({ pass })
  } catch (error) {
    console.error('[guest-passes/passId PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
