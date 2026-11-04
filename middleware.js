import { NextResponse } from 'next/server'
import { verifyTokenEdge, extractBearerToken } from '@/lib/jwt-edge'

export async function middleware(request) {
  const { pathname } = request.nextUrl

  // ── Strip client-supplied identity headers ───────────────────────────────
  // x-gym-* are only ever set below from a verified JWT. Removing them on
  // every request means no route — public or protected — can see spoofed values.
  const requestHeaders = new Headers(request.headers)
  for (const name of [...requestHeaders.keys()]) {
    if (name.toLowerCase().startsWith('x-gym-')) requestHeaders.delete(name)
  }
  const next = () => NextResponse.next({ request: { headers: requestHeaders } })

  // ── Public routes ────────────────────────────────────────────────────────
  if (
    pathname === '/api/v1/checkin' ||
    pathname.startsWith('/api/auth') ||
    pathname === '/api/stripe/callback' ||
    (request.method === 'POST' && pathname === '/api/stripe/webhook') ||
    pathname === '/api/admin/login' ||
    (request.method === 'POST' && /^\/api\/[^/]+\/members$/.test(pathname)) ||
    (request.method === 'POST' && /^\/api\/[^/]+\/guest-passes$/.test(pathname)) ||
    (request.method === 'POST' && /^\/api\/[^/]+\/guest-passes\/checkin$/.test(pathname)) ||
    (request.method === 'POST' && /^\/api\/[^/]+\/guest-passes\/checkin\/resend$/.test(pathname)) ||
    /^\/api\/[^/]+\/flex-checkin$/.test(pathname) ||
    /^\/api\/[^/]+\/membership-request$/.test(pathname) ||
    (request.method === 'POST' && /^\/api\/[^/]+\/stripe\/webhook$/.test(pathname)) ||
    /^\/api\/[^/]+\/join(\/|$)/.test(pathname) ||
    /^\/api\/[^/]+\/guest(\/|$)/.test(pathname) ||
    /^\/api\/[^/]+\/concessions(\/|$)/.test(pathname) ||
    (request.method === 'POST' && /^\/api\/[^/]+\/overdue-cancel$/.test(pathname)) ||
    (request.method === 'POST' && pathname === '/api/cron/webhook-jobs')
  ) {
    return next()
  }

  // ── All other /api/* routes require a valid JWT ───────────────────────────
  const token = extractBearerToken(request.headers.get('authorization'))

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await verifyTokenEdge(token)

  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  // ── Admin API routes require SUPERADMIN role ──────────────────────────────
  if (pathname.startsWith('/api/admin/')) {
    if (payload.role !== 'SUPERADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return next()
  }

  // ── Gym routes — forward identity headers from the verified JWT ───────────
  if (payload.id)    requestHeaders.set('x-gym-user-id', String(payload.id))
  if (payload.gymId) requestHeaders.set('x-gym-id',      String(payload.gymId))
  if (payload.role)  requestHeaders.set('x-gym-role',    String(payload.role))
  if (payload.impersonatedBy) requestHeaders.set('x-gym-impersonated-by', String(payload.impersonatedBy))

  return next()
}

export const config = {
  matcher: ['/api/:path*'],
}
