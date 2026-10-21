import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'

export async function DELETE(request, { params }) {
  try {
    const { gymSlug, trainerId } = await params
    const { errorResponse } = await requirePermission(request, gymSlug, 'pt.manage_all')
    if (errorResponse) return errorResponse
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const trainer = await prisma.personalTrainer.findFirst({
      where: { id: trainerId, gymId: gym.id },
    })
    if (!trainer) return NextResponse.json({ error: 'Trainer not found' }, { status: 404 })

    await prisma.personalTrainer.delete({ where: { id: trainerId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[personal-trainers DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
