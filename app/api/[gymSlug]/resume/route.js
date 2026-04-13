import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function POST(request) {
  try {
    const gymId        = request.headers.get('x-gym-id')
    const { memberId } = await request.json()

    if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

    const existing = await prisma.member.findFirst({ where: { id: memberId, gymId } })
    if (!existing) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const now    = new Date()
    const member = await prisma.member.update({
      where: { id: memberId },
      data:  { status: 'ACTIVE', dateFrozen: null, updatedAt: now },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[resume]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
