import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function DELETE(request, { params }) {
  try {
    const { gymSlug, id } = await params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const entry = await prisma.financialEntry.findUnique({ where: { id } })
    if (!entry || entry.gymId !== gym.id) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    await prisma.financialEntry.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[financial-entries DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
