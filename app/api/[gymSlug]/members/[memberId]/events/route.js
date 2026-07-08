import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/members/[memberId]/events
 * Returns membership history events for a single member, oldest first.
 * Guarantees a "joined" entry exists — if no MembershipEvent of type "joined"
 * is recorded, a synthetic one is prepended using member.dateAccessed.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = params

    const [gym, member] = await Promise.all([
      prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } }),
      prisma.member.findUnique({ where: { id: memberId }, select: { dateAccessed: true, createdAt: true } }),
    ])
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const events = await prisma.membershipEvent.findMany({
      where:   { memberId, gymId: gym.id },
      orderBy: { date: 'asc' },
      select:  { id: true, type: true, date: true },
    })

    const hasJoined = events.some(e => e.type === 'joined')

    if (!hasJoined) {
      const joinDate = member?.dateAccessed ?? member?.createdAt ?? null
      events.unshift({
        id:   'synthetic-joined',
        type: 'joined',
        date: joinDate,
      })
    }

    console.log('[members/events GET] gymSlug=%s memberId=%s events=%d hasJoined=%s', gymSlug, memberId, events.length, hasJoined)

    return NextResponse.json({ events })
  } catch (error) {
    console.error('[members/events GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
