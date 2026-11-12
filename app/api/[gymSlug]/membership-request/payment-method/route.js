import { NextResponse } from 'next/server'
import { hit, tooManyRequests } from '@/lib/rateLimit'
import { requireMemberSession } from '@/lib/memberSession'
import { gymStripe, cardOnFile, createMemberCardSetupSession, appOrigin } from '@/lib/memberBilling'
import { writeAudit } from '@/lib/audit'

const LINK_LIMIT = { limit: 5, windowSec: 60 * 60 }

/**
 * GET /api/[gymSlug]/membership-request/payment-method
 * Member session required. The signed-in member's own card on file:
 * { card: { id, brand, last4, expMonth, expYear } | null }.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { gym, member, errorResponse } = await requireMemberSession(request, gymSlug, { gymSelect: { stripeSecretKey: true } })
    if (errorResponse) return errorResponse
    if (!member.stripeCustomerId || !gym.stripeSecretKey) return NextResponse.json({ card: null, canUpdate: false })
    return NextResponse.json({ card: await cardOnFile(gymStripe(gym), member), canUpdate: true })
  } catch (error) {
    console.error('[membership-request/payment-method GET]', error.type ?? '', error.message)
    return NextResponse.json({ error: "we couldn't load your card right now." }, { status: 502 })
  }
}

/**
 * POST /api/[gymSlug]/membership-request/payment-method
 * Member session required. Stripe's setup page for the signed-in member's own
 * customer → { url, expiresAt }. The webhook saves the card as the default
 * and retries any overdue invoice with it.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const { gym, member, errorResponse } = await requireMemberSession(request, gymSlug, { gymSelect: { stripeSecretKey: true } })
    if (errorResponse) return errorResponse
    if (!member.stripeCustomerId) {
      return NextResponse.json({ error: "there's no billing account on file for your membership. please contact the gym." }, { status: 409 })
    }

    const limit = await hit(`member-card-setup:${member.id}`, LINK_LIMIT.limit, LINK_LIMIT.windowSec)
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const link = await createMemberCardSetupSession(gymStripe(gym), gym, member, { origin: appOrigin(request), source: 'member' })
    writeAudit({ gym, user: null }, 'member.payment_link_created', 'Member', member.id, { source: 'member', sessionId: link.sessionId, expiresAt: link.expiresAt })
    return NextResponse.json({ url: link.url, expiresAt: link.expiresAt })
  } catch (error) {
    console.error('[membership-request/payment-method POST]', error.type ?? '', error.message)
    if (error.status) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: "we couldn't open the payment page. please try again." }, { status: 502 })
  }
}
