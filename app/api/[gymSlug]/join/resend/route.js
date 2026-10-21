import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { limitRequest, hit, tooManyRequests, EMAIL_LIMIT } from '@/lib/rateLimit'
import { maskEmail, postWebhook } from '@/lib/guestCodeDelivery'
import { verifyPaidCheckoutSession } from '@/lib/checkoutSession'

const RESEND_EMAIL_LIMIT = 3

/**
 * POST /api/[gymSlug]/join/resend
 * Public — the membership success page's "resend" button. Body: { session_id }
 *
 * The session must be a paid (or completed subscription) checkout on this
 * gym's Stripe account; its email is used server-side. Re-sends the member's
 * current door code through the member Zapier webhook (gym field, then
 * ZAPIER_MEMBER_WEBHOOK_URL) to the email on the member record. Never returns
 * the code, and always returns { ok, sentTo } — whether or not a code was sent.
 *
 * Rate limits: 3 / 10 min per email, 60 / 10 min per IP.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json().catch(() => ({}))

    // IP limit first — the email is only known after verifying the session
    const ipLimited = await limitRequest(request, 'join-resend', null)
    if (ipLimited) return ipLimited

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, stripeSecretKey: true, zapierMemberWebhookUrl: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const verified = await verifyPaidCheckoutSession(gym, body.session_id, 'join')
    if (!verified.ok) return NextResponse.json({ ok: true, sentTo: maskEmail(null) })

    const email = verified.email
    const emailHit = await hit(`join-resend:email:${email}`, RESEND_EMAIL_LIMIT, EMAIL_LIMIT.windowSec)
    if (!emailHit.allowed) return tooManyRequests(emailHit.retryAfterSec)

    const generic = NextResponse.json({ ok: true, sentTo: maskEmail(email) })

    const member = await prisma.member.findFirst({
      where:  { gymId: gym.id, email },
      select: {
        firstName: true, lastName: true, email: true, accessCode: true, membershipType: true, status: true,
        isMinor: true, guardianName: true, guardianEmail: true, guardianPhone: true, guardianRelationship: true,
      },
    })
    // No code to send (not created yet, Kisi gym, or access revoked)
    if (!member?.accessCode || member.status === 'CANCELED' || member.status === 'FROZEN') return generic

    // Same shape as the purchase payload so the existing member Zap emails it
    await postWebhook(gym.zapierMemberWebhookUrl || process.env.ZAPIER_MEMBER_WEBHOOK_URL, gymSlug, {
      firstName:            member.firstName,
      lastName:             member.lastName,
      email:                member.email,   // the member record's email
      accessCode:           member.accessCode,
      membershipType:       member.membershipType,
      isMinor:              member.isMinor,
      guardianName:         member.isMinor ? member.guardianName         : null,
      guardianEmail:        member.isMinor ? member.guardianEmail        : null,
      guardianPhone:        member.isMinor ? member.guardianPhone        : null,
      guardianRelationship: member.isMinor ? member.guardianRelationship : null,
      resend:               true,
    }, 'member')

    return generic
  } catch (error) {
    console.error('[join/resend]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
