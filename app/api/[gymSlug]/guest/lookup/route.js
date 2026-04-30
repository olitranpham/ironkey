import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/guest/lookup
 * Public — looks up a guest profile by email.
 * Checks whether the guest has signed a GuestWaiver for this specific gym.
 * Body: { email }
 * Returns: { profile, hasSignedWaiver, passesLeft, packs }
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

    const profile = await prisma.guest.findUnique({
      where:  { email: normalizedEmail },
      select: { id: true, name: true, email: true },
    })

    if (!profile) {
      return NextResponse.json({ profile: null, hasSignedWaiver: false, passesLeft: 0, packs: [] })
    }

    // Check if this guest has signed the waiver for THIS gym
    const waiver = await prisma.guestWaiver.findUnique({
      where: { guestProfileId_gymId: { guestProfileId: profile.id, gymId: gym.id } },
    })
    const hasSignedWaiver = Boolean(waiver)

    // Fetch active packs for this gym
    const activePasses = await prisma.guestVisit.findMany({
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

    return NextResponse.json({
      profile:        { id: profile.id, name: profile.name, email: profile.email },
      hasSignedWaiver,
      passesLeft,
      packs,
    })
  } catch (error) {
    console.error('[guest/lookup POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
