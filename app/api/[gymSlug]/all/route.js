import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search')

    const gymRow = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gymRow) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }
    const gymId = gymRow.id

    console.log(`[all] gymSlug=${gymSlug} gymId=${gymId} status=${status ?? 'any'} search=${search ?? ''}`)

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

    const rows = await prisma.member.findMany({
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
        dateOfBirth:          true,
        address:              true,
        emergencyContactName:         true,
        emergencyContactPhone:        true,
        emergencyContactRelationship: true,
        isMinor:              true,
        guardianName:         true,
        guardianEmail:        true,
        guardianPhone:        true,
        guardianRelationship: true,
        freezeStartDate:      true,
        freezeEndDate:        true,
        dateAccessed:         true,
        dateFrozen:           true,
        dateCanceled:         true,
        stripeCustomerId:     true,
        stripeSubscriptionId: true,
        priceId:              true,
        createdAt:            true,
        flexCheckInCount:     true,
        flexCheckInResetDate: true,
        cancelScheduled:      true,
        cancelEffectiveDate:  true,
        hearAboutUs:          true,
        gradSemester:         true,
        gradYear:             true,
        studentCategory:      true,
      },
    })

    // Compute current-month flex check-in count for each member
    const now        = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const members = rows.map(m => {
      const needsReset = !m.flexCheckInResetDate || new Date(m.flexCheckInResetDate) < monthStart
      return {
        ...m,
        flexCheckInsThisMonth: needsReset ? 0 : (m.flexCheckInCount ?? 0),
      }
    })

    console.log(`[all] returned ${members.length} member(s) for gym ${gymId}`)
    return NextResponse.json({ members })
  } catch (error) {
    console.error('[all] Unhandled error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
