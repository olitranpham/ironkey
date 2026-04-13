import { NextResponse } from 'next/server'
import { verifyTokenEdge, extractBearerToken } from '@/lib/jwt-edge'

export async function middleware(request) {
  const { pathname } = request.nextUrl

  // ── Public routes ────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/auth') || pathname === '/api/stripe/callback') {
    return NextResponse.next()
  }

  // ── Protected /api/[gymSlug]/* routes ────────────────────────────────────
  const token = extractBearerToken(request.headers.get('authorization'))

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await verifyTokenEdge(token)

  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  // Forward identity as request headers so route handlers can read them
  // without re-decoding the token.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-gym-user-id', payload.id)
  requestHeaders.set('x-gym-id',      payload.gymId)
  requestHeaders.set('x-gym-role',    payload.role)

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/api/:path*'],
}
