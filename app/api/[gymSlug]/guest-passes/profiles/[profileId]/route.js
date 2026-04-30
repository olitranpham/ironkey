import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/[gymSlug]/guest-passes/profiles/[profileId]
 * Updates a guest profile's name, phone, or accessCode (DB only — no Seam calls).
 * Seam codes for guests are managed exclusively by the checkin route.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, profileId } = await params
    const body = await request.json()

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    // Verify the profile has passes or a waiver for this gym (auth boundary)
    const profile = await prisma.guest.findFirst({
      where: {
        id: profileId,
        OR: [
          { passes:  { some: { gymId: gym.id } } },
          { waivers: { some: { gymId: gym.id } } },
        ],
      },
    })
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    const data = {}
    if (body.name        !== undefined) data.name       = body.name
    if (body.phone       !== undefined) data.phone      = body.phone
    if (body.accessCode  !== undefined) data.accessCode = body.accessCode
      ? String(body.accessCode).trim()
      : null

    const updated = await prisma.guest.update({
      where: { id: profileId },
      data,
    })

    return NextResponse.json({ profile: updated })
  } catch (error) {
    console.error('[guest-profile PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
