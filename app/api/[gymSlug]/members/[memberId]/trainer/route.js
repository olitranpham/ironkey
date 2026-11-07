import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { writeAudit } from '@/lib/audit'

/**
 * PATCH /api/[gymSlug]/members/[memberId]/trainer
 * Body: { personalTrainerId: string | null }
 * Assigns (or clears) the member's trainer. pt.assign only (OWNER, ADMIN).
 * Both the member and the trainer must belong to the gym in the URL.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, memberId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'pt.assign')
    if (errorResponse) return errorResponse

    const body = await request.json().catch(() => ({}))
    const personalTrainerId = body.personalTrainerId || null

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findFirst({ where: { id: memberId, gymId: gym.id }, select: { id: true, assignedTrainerId: true } })
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    let trainer = null
    if (personalTrainerId) {
      trainer = await prisma.personalTrainer.findFirst({ where: { id: personalTrainerId, gymId: gym.id }, select: { id: true, name: true } })
      if (!trainer) return NextResponse.json({ error: 'Trainer not found' }, { status: 404 })
    }

    await prisma.member.update({ where: { id: member.id }, data: { assignedTrainerId: trainer?.id ?? null } })
    writeAudit(ctx, 'member.assign_trainer', 'Member', member.id, { from: member.assignedTrainerId, to: trainer?.id ?? null })

    return NextResponse.json({ trainer })
  } catch (error) {
    console.error('[members/trainer PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
