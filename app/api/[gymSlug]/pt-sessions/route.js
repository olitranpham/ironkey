import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const MEMBER_SELECT = { id: true, firstName: true, lastName: true }

// Flatten PTSessionMember join rows → plain member objects
function flattenMembers(session) {
  return { ...session, members: session.members.map(sm => sm.member) }
}

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const raw = await prisma.pTSession.findMany({
      where:   { gymId: gym.id },
      orderBy: { date: 'desc' },
      include: {
        trainer: true,
        members: { include: { member: { select: MEMBER_SELECT } } },
      },
    })

    return NextResponse.json({ sessions: raw.map(flattenMembers) })
  } catch (error) {
    console.error('[pt-sessions GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()
    const { trainerId, memberIds, title, date, durationMinutes, notes } = body ?? {}

    if (!trainerId || !memberIds?.length || !date)
      return NextResponse.json({ error: 'trainerId, memberIds, and date are required' }, { status: 400 })

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const raw = await prisma.pTSession.create({
      data: {
        gym:             { connect: { id: gym.id } },
        trainer:         { connect: { id: trainerId } },
        members:         { create: memberIds.map(memberId => ({ memberId })) },
        title:           title?.trim() || null,
        date:            new Date(date),
        durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
        notes:           notes?.trim() || null,
      },
      include: {
        trainer: true,
        members: { include: { member: { select: MEMBER_SELECT } } },
      },
    })

    return NextResponse.json({ session: flattenMembers(raw) }, { status: 201 })
  } catch (error) {
    console.error('[pt-sessions POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
