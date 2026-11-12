import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyPassword, signToken } from '@/lib/auth'
import { hit, clientIp, tooManyRequests } from '@/lib/rateLimit'

// Every attempt counts, per IP and per email (front desks share an IP, hence the higher IP limit)
const LIMITS = [
  { scope: 'ip',    limit: 30, windowSec: 15 * 60 },
  { scope: 'email', limit: 10, windowSec: 15 * 60 },
]

/**
 * POST /api/auth/login
 * Body: { email, password, gymSlug? }
 *
 * Gym staff only — superadmin credentials are not accepted here (the admin
 * portal signs in at /api/admin/login). Rate-limited per IP and per email.
 * Looks up the gym user:
 *    - Single gym → return token + gym
 *    - Multiple gyms, no gymSlug → return { multipleGyms: true, gyms }
 *    - gymSlug provided → resolve to that gym
 */
export async function POST(request) {
  try {
    const { email, password, gymSlug } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const ip      = clientIp(request)
    const results = await Promise.all(LIMITS.map(l =>
      hit(`auth-login:${l.scope}:${l.scope === 'ip' ? ip : String(email).trim().toLowerCase()}`, l.limit, l.windowSec)))
    const blocked = results.filter(r => !r.allowed)
    if (blocked.length) return tooManyRequests(Math.max(...blocked.map(r => r.retryAfterSec)))

    // ── Gym user lookup ───────────────────────────────────────────────────────
    const users = await prisma.gymUser.findMany({
      where:   { email },
      include: { gym: true },
    })

    if (users.length === 0) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await verifyPassword(password, users[0].password)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Multiple gyms and no selection yet → send picker list
    if (users.length > 1 && !gymSlug) {
      return NextResponse.json({
        multipleGyms: true,
        gyms: users.map(u => ({ name: u.gym.name, slug: u.gym.slug })),
      })
    }

    const user = gymSlug ? users.find(u => u.gym.slug === gymSlug) : users[0]

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken({ id: user.id, gymId: user.gymId, role: user.role })

    return NextResponse.json({
      token,
      gym:  { id: user.gym.id, name: user.gym.name, slug: user.gym.slug },
      role: user.role,
    })
  } catch (error) {
    console.error('[login]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
