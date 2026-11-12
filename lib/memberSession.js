// Member-portal verification: members have no login, so every account action
// on /[gymSlug]/membership needs a one-time code emailed to the address on
// file. A correct code sets a signed httpOnly cookie (30 min) bound to that
// member id + gym; requireMemberSession() is the server-side gate on every
// member-facing endpoint, and handlers act only on the member it loads.

import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { SignJWT, jwtVerify } from 'jose'
import prisma from '@/lib/prisma'

export const CODE_TTL_MIN     = 10
export const CODE_MAX_ATTEMPTS = 5
export const SESSION_TTL_SEC  = 30 * 60

const AUDIENCE = 'ironkey:member-portal'
const COOKIE   = 'ik_member_session'

export const VERIFICATION_REQUIRED = 'verification_required'

// Keys derived from JWT_SECRET for this purpose only, so a member-portal token
// can never pass as a staff JWT (or the reverse) and code hashes can't be
// checked offline without the server secret.
function derivedKey(purpose) {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return crypto.createHmac('sha256', secret).update(`ironkey:${purpose}:v1`).digest()
}

// ── Codes ─────────────────────────────────────────────────────────────────────

/** 6 digits, uniformly random, zero-padded. */
export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCode(memberId, code) {
  return crypto.createHmac('sha256', derivedKey('member-code')).update(`${memberId}:${code}`).digest('hex')
}

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** Replace any outstanding code for the member with a new one; returns the plain code. */
export async function issueCode(gymId, memberId) {
  const code = generateCode()
  const now  = new Date()
  await prisma.$transaction([
    prisma.memberVerificationCode.updateMany({ where: { memberId, consumedAt: null }, data: { consumedAt: now } }),
    prisma.memberVerificationCode.create({
      data: { gymId, memberId, codeHash: hashCode(memberId, code), expiresAt: new Date(now.getTime() + CODE_TTL_MIN * 60_000) },
    }),
  ])
  return code
}

/**
 * Check a code against the member's newest outstanding one. Every check uses
 * up an attempt (atomically, so parallel guesses can't exceed the limit); a
 * match consumes the code.
 *
 * @returns {Promise<'ok' | 'invalid' | 'exhausted' | 'expired'>}
 */
export async function checkCode(memberId, code) {
  const row = await prisma.memberVerificationCode.findFirst({
    where:   { memberId, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) return 'expired'
  if (row.expiresAt <= new Date()) return 'expired'

  const { count } = await prisma.memberVerificationCode.updateMany({
    where: { id: row.id, consumedAt: null, attempts: { lt: CODE_MAX_ATTEMPTS } },
    data:  { attempts: { increment: 1 } },
  })
  if (!count) return 'exhausted'

  if (!/^\d{6}$/.test(code) || !sameHash(row.codeHash, hashCode(memberId, code))) {
    return row.attempts + 1 >= CODE_MAX_ATTEMPTS ? 'exhausted' : 'invalid'
  }

  const consumed = await prisma.memberVerificationCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data:  { consumedAt: new Date() },
  })
  return consumed.count ? 'ok' : 'expired'
}

// ── Session cookie ────────────────────────────────────────────────────────────

function cookiePath(gymSlug) {
  return `/api/${gymSlug}/membership-request`
}

/** Attach a fresh 30-minute session for this member to `response`. */
export async function setMemberSession(response, { gymId, gymSlug, memberId }) {
  const token = await new SignJWT({ gymId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(memberId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(derivedKey('member-session'))
  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     cookiePath(gymSlug),
    maxAge:   SESSION_TTL_SEC,
  })
  return response
}

export function clearMemberSession(response, gymSlug) {
  response.cookies.set(COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: cookiePath(gymSlug), maxAge: 0 })
  return response
}

function unauthorized() {
  return NextResponse.json({ error: VERIFICATION_REQUIRED, message: 'please verify your email to continue.' }, { status: 401 })
}

/**
 * Gate for member-facing endpoints. Resolves the gym from the URL slug and the
 * member from the cookie; the token must be for this gym and the member must
 * still belong to it. Handlers must act only on the returned member's own
 * Stripe customer / subscription — never on ids from the request body.
 *
 * @param {Request} request
 * @param {string} gymSlug
 * @param {{ gymSelect?: object, memberSelect?: object }} [options]
 * @returns {Promise<{ gym?: object, member?: object, errorResponse?: NextResponse }>}
 */
export async function requireMemberSession(request, gymSlug, { gymSelect = {}, memberSelect = {} } = {}) {
  const token = request.cookies?.get(COOKIE)?.value
  if (!token) return { errorResponse: unauthorized() }

  let payload
  try {
    ({ payload } = await jwtVerify(token, derivedKey('member-session'), { audience: AUDIENCE, algorithms: ['HS256'] }))
  } catch {
    return { errorResponse: unauthorized() }
  }

  const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true, slug: true, ...gymSelect } })
  if (!gym) return { errorResponse: NextResponse.json({ error: 'Gym not found' }, { status: 404 }) }
  if (payload.gymId !== gym.id || typeof payload.sub !== 'string') return { errorResponse: unauthorized() }

  const member = await prisma.member.findFirst({
    where:  { id: payload.sub, gymId: gym.id },
    select: { id: true, gymId: true, email: true, status: true, stripeCustomerId: true, stripeSubscriptionId: true, ...memberSelect },
  })
  if (!member) return { errorResponse: unauthorized() }
  return { gym, member }
}
