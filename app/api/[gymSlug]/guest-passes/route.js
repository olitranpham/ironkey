import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

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
