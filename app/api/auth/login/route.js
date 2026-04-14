import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import prisma from '@/lib/prisma'
import { verifyPassword, signToken } from '@/lib/auth'

/**
 * POST /api/auth/login
 * Body: { email, password, gymSlug? }
 *
 * 1. If email/password match ADMIN_EMAIL/ADMIN_PASSWORD env vars → superadmin JWT, redirect to /admin
 * 2. Otherwise look up gym user:
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

    // ── Superadmin check (first) ──────────────────────────────────────────────
    const adminEmail    = process.env.ADMIN_EMAIL
    const adminPassword = process.env.ADMIN_PASSWORD

    if (adminEmail && adminPassword) {
      const emailMatch = email.length === adminEmail.length &&
        timingSafeEqual(Buffer.from(email), Buffer.from(adminEmail))
      const passwordMatch = password.length === adminPassword.length &&
        timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword))

      if (emailMatch && passwordMatch) {
        const token = signToken({ role: 'SUPERADMIN' })
        return NextResponse.json({ token, superadmin: true })
      }
    }

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
