import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { hit, clientIp, tooManyRequests } from '@/lib/rateLimit'
import { emailEnabled, sendEmail, verificationCodeEmail } from '@/lib/email'
import { issueCode, clearMemberSession, CODE_TTL_MIN } from '@/lib/memberSession'
import { writeAudit } from '@/lib/audit'

// Each send emails a code, so sends are limited per email and per IP
// (kiosks share one IP per gym, hence the higher IP limit)
const SEND_LIMITS = [
  { scope: 'email', limit: 3,  windowSec: 15 * 60 },
  { scope: 'email', limit: 10, windowSec: 24 * 60 * 60 },
  { scope: 'ip',    limit: 20, windowSec: 15 * 60 },
]

// Same reply whether or not the email has a membership, so the endpoint
// can't be used to find out who's a member
const SENT = { ok: true, message: 'if that email has a membership here, we sent it a 6-digit code.' }

/**
 * POST /api/[gymSlug]/membership-request/verify   Body: { email }
 * Public. Emails a 6-digit code (valid 10 min, 5 attempts) to the address on
 * file for that membership; confirm it at /verify/confirm.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body  = await request.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

    const ip      = clientIp(request)
    const results = await Promise.all(SEND_LIMITS.map(l =>
      hit(`member-verify-send:${l.scope}:${l.windowSec}:${l.scope === 'ip' ? ip : email}`, l.limit, l.windowSec)))
    const blocked = results.filter(r => !r.allowed)
    if (blocked.length) return tooManyRequests(Math.max(...blocked.map(r => r.retryAfterSec)))

    if (!emailEnabled()) {
      console.error('[member-verify] RESEND_API_KEY / EMAIL_FROM not set — cannot send codes')
      return NextResponse.json({ error: "verification email isn't available right now. please contact the gym." }, { status: 503 })
    }

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true, slug: true, name: true, displayName: true, logoUrl: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({ where: { gymId_email: { gymId: gym.id, email } }, select: { id: true, email: true } })
    if (!member) return NextResponse.json(SENT)

    const code = await issueCode(gym.id, member.id)
    try {
      await sendEmail({ to: member.email, fromName: gym.name, ...verificationCodeEmail(gym, code, CODE_TTL_MIN) })
    } catch (err) {
      console.error('[member-verify] send failed for member %s: %s', member.id, err.message)
      return NextResponse.json({ error: "we couldn't send the code. please try again in a minute." }, { status: 502 })
    }
    writeAudit({ gym, user: null }, 'member.portal_code_sent', 'Member', member.id, { ip })
    return NextResponse.json(SENT)
  } catch (error) {
    console.error('[membership-request/verify POST]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE /api/[gymSlug]/membership-request/verify — sign out (clears the session cookie). */
export async function DELETE(request, { params }) {
  const { gymSlug } = await params
  return clearMemberSession(NextResponse.json({ ok: true }), gymSlug)
}
