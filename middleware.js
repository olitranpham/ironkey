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
  const token = extractBearerToken(request.headers.get('authorization'))

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Webhook API key bypass (Zapier / external integrations) ──────────────
  // If the token matches WEBHOOK_SECRET, extract gymSlug from the URL and
  // inject x-gym-id by looking up the gym — skip JWT verification entirely.
  const webhookSecret = process.env.WEBHOOK_SECRET
  if (webhookSecret && token === webhookSecret) {
    // Extract gymSlug from path: /api/[gymSlug]/...
    const slugMatch = pathname.match(/^\/api\/([^/]+)/)
    const gymSlug   = slugMatch?.[1]
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
