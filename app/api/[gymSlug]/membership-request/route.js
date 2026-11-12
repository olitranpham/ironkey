import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withPhone } from '@/lib/zapierPayload'
import { limitRequest } from '@/lib/rateLimit'
import { getOverdueState, OVERDUE_MESSAGE } from '@/lib/overdue'
import { requireMemberSession } from '@/lib/memberSession'

/**
 * GET /api/[gymSlug]/membership-request
 * Member session required (email code → cookie, see /verify). Returns the
 * signed-in member's own membership — just enough to drive the UI; no
 * sensitive fields. `overdue` (Member.status OVERDUE, or the Stripe
 * subscription past_due / unpaid right now) disables freeze / cancel and
 * shows "pay now".
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { gym, member, errorResponse } = await requireMemberSession(request, gymSlug, {
      gymSelect:    { stripeSecretKey: true },
      memberSelect: { firstName: true, lastName: true, membershipType: true },
    })
    if (errorResponse) return errorResponse

    return NextResponse.json({
      member: {
        firstName:      member.firstName,
        lastName:       member.lastName,
        email:          member.email,
        membershipType: member.membershipType,
        status:         member.status,
        overdue:        member.status === 'CANCELED' ? false : (await getOverdueState(gym, member)).overdue,
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
 * Member session required — the request is always for the signed-in member.
 *
 * Body: { requestType, reason?, requestedDate? }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json().catch(() => ({}))

    const { gym, member, errorResponse } = await requireMemberSession(request, gymSlug, {
      gymSelect:    { stripeSecretKey: true, zapierMembershipRequestWebhookUrl: true },
      memberSelect: { firstName: true, lastName: true, phone: true },
    })
    if (errorResponse) return errorResponse

    const limited = await limitRequest(request, 'membership-request:POST', member.email)
    if (limited) return limited
    const requestType   = (body.requestType ?? '').trim().toLowerCase()
    const reason         = body.reason ? String(body.reason).trim() : null
    const requestedDate  = body.requestedDate ? new Date(body.requestedDate) : null

    if (!VALID_REQUEST_TYPES.includes(requestType)) {
      return NextResponse.json({ error: 'requestType must be freeze, unfreeze, or cancel' }, { status: 400 })
    }

    // Overdue members can't request a freeze or cancel until they pay
    if ((requestType === 'freeze' || requestType === 'cancel') && (await getOverdueState(gym, member)).overdue) {
      return NextResponse.json({ error: OVERDUE_MESSAGE, overdue: true }, { status: 403 })
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
        body:    JSON.stringify(withPhone({
          type:          'membership_request',
          requestType,
          name:          memberName,
          email:         member.email,
          reason:        reason ?? '',
          requestedDate: requestedDate ? requestedDate.toISOString() : '',
        }, member.phone, `member=${member.id}`)),
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
