import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'

/**
 * GET /api/[gymSlug]/webhook-jobs
 * Staff, read-only: this gym's access jobs that are failing — gave up after
 * the max attempts ('failed') or still retrying after an error.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'door.view')
    if (errorResponse) return errorResponse

    const jobs = await prisma.webhookJob.findMany({
      where: {
        gymId: ctx.gym.id,
        OR: [{ status: 'failed' }, { status: { in: ['pending', 'running'] }, lastError: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take:    200,
      select: {
        id: true, kind: true, status: true, failedStep: true, lastError: true, attempts: true,
        nextRunAt: true, createdAt: true, kisiDone: true, seamDone: true, zapierDone: true,
        guestPass: { select: { id: true, guestName: true, guestEmail: true, passType: true } },
        member:    { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    })
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('[webhook-jobs GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
