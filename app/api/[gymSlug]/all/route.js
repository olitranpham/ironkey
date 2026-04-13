import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(request, { params }) {
  try {
    const gymId = request.headers.get('x-gym-id')

    if (!gymId) {
      console.error('[all] x-gym-id header missing — middleware may not have run')
      return NextResponse.json({ error: 'Gym identity missing from request' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    const where = {
      gymId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName:  { contains: search, mode: 'insensitive' } },
              { email:     { contains: search, mode: 'insensitive' } },
              { phone:     { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    console.log(`[all] gymId=${gymId} status=${status ?? 'any'} search=${search ?? ''}`)

    const members = await prisma.member.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id:             true,
        firstName:      true,
        lastName:       true,
        email:          true,
        phone:          true,
        status:         true,
        membershipType: true,
        accessCode:     true,
        freezeStartDate:      true,
        freezeEndDate:        true,
        dateAccessed:         true,
        dateFrozen:           true,
        dateCanceled:         true,
        stripeCustomerId:     true,
        stripeSubscriptionId: true,
        createdAt:            true,
      },
    })

    console.log(`[all] returned ${members.length} member(s) for gym ${gymId}`)
    return NextResponse.json({ members })
  } catch (error) {
    console.error('[all] Unhandled error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
