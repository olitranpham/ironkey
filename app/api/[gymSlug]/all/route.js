import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission, trainerMemberScope, trainerMemberView } from '@/lib/permissions'

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.view')
    if (errorResponse) return errorResponse
    // TRAINER: only members from their own PT sessions, reduced fields
    const scope = await trainerMemberScope(ctx)
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
      ...(scope ? { id: { in: [...scope] } } : {}),
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
        kisiUserId:           true,
        kisiRoleAssignmentId: true,
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
        agreementSource:      true,
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
    return NextResponse.json({ members: scope ? members.map(trainerMemberView) : members })
  } catch (error) {
    console.error('[all] Unhandled error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
