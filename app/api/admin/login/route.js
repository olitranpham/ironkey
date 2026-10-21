import { NextResponse } from 'next/server'
import { signToken, isSuperadminConfigured, verifySuperadminCredentials } from '@/lib/auth'

/**
 * POST /api/admin/login
 * Body: { email, password }
 *
 * Checks against ADMIN_EMAIL + ADMIN_PASSWORD_HASH env vars (bcrypt), falling
 * back to plaintext ADMIN_PASSWORD only if the hash is unset.
 * Returns a JWT with role: 'SUPERADMIN'.
 */
export async function POST(request) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    if (!isSuperadminConfigured()) {
      console.error('[admin/login] ADMIN_EMAIL or ADMIN_PASSWORD_HASH is not set')
      return NextResponse.json({ error: 'Admin not configured' }, { status: 500 })
    }

    if (!(await verifySuperadminCredentials(email, password))) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken({ role: 'SUPERADMIN' })
    return NextResponse.json({ token })
  } catch (error) {
    console.error('[admin/login]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
