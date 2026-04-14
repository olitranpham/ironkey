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

  // ── All other /api/* routes require a valid JWT ───────────────────────────
  const rawAuthHeader = request.headers.get('authorization')
  const token         = extractBearerToken(rawAuthHeader)
  const webhookSecret = process.env.WEBHOOK_SECRET

  console.log('[middleware] path:', pathname)
  console.log('[middleware] raw Authorization header:', JSON.stringify(rawAuthHeader))
  console.log('[middleware] extracted token (first 12):', token ? token.slice(0, 12) + '...' : 'null')
  console.log('[middleware] WEBHOOK_SECRET set:', Boolean(webhookSecret), '| length:', webhookSecret?.length ?? 0, '| first 6:', webhookSecret?.slice(0, 6) ?? 'n/a')
  console.log('[middleware] token matches secret:', token !== null && token === webhookSecret)

  if (!token) {
    console.log('[middleware] 401 — no token extracted')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Webhook API key bypass (Zapier / external integrations) ──────────────
  if (webhookSecret && token === webhookSecret) {
    const slugMatch = pathname.match(/^\/api\/([^/]+)/)
    const gymSlug   = slugMatch?.[1]
    console.log('[middleware] webhook bypass matched, gymSlug:', gymSlug)
    if (gymSlug) {
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-webhook-gym-slug', gymSlug)
      requestHeaders.set('x-webhook', 'true')
      return NextResponse.next({ request: { headers: requestHeaders } })
    }
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
