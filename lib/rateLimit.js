import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/** Limits for public, email-driven endpoints. */
export const IP_LIMIT    = { limit: 20, windowSec: 10 * 60 }
export const EMAIL_LIMIT = { limit: 5,  windowSec: 10 * 60 }

/**
 * Count one hit against `key` in a fixed window. A single atomic upsert:
 * inserts the row, increments it, or — if the window has expired — resets it
 * to 1, so concurrent requests can't race past the limit.
 *
 * Fails open (allowed) if the database call errors, so an outage of the
 * counter table never takes the endpoints down; the error is logged.
 *
 * @param {string} key
 * @param {number} limit
 * @param {number} windowSec
 * @returns {Promise<{ allowed: boolean, count: number, retryAfterSec: number }>}
 */
export async function hit(key, limit, windowSec) {
  try {
    const rows = await prisma.$queryRaw`
      INSERT INTO "RateLimit" ("key", "count", "windowStart")
      VALUES (${key}, 1, now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."windowStart" <= now() - make_interval(secs => ${windowSec}::double precision) THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimit"."windowStart" <= now() - make_interval(secs => ${windowSec}::double precision) THEN now()
          ELSE "RateLimit"."windowStart"
        END
      RETURNING "count", EXTRACT(EPOCH FROM ("windowStart" + make_interval(secs => ${windowSec}::double precision) - now()))::int AS "retryAfterSec"
    `
    const { count, retryAfterSec } = rows[0]
    maybeCleanup()
    return { allowed: count <= limit, count, retryAfterSec: Math.max(1, Number(retryAfterSec) || windowSec) }
  } catch (err) {
    console.error('[rateLimit] hit failed — allowing request: %s', err.message)
    return { allowed: true, count: 0, retryAfterSec: 0 }
  }
}

// Expired rows are never read again; prune them occasionally so the table
// doesn't grow with every distinct IP/email ever seen.
function maybeCleanup() {
  if (Math.random() >= 0.01) return
  prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day'`
    .catch(err => console.error('[rateLimit] cleanup failed: %s', err.message))
}

/**
 * Client IP: the RIGHTMOST x-forwarded-for entry — the one our edge proxy
 * appended. Earlier entries can be supplied by the client and are ignored.
 * Falls back to x-real-ip, then 'unknown'.
 *
 * Temporary: set LOG_IP_HEADERS=true to log the raw headers and verify on Railway.
 */
export function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for')
  if (process.env.LOG_IP_HEADERS === 'true') {
    console.log('[rateLimit] ip headers x-forwarded-for=%j x-real-ip=%j', xff, request.headers.get('x-real-ip'))
  }
  const hops = (xff ?? '').split(',').map(h => h.trim()).filter(Boolean)
  return hops.at(-1) || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * Apply the per-IP and per-email limits (see IP_LIMIT / EMAIL_LIMIT) for one
 * endpoint bucket. Returns a 429 NextResponse when either is exceeded, else null.
 *
 *   const limited = await limitRequest(request, 'flex-checkin:GET', email)
 *   if (limited) return limited
 *
 * @param {Request} request
 * @param {string} bucket — endpoint name; counters are separate per bucket
 * @param {string | null | undefined} email — lowercased before use; skipped if empty
 * @returns {Promise<NextResponse | null>}
 */
export async function limitRequest(request, bucket, email) {
  const checks = [hit(`${bucket}:ip:${clientIp(request)}`, IP_LIMIT.limit, IP_LIMIT.windowSec)]
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (normalized) checks.push(hit(`${bucket}:email:${normalized}`, EMAIL_LIMIT.limit, EMAIL_LIMIT.windowSec))

  const results = await Promise.all(checks)
  const blocked = results.filter(r => !r.allowed)
  if (blocked.length === 0) return null

  const retryAfter = Math.max(...blocked.map(r => r.retryAfterSec))
  return NextResponse.json(
    { error: 'Too many requests — please try again in a few minutes.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}
