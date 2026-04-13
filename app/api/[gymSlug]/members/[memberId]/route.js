import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const VALID_STATUSES = ['ACTIVE', 'FROZEN', 'CANCELLED']

/**
 * PATCH /api/[gymSlug]/members/[memberId]
 * Updates a member's status. Sets dateFrozen / dateCanceled if transitioning
 * into that status and the field isn't already set.
 */
export async function PATCH(request, { params }) {
  try {
    const gymId     = request.headers.get('x-gym-id')
    const { memberId } = params
    const body      = await request.json()
    const { status } = body

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const existing = await prisma.member.findFirst({
      where: { id: memberId, gymId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const now  = new Date()
    const data = { status, updatedAt: now }

    if (status === 'FROZEN'    && !existing.dateFrozen)   data.dateFrozen   = now
    if (status === 'CANCELLED' && !existing.dateCanceled) data.dateCanceled = now
    if (status === 'ACTIVE') {
      // Resuming — clear freeze date so it resets if frozen again later
      data.dateFrozen = null
    }

    const member = await prisma.member.update({
      where: { id: memberId },
      data,
      select: {
        id: true, status: true,
        dateFrozen: true, dateCanceled: true, updatedAt: true,
      },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[members/patch]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
