import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const MEMBER_SELECT = { id: true, firstName: true, lastName: true }

function flattenMembers(session) {
  return { ...session, members: session.members.map(sm => sm.member) }
}

export async function PATCH(request, { params }) {
  try {
    const { gymSlug, sessionId } = await params
    const body = await request.json()

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const existing = await prisma.pTSession.findFirst({ where: { id: sessionId, gymId: gym.id } })
    if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const data = {}
    if (body.trainerId       !== undefined) data.trainerId       = body.trainerId
    if (body.title           !== undefined) data.title           = body.title?.trim() || null
    if (body.date            !== undefined) data.date            = new Date(body.date)
    if (body.durationMinutes !== undefined) data.durationMinutes = Number(body.durationMinutes)
    if (body.notes           !== undefined) data.notes           = body.notes?.trim() || null

    // Replace member list: delete all existing join rows, create new ones
    if (body.memberIds !== undefined) {
      data.members = {
        deleteMany: {},
        create: body.memberIds.map(memberId => ({ memberId })),
      }
    }

    const raw = await prisma.pTSession.update({
      where:   { id: sessionId },
      data,
      include: {
        trainer: true,
        members: { include: { member: { select: MEMBER_SELECT } } },
      },
    })

    return NextResponse.json({ session: flattenMembers(raw) })
  } catch (error) {
    console.error('[pt-sessions PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { gymSlug, sessionId } = await params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const existing = await prisma.pTSession.findFirst({ where: { id: sessionId, gymId: gym.id } })
    if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    await prisma.pTSession.delete({ where: { id: sessionId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[pt-sessions DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
