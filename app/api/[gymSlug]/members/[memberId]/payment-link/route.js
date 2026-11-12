import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { hit, tooManyRequests } from '@/lib/rateLimit'
import { gymStripe, createMemberCardSetupSession, appOrigin, MEMBER_CARD_SETUP_KIND } from '@/lib/memberBilling'
import { emailEnabled, sendEmail, paymentLinkEmail } from '@/lib/email'
import { writeAudit } from '@/lib/audit'

const EMAIL_LIMIT = { limit: 5, windowSec: 60 * 60 }   // per member, so a link can't be used to spam them

/**
 * POST /api/[gymSlug]/members/[memberId]/payment-link
 * members.edit, scoped to the staff user's gym. Staff never enter card
 * details — this makes a Stripe setup page for the member to use.
 *
 *   {}             → new link: { url, sessionId, expiresAt }   (audited)
 *   { sessionId }  → email that link to the member's address on file:
 *                    { emailed: true, expiresAt }. The session is re-read from
 *                    Stripe and must be an open card-setup session for this
 *                    member and gym, so only our own links can be emailed.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug, memberId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.edit')
    if (errorResponse) return errorResponse
    const body = await request.json().catch(() => ({}))

    const [member, gym] = await Promise.all([
      prisma.member.findFirst({
        where:  { id: memberId, gymId: ctx.gym.id },
        select: { id: true, firstName: true, email: true, stripeCustomerId: true },
      }),
      prisma.gym.findUnique({ where: { id: ctx.gym.id }, select: { id: true, slug: true, name: true, logoUrl: true, timezone: true, stripeSecretKey: true } }),
    ])
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (!member.stripeCustomerId) return NextResponse.json({ error: 'this member has no stripe customer linked' }, { status: 409 })
    const stripe = gymStripe(gym)

    // ── Email an existing link ────────────────────────────────────────────
    if (body.sessionId) {
      if (!emailEnabled()) return NextResponse.json({ error: 'email is not set up for this app yet' }, { status: 503 })
      if (!member.email) return NextResponse.json({ error: 'this member has no email on file' }, { status: 409 })

      const session = await stripe.checkout.sessions.retrieve(String(body.sessionId))
      const ours = session.mode === 'setup'
        && session.status === 'open'
        && session.metadata?.ironkey_kind === MEMBER_CARD_SETUP_KIND
        && session.metadata?.ironkey_member_id === member.id
        && session.metadata?.ironkey_gym_id === gym.id
        && session.customer === member.stripeCustomerId
      if (!ours) return NextResponse.json({ error: 'that link has expired — make a new one' }, { status: 409 })

      const limit = await hit(`member-payment-link-email:${member.id}`, EMAIL_LIMIT.limit, EMAIL_LIMIT.windowSec)
      if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

      const expiresAt = new Date(session.expires_at * 1000).toISOString()
      try {
        await sendEmail({ to: member.email, fromName: gym.name, ...paymentLinkEmail(gym, member, session.url, expiresAt) })
      } catch (err) {
        console.error('[members/payment-link] email failed for member %s: %s', member.id, err.message)
        return NextResponse.json({ error: "couldn't send the email — copy the link instead" }, { status: 502 })
      }
      writeAudit(ctx, 'member.payment_link_emailed', 'Member', member.id, { sessionId: session.id, expiresAt })
      return NextResponse.json({ emailed: true, expiresAt })
    }

    // ── New link ──────────────────────────────────────────────────────────
    const link = await createMemberCardSetupSession(stripe, gym, member, { origin: appOrigin(request), source: 'staff', actorId: ctx.user?.id ?? null })
    writeAudit(ctx, 'member.payment_link_created', 'Member', member.id, { source: 'staff', sessionId: link.sessionId, expiresAt: link.expiresAt })
    return NextResponse.json(link)
  } catch (error) {
    console.error('[members/payment-link POST]', error.type ?? '', error.message)
    if (error.status) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: error.type ? 'stripe error — please try again' : 'Internal server error' }, { status: error.type ? 502 : 500 })
  }
}
