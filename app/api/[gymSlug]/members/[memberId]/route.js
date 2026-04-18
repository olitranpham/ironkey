import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const VALID_STATUSES = ['ACTIVE', 'FROZEN', 'CANCELLED']

/**
 * PATCH /api/[gymSlug]/members/[memberId]
 * Updates a member's status and/or accessCode.
 */
export async function PATCH(request, { params }) {
  try {
    const gymId        = request.headers.get('x-gym-id')
    const { memberId } = params
    const body         = await request.json()
    const { status, accessCode } = body

    const existing = await prisma.member.findFirst({
      where: { id: memberId, gymId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const now  = new Date()
    const data = { updatedAt: now }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      data.status = status
      if (status === 'FROZEN'    && !existing.dateFrozen)   data.dateFrozen   = now
      if (status === 'CANCELLED' && !existing.dateCanceled) data.dateCanceled = now
      if (status === 'ACTIVE')                              data.dateFrozen   = null
    }

    if (accessCode !== undefined) {
      data.accessCode = accessCode === '' ? null : String(accessCode).trim()
    }

    const member = await prisma.member.update({
      where: { id: memberId },
      data,
      select: {
        id: true, status: true, accessCode: true,
        dateFrozen: true, dateCanceled: true, updatedAt: true,
      },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[members/patch]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
