import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const trainers = await prisma.personalTrainer.findMany({
      where:   { gymId: gym.id },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { sessions: true } } },
    })

    return NextResponse.json({ trainers })
  } catch (error) {
    console.error('[personal-trainers GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()
    const { name, email, phone, bio, color } = body ?? {}
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const trainer = await prisma.personalTrainer.create({
      data: {
        gymId: gym.id,
        name:  name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        bio:   bio?.trim()   || null,
        color: color         || null,
      },
      include: { _count: { select: { sessions: true } } },
    })

    return NextResponse.json({ trainer }, { status: 201 })
  } catch (error) {
    console.error('[personal-trainers POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
