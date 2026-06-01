import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function PATCH(request, { params }) {
  try {
    const { gymSlug, entryId } = await params
    const body = await request.json()

    const { type, category, amount, description, date } = body

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const existing = await prisma.financialEntry.findFirst({
      where: { id: entryId, gymId: gym.id },
    })
    if (!existing) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

    const entry = await prisma.financialEntry.update({
      where: { id: entryId },
      data: {
        ...(type        != null && { type }),
        ...(category    != null && { category }),
        ...(amount      != null && { amount: parseFloat(amount) }),
        ...(description != null && { description: description.trim() || null }),
        ...(date        != null && { date: new Date(date) }),
      },
    })

    return NextResponse.json({ entry })
  } catch (error) {
    console.error('[financial-entries PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { gymSlug, entryId } = await params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const existing = await prisma.financialEntry.findFirst({
      where: { id: entryId, gymId: gym.id },
    })
    if (!existing) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

    await prisma.financialEntry.delete({ where: { id: entryId } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[financial-entries DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
