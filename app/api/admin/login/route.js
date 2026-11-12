import { NextResponse } from 'next/server'
import { signSuperadminToken, isSuperadminConfigured, verifySuperadminCredentials } from '@/lib/auth'
import { hit, clientIp, tooManyRequests } from '@/lib/rateLimit'

// Every attempt counts, per IP and per email
const LIMITS = [
  { scope: 'ip',    limit: 10, windowSec: 15 * 60 },
  { scope: 'email', limit: 5,  windowSec: 15 * 60 },
]

/**
 * POST /api/admin/login
 * Body: { email, password }
 *
 * The only superadmin login (the admin portal's form). Checks ADMIN_EMAIL +
 * ADMIN_PASSWORD_HASH (bcrypt); plaintext ADMIN_PASSWORD is read only while
 * no hash is set. Rate-limited per IP and per email. Returns an 8-hour JWT
 * with role: 'SUPERADMIN'.
 */
export async function POST(request) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const ip      = clientIp(request)
    const results = await Promise.all(LIMITS.map(l =>
      hit(`admin-login:${l.scope}:${l.scope === 'ip' ? ip : String(email).trim().toLowerCase()}`, l.limit, l.windowSec)))
    const blocked = results.filter(r => !r.allowed)
    if (blocked.length) return tooManyRequests(Math.max(...blocked.map(r => r.retryAfterSec)))

    if (!isSuperadminConfigured()) {
      console.error('[admin/login] ADMIN_EMAIL or ADMIN_PASSWORD_HASH is not set')
      return NextResponse.json({ error: 'Admin not configured' }, { status: 500 })
    }

    if (!(await verifySuperadminCredentials(email, password))) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signSuperadminToken()
    return NextResponse.json({ token })
  } catch (error) {
    console.error('[admin/login]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
