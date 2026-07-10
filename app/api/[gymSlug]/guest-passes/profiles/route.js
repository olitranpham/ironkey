import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/guest-passes/profiles?email=...
 * Looks up a guest profile by email for this gym.
 * Used by the partner check-ins page to open the guest profile drawer.
 * Auth boundary: guest must have passes, waivers, OR a rep gym pass check-in for this gym.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')?.trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const guest = await prisma.guest.findUnique({
      where: { email },
      include: {
        passes: {
          where:   { gymId: gym.id },
          orderBy: { usedAt: 'desc' },
        },
      },
    })
    if (!guest) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Verify gym association: passes, waivers, or rep gym pass check-in
    if (guest.passes.length === 0) {
      const repCheckinCount = await prisma.repGymPassCheckin.count({ where: { userEmail: email, gymId: gym.id } })
      if (repCheckinCount === 0) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }
    }

    return NextResponse.json({ profile: guest })
  } catch (error) {
    console.error('[guest-passes/profiles GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
