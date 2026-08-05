import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/membership-request?email=...
 * Public — looks up a member by email for the self-service membership
 * manager page. Returns just enough to drive the UI; no sensitive fields.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { searchParams } = new URL(request.url)
    const email = (searchParams.get('email') ?? '').trim().toLowerCase()

    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where:  { gymId_email: { gymId: gym.id, email } },
      select: { firstName: true, lastName: true, email: true, membershipType: true, status: true },
    })

    if (!member) {
      return NextResponse.json({ error: "we couldn't find a membership associated with that email" }, { status: 404 })
    }

    return NextResponse.json({
      member: {
        firstName:      member.firstName,
        lastName:       member.lastName,
        email:          member.email,
        membershipType: member.membershipType,
        status:         member.status,
      },
    })
  } catch (error) {
    console.error('[membership-request GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const VALID_REQUEST_TYPES = ['freeze', 'unfreeze', 'cancel']

/**
 * POST /api/[gymSlug]/membership-request
 * Public — records a self-service membership request and notifies staff via
 * Zapier. Does not itself change the member's status; staff action it
 * manually from whatever the Zapier automation routes it to.
 *
 * Body: { email, requestType, reason?, requestedDate? }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const email         = (body.email ?? '').trim().toLowerCase()
    const requestType   = (body.requestType ?? '').trim().toLowerCase()
    const reason         = body.reason ? String(body.reason).trim() : null
    const requestedDate  = body.requestedDate ? new Date(body.requestedDate) : null

    if (!email)      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    if (!VALID_REQUEST_TYPES.includes(requestType)) {
      return NextResponse.json({ error: 'requestType must be freeze, unfreeze, or cancel' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, zapierMembershipRequestWebhookUrl: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where:  { gymId_email: { gymId: gym.id, email } },
      select: { firstName: true, lastName: true, email: true },
    })
    if (!member) {
      return NextResponse.json({ error: "we couldn't find a membership associated with that email" }, { status: 404 })
    }

    const memberName = `${member.firstName} ${member.lastName}`.trim()

    const membershipRequest = await prisma.membershipRequest.create({
      data: {
        gymId:         gym.id,
        memberEmail:   member.email,
        memberName,
        requestType,
        reason,
        requestedDate,
      },
    })

    // ── Fire Zapier webhook (fire-and-forget) ─────────────────────────────
    if (gym.zapierMembershipRequestWebhookUrl) {
      fetch(gym.zapierMembershipRequestWebhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:          'membership_request',
          requestType,
          name:          memberName,
          email:         member.email,
          reason:        reason ?? '',
          requestedDate: requestedDate ? requestedDate.toISOString() : '',
        }),
      })
        .then(r => console.log('[membership-request] Zapier webhook status:', r.status))
        .catch(e => console.error('[membership-request] Zapier webhook error:', e.message))
    }

    return NextResponse.json({ ok: true, requestId: membershipRequest.id })
  } catch (error) {
    console.error('[membership-request POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
