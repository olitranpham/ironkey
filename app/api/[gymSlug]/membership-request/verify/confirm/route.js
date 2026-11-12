import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { hit, clientIp, tooManyRequests } from '@/lib/rateLimit'
import { checkCode, setMemberSession, SESSION_TTL_SEC } from '@/lib/memberSession'
import { writeAudit } from '@/lib/audit'

// On top of the 5 attempts per code — caps guessing across many codes / emails from one IP
const CONFIRM_LIMITS = [
  { scope: 'email', limit: 15, windowSec: 15 * 60 },
  { scope: 'ip',    limit: 40, windowSec: 15 * 60 },
]

const WRONG = {
  invalid:   "that code isn't right. check the email and try again.",
  exhausted: 'too many attempts. request a new code.',
  expired:   'that code has expired. request a new code.',
}

/**
 * POST /api/[gymSlug]/membership-request/verify/confirm   Body: { email, code }
 * Public. A correct code sets the 30-minute member session cookie (httpOnly,
 * bound to this member + gym) that every member-portal action requires.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body  = await request.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    const code  = String(body.code ?? '').replace(/\s+/g, '')
    if (!email || !code) return NextResponse.json({ error: 'email and code are required' }, { status: 400 })

    const ip      = clientIp(request)
    const results = await Promise.all(CONFIRM_LIMITS.map(l =>
      hit(`member-verify-confirm:${l.scope}:${l.scope === 'ip' ? ip : email}`, l.limit, l.windowSec)))
    const blocked = results.filter(r => !r.allowed)
    if (blocked.length) return tooManyRequests(Math.max(...blocked.map(r => r.retryAfterSec)))

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true, slug: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({ where: { gymId_email: { gymId: gym.id, email } }, select: { id: true } })
    const result = member ? await checkCode(member.id, code) : 'expired'
    if (result !== 'ok') {
      if (member && result === 'exhausted') writeAudit({ gym, user: null }, 'member.portal_code_exhausted', 'Member', member.id, { ip })
      return NextResponse.json({ error: 'invalid_code', reason: result, message: WRONG[result] }, { status: 400 })
    }

    writeAudit({ gym, user: null }, 'member.portal_verified', 'Member', member.id, { ip })
    return setMemberSession(NextResponse.json({ ok: true, expiresInSec: SESSION_TTL_SEC }), { gymId: gym.id, gymSlug: gym.slug, memberId: member.id })
  } catch (error) {
    console.error('[membership-request/verify/confirm]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
