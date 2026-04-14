import { NextResponse } from 'next/server'
import { verifyTokenEdge, extractBearerToken } from '@/lib/jwt-edge'

export async function middleware(request) {
  const { pathname } = request.nextUrl

  // ── Public routes ────────────────────────────────────────────────────────
  if (
    pathname.startsWith('/api/auth') ||
    pathname === '/api/stripe/callback' ||
    pathname === '/api/admin/login'
  ) {
    return NextResponse.next()
  }

  const rawAuthHeader = request.headers.get('authorization')
  const webhookSecret = process.env.WEBHOOK_SECRET

  // Log everything for all incoming requests — helps debug Railway/Zapier issues
  console.log('[middleware] >>>',  request.method, pathname)
  console.log('[middleware] Authorization header (raw):', JSON.stringify(rawAuthHeader))
  console.log('[middleware] All headers:', JSON.stringify(Object.fromEntries(request.headers.entries())))
  console.log('[middleware] WEBHOOK_SECRET present:', Boolean(webhookSecret), '| length:', webhookSecret?.length ?? 0, '| first8:', webhookSecret?.slice(0, 8) ?? 'n/a')

  // ── Webhook bypass — checked FIRST, independently of JWT extraction ───────
  // Read the raw header directly so no helper function can interfere.
  if (webhookSecret) {
    const rawToken = rawAuthHeader?.replace(/^[Bb]earer\s+/, '').trim()
    console.log('[middleware] rawToken (first 12):', rawToken ? rawToken.slice(0, 12) + '...' : 'null')
    console.log('[middleware] rawToken === webhookSecret:', rawToken === webhookSecret)
    if (rawToken === webhookSecret) {
      const slugMatch = pathname.match(/^\/api\/([^/]+)/)
      const gymSlug   = slugMatch?.[1]
      console.log('[middleware] webhook bypass — gymSlug:', gymSlug)
      if (gymSlug) {
        const requestHeaders = new Headers(request.headers)
        requestHeaders.set('x-webhook-gym-slug', gymSlug)
        requestHeaders.set('x-webhook', 'true')
        return NextResponse.next({ request: { headers: requestHeaders } })
      }
    }
  }

  // ── All other /api/* routes require a valid JWT ───────────────────────────
  const token = extractBearerToken(rawAuthHeader)

  if (!token) {
    console.log('[middleware] 401 — no token extracted from:', JSON.stringify(rawAuthHeader))
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
    return NextResponse.next()
  }

  // ── Gym routes — forward identity headers ─────────────────────────────────
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-gym-user-id', payload.id)
  requestHeaders.set('x-gym-id',      payload.gymId)
  requestHeaders.set('x-gym-role',    payload.role)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/api/:path*'],
}
