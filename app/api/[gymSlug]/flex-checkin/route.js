import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const MAX_FLEX_CHECKINS = 5

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function resolveCount(member) {
  const monthStart = startOfMonth(new Date())
  const needsReset = !member.flexCheckInResetDate ||
    new Date(member.flexCheckInResetDate) < monthStart
  return {
    currentCount: needsReset ? 0 : member.flexCheckInCount,
    needsReset,
    monthStart,
  }
}

/**
 * GET /api/[gymSlug]/flex-checkin?email=...
 * Public — looks up a flex member by email and returns their current monthly check-in count.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { searchParams } = new URL(request.url)
    const email = (searchParams.get('email') ?? '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where:  { gymId_email: { gymId: gym.id, email } },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        accessCode: true, membershipType: true, status: true,
        flexCheckInCount: true, flexCheckInResetDate: true,
      },
    })

    if (!member || !member.membershipType?.toLowerCase().includes('flex')) {
      return NextResponse.json(
        { error: 'no flex membership found for that email' },
        { status: 404 },
      )
    }
    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'your flex membership is not currently active' },
        { status: 400 },
      )
    }

    const { currentCount } = resolveCount(member)

    return NextResponse.json({
      member: {
        id:        member.id,
        firstName: member.firstName,
        lastName:  member.lastName,
        email:     member.email,
        accessCode: member.accessCode,
      },
      checkInsUsed:      currentCount,
      checkInsRemaining: Math.max(0, MAX_FLEX_CHECKINS - currentCount),
    })
  } catch (error) {
    console.error('[flex-checkin GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/[gymSlug]/flex-checkin
 * Public — records a flex check-in for a member. Resets the monthly count if needed.
 * Body: { email }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body  = await request.json()
    const email = (body.email ?? '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, zapierGuestWebhookUrl: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where: { gymId_email: { gymId: gym.id, email } },
    })

    if (!member || !member.membershipType?.toLowerCase().includes('flex')) {
      return NextResponse.json(
        { error: 'no flex membership found for that email' },
        { status: 404 },
      )
    }
    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'your flex membership is not currently active' },
        { status: 400 },
      )
    }

    const { currentCount, needsReset, monthStart } = resolveCount(member)

    if (currentCount >= MAX_FLEX_CHECKINS) {
      return NextResponse.json(
        { error: `you've used all ${MAX_FLEX_CHECKINS} check-ins for this month` },
        { status: 400 },
      )
    }

    const newCount = currentCount + 1

    await prisma.member.update({
      where: { id: member.id },
      data: {
        flexCheckInCount:     newCount,
        ...(needsReset && { flexCheckInResetDate: monthStart }),
      },
    })

    // Fire Zapier webhook (non-blocking)
    if (gym.zapierGuestWebhookUrl) {
      fetch(gym.zapierGuestWebhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:              'flex_checkin',
          name:              `${member.firstName} ${member.lastName}`,
          email:             member.email,
          accessCode:        member.accessCode ?? null,
          checkInsUsed:      newCount,
          checkInsRemaining: MAX_FLEX_CHECKINS - newCount,
        }),
      }).catch(err => console.error('[flex-checkin webhook]', err))
    }

    return NextResponse.json({
      checkInsUsed:      newCount,
      checkInsRemaining: MAX_FLEX_CHECKINS - newCount,
    })
  } catch (error) {
    console.error('[flex-checkin POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
