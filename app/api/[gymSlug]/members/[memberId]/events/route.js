import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, trainerMemberScope } from '@/lib/permissions'

/**
 * GET /api/[gymSlug]/members/[memberId]/events
 * Returns membership history events for a single member, oldest first.
 * Guarantees a "joined" entry exists — if no MembershipEvent of type "joined"
 * is recorded, a synthetic one is prepended using member.dateAccessed.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.view')
    if (errorResponse) return errorResponse

    // TRAINER is always limited to members from their own PT sessions
    const scope = await trainerMemberScope(ctx)
    if (scope && !scope.has(memberId)) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const gym = ctx.gym
    const member = await prisma.member.findFirst({
      where:  { id: memberId, gymId: gym.id },
      select: { dateAccessed: true, createdAt: true, dateFrozen: true, dateCanceled: true },
    })
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const real = await prisma.membershipEvent.findMany({
      where:   { memberId, gymId: gym.id },
      orderBy: { date: 'asc' },
      select:  { id: true, type: true, date: true },
    })

    const synthetic = []

    if (!real.some(e => e.type === 'joined')) {
      synthetic.push({ id: 'synthetic-joined', type: 'joined', date: member?.dateAccessed ?? member?.createdAt ?? null })
    }
    if (member?.dateFrozen && !real.some(e => e.type === 'frozen')) {
      synthetic.push({ id: 'synthetic-frozen', type: 'frozen', date: member.dateFrozen })
    }
    if (member?.dateCanceled && !real.some(e => e.type === 'canceled')) {
      synthetic.push({ id: 'synthetic-canceled', type: 'canceled', date: member.dateCanceled })
    }

    const events = [...real, ...synthetic].sort((a, b) => {
      if (!a.date) return -1
      if (!b.date) return  1
      return new Date(a.date) - new Date(b.date)
    })

    console.log('[members/events GET] gymSlug=%s memberId=%s real=%d synthetic=%d', gymSlug, memberId, real.length, synthetic.length)

    return NextResponse.json({ events })
  } catch (error) {
    console.error('[members/events GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
