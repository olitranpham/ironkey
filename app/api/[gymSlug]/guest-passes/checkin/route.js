import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const email = (body.email ?? '').trim().toLowerCase()
    const name  = (body.name  ?? '').trim()

    if (!email && !name) {
      return NextResponse.json({ error: 'email or name is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    // ── Look up most recent pack with passes remaining ────────────────────────
    const existing = email
      ? await prisma.guestPass.findFirst({
          where: {
            gymId:      gym.id,
            guestEmail: { equals: email, mode: 'insensitive' },
            passesLeft: { gt: 0 },
          },
          orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
        })
      : null

    if (existing) {
      const newCount = existing.passesLeft - 1
      const updated  = await prisma.guestPass.update({
        where: { id: existing.id },
        data:  { passesLeft: newCount, usedAt: new Date() },
      })
      return NextResponse.json({ ok: true, passesLeft: updated.passesLeft, passType: updated.passType })
    }

    // ── No pack found — create a single-use record ────────────────────────────
    await prisma.guestPass.create({
      data: {
        gymId:      gym.id,
        guestName:  name || email,
        guestEmail: email || null,
        passType:   'SINGLE',
        passesLeft: null,
        usedAt:     new Date(),
        expiresAt:  new Date(Date.now() + 30 * 86400 * 1000),
      },
    })

    return NextResponse.json({ ok: true, passesLeft: null, passType: 'SINGLE' })
  } catch (error) {
    console.error('[guest-passes/checkin]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
