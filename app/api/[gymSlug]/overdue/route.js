import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/overdue
 * Body: { memberId }
 * Marks an ACTIVE member as OVERDUE.
 */
export async function POST(request) {
  try {
    const gymId    = request.headers.get('x-gym-id')
    const { memberId } = await request.json()

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

    const existing = await prisma.member.findFirst({ where: { id: memberId, gymId } })
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (existing.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Only active members can be marked as overdue' }, { status: 400 })
    }

    const now     = new Date()
    const updated = await prisma.member.update({
      where: { id: memberId },
      data:  { status: 'OVERDUE', updatedAt: now },
    })

    return NextResponse.json({ member: updated })
  } catch (error) {
    console.error('[overdue POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
