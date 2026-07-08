import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { formatPhone } from '@/lib/phone'

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
    if (body.name       !== undefined) data.name       = body.name
    if (body.email      !== undefined) data.email      = body.email?.trim().toLowerCase() || null
    if (body.phone      !== undefined) data.phone      = formatPhone(body.phone)
    if (body.accessCode !== undefined) data.accessCode = body.accessCode
      ? String(body.accessCode).trim()
      : null

    if (body.dateOfBirth  !== undefined)
      data.dateOfBirth  = body.dateOfBirth  === '' ? null : String(body.dateOfBirth).trim()
    if (body.address !== undefined)
      data.address = body.address === '' ? null : String(body.address).trim()
    if (body.emergencyContactName !== undefined)
      data.emergencyContactName = body.emergencyContactName === '' ? null : String(body.emergencyContactName).trim()
    if (body.emergencyContactPhone !== undefined)
      data.emergencyContactPhone = body.emergencyContactPhone === '' ? null : String(body.emergencyContactPhone).trim()
    if (body.emergencyContactRelationship !== undefined)
      data.emergencyContactRelationship = body.emergencyContactRelationship === '' ? null : String(body.emergencyContactRelationship).trim()

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
