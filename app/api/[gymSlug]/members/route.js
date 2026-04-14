import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/members
 * Body: { firstName, lastName, email, phone? }
 * Creates a new member for the gym.
 */
export async function POST(request, { params }) {
  try {
    let gymId = request.headers.get('x-gym-id')

    // Webhook path: no JWT, resolve gymId from slug
    if (!gymId && request.headers.get('x-webhook') === 'true') {
      const slug = (await params).gymSlug
      const gym  = await prisma.gym.findUnique({ where: { slug }, select: { id: true } })
      gymId = gym?.id ?? null
    }

    const { firstName, lastName, email, phone } = await request.json()

    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { error: 'firstName, lastName, and email are required' },
        { status: 400 },
      )
    }

    const member = await prisma.member.create({
      data: { gymId, firstName, lastName, email, phone: phone ?? null },
    })

    return NextResponse.json({ member }, { status: 201 })
  } catch (error) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A member with that email already exists' }, { status: 409 })
    }
    console.error('[members]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
