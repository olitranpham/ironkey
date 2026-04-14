import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { signToken } from '@/lib/auth'

/**
 * POST /api/admin/login
 * Body: { email, password }
 *
 * Checks against ADMIN_EMAIL + ADMIN_PASSWORD_HASH env vars.
 * Returns a JWT with role: 'SUPERADMIN'.
 */
export async function POST(request) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const adminEmail    = process.env.ADMIN_EMAIL
    const adminPassword = process.env.ADMIN_PASSWORD

    if (!adminEmail || !adminPassword) {
      console.error('[admin/login] ADMIN_EMAIL or ADMIN_PASSWORD is not set')
      return NextResponse.json({ error: 'Admin not configured' }, { status: 500 })
    }

    // Timing-safe comparisons prevent enumeration attacks
    const emailMatch = email.length === adminEmail.length &&
      timingSafeEqual(Buffer.from(email), Buffer.from(adminEmail))

    const passwordMatch = password.length === adminPassword.length &&
      timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword))

    if (!emailMatch || !passwordMatch) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken({ role: 'SUPERADMIN' })
    return NextResponse.json({ token })
  } catch (error) {
    console.error('[admin/login]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
