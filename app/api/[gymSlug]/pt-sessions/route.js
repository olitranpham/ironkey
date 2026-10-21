import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, forbidden } from '@/lib/permissions'
import { ptOwnOnly, validateSessionRefs } from '@/lib/ptSessions'

const MEMBER_SELECT = { id: true, firstName: true, lastName: true }

// Flatten PTSessionMember join rows → plain member objects
function flattenMembers(session) {
  return { ...session, members: session.members.map(sm => sm.member) }
}

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, ['pt.manage_all', 'pt.manage_own'])
    if (errorResponse) return errorResponse
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    // pt.manage_own only → just this trainer's sessions (none if not linked)
    const ownOnly = ptOwnOnly(ctx)
    if (ownOnly && !ctx.user.personalTrainerId) return NextResponse.json({ sessions: [] })

    const raw = await prisma.pTSession.findMany({
      where:   { gymId: gym.id, ...(ownOnly ? { trainerId: ctx.user.personalTrainerId } : {}) },
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
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, ['pt.manage_all', 'pt.manage_own'])
    if (errorResponse) return errorResponse
    const body = await request.json()
    const { memberIds, title, date, durationMinutes, notes } = body ?? {}
    let { trainerId } = body ?? {}

    // pt.manage_own only → sessions are always created for the caller's own trainer
    if (ptOwnOnly(ctx)) {
      if (!ctx.user.personalTrainerId) return forbidden()
      trainerId = ctx.user.personalTrainerId
    }

    if (!trainerId || !memberIds?.length || !date)
      return NextResponse.json({ error: 'trainerId, memberIds, and date are required' }, { status: 400 })

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const refError = await validateSessionRefs(gym.id, { trainerId, memberIds })
    if (refError) return NextResponse.json({ error: refError }, { status: 400 })

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
