import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/members/[memberId]/events
 * Returns membership history events for a single member, newest first.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const events = await prisma.membershipEvent.findMany({
      where:   { memberId, gymId: gym.id },
      orderBy: { date: 'desc' },
      select:  { id: true, type: true, date: true },
    })

    console.log('[members/events GET] gymSlug=%s memberId=%s events=%d', gymSlug, memberId, events.length)

    return NextResponse.json({ events })
  } catch (error) {
    console.error('[members/events GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
