import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const PASS_TYPE_MAP = {
  single:    'SINGLE',
  '3-pack':  'THREE_PACK',
  '5-pack':  'FIVE_PACK',
  '10-pack': 'TEN_PACK',
  three_pack: 'THREE_PACK',
  five_pack:  'FIVE_PACK',
  ten_pack:   'TEN_PACK',
}

/**
 * POST /api/[gymSlug]/guest-passes
 * Public route — called by Zapier when a guest checks in.
 * Body: { name, email?, phone?, accessId?, passType?, passesLeft?, checkInId? }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const guestName = (body.name ?? '').trim()
    if (!guestName) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const rawType  = (body.passType ?? '').toLowerCase().trim()
    const passType = PASS_TYPE_MAP[rawType] ?? 'SINGLE'

    const pass = await prisma.guestPass.create({
      data: {
        gymId:      gym.id,
        guestName,
        guestEmail: body.email      ?? null,
        guestPhone: body.phone      ?? null,
        passType,
        passesLeft: body.passesLeft != null ? Number(body.passesLeft) : null,
        usedAt:     new Date(),
        expiresAt:  new Date(Date.now() + 30 * 86400 * 1000),
      },
    })

    return NextResponse.json({ pass }, { status: 201 })
  } catch (error) {
    console.error('[guest-passes POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request) {
  try {
    const gymId = request.headers.get('x-gym-id')

    if (!gymId) {
      return NextResponse.json({ error: 'Gym identity missing from request' }, { status: 400 })
    }

    const passes = await prisma.guestPass.findMany({
      where: { gymId },
      orderBy: [
        { usedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      select: {
        id:         true,
        guestName:  true,
        guestEmail: true,
        guestPhone: true,
        passType:   true,
        passesLeft: true,
        usedAt:     true,
        expiresAt:  true,
        createdAt:  true,
        member: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    })

    console.log(`[guest-passes] returned ${passes.length} pass(es) for gym ${gymId}`)
    return NextResponse.json({ passes })
  } catch (error) {
    console.error('[guest-passes]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
