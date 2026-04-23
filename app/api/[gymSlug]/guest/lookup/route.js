import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/guest/lookup
 * Public — looks up a guest profile by email and returns passes remaining.
 * Body: { email }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const { email } = await request.json()

    if (!email?.trim()) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const normalizedEmail = email.trim().toLowerCase()

    const profile = await prisma.guestProfile.findUnique({
      where: { gymId_email: { gymId: gym.id, email: normalizedEmail } },
      select: { id: true, name: true, email: true },
    })

    if (!profile) {
      return NextResponse.json({ profile: null, passesLeft: 0 })
    }

    // Fetch all active packs with type info
    const activePasses = await prisma.guestPass.findMany({
      where: {
        gymId:          gym.id,
        guestProfileId: profile.id,
        passesLeft:     { gt: 0 },
      },
      select:  { passType: true, passesLeft: true },
      orderBy: { createdAt: 'asc' },
    })

    const PACK_TOTAL = { SINGLE: 1, THREE_PACK: 3, FIVE_PACK: 5, TEN_PACK: 10 }
    const passesLeft = activePasses.reduce((sum, p) => sum + (p.passesLeft ?? 0), 0)
    const packs = activePasses.map(p => ({
      passType:   p.passType,
      passesLeft: p.passesLeft,
      total:      PACK_TOTAL[p.passType] ?? p.passesLeft,
    }))

    return NextResponse.json({ profile: { id: profile.id, name: profile.name, email: profile.email }, passesLeft, packs })
  } catch (error) {
    console.error('[guest/lookup POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
