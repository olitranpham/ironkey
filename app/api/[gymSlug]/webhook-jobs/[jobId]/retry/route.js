import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/permissions'
import { retryJobNow } from '@/lib/webhookJobs'
import { writeAudit } from '@/lib/audit'

/**
 * POST /api/[gymSlug]/webhook-jobs/[jobId]/retry
 * Staff: run a failing access job again now (fresh attempt budget; steps
 * that already succeeded are not redone).
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug, jobId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'door.manage')
    if (errorResponse) return errorResponse

    const ok = await retryJobNow(ctx.gym.id, jobId)
    if (!ok) return NextResponse.json({ error: 'job not found or not retryable' }, { status: 404 })
    writeAudit(ctx, 'webhook_job.retry', 'WebhookJob', jobId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[webhook-jobs retry POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
