import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const entries = await prisma.financialEntry.findMany({
      where:   { gymId: gym.id },
      orderBy: { date: 'desc' },
    })

    return NextResponse.json({ entries })
  } catch (error) {
    console.error('[financial-entries GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const { type, category, amount, description, date } = body
    if (!type || !category || !amount || !date) {
      return NextResponse.json({ error: 'type, category, amount, and date are required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const entry = await prisma.financialEntry.create({
      data: {
        gymId:       gym.id,
        type,
        category,
        amount:      parseFloat(amount),
        description: description?.trim() || null,
        date:        new Date(date),
      },
    })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    console.error('[financial-entries POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
