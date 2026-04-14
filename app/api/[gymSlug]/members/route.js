import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/members
 * Public route — called by Zapier when a new member signs up.
 * Body: { firstName, lastName, email, phone? }
 * Validates that email is present. No auth required.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const email = (body.email ?? '').toLowerCase().trim()
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    // Accept either name (single field) or firstName + lastName separately
    let firstName, lastName
    if (body.name) {
      const parts = body.name.trim().split(/\s+/)
      firstName = parts[0] ?? 'Unknown'
      lastName  = parts.slice(1).join(' ') || ''
    } else {
      firstName = (body.firstName ?? '').trim() || 'Unknown'
      lastName  = (body.lastName  ?? '').trim() || ''
    }

    const phone = body.phone ?? null

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const member = await prisma.member.create({
      data: { gymId: gym.id, firstName, lastName, email, phone },
    })

    return NextResponse.json({ member }, { status: 201 })
  } catch (error) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A member with that email already exists' }, { status: 409 })
    }
    console.error('[members POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
