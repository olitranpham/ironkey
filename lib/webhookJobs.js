import prisma from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { runGuestAccessJob } from '@/lib/guestAccessJob'
import { JobStepError } from '@/lib/jobStepError'

// Follow-up work for the platform Stripe webhook (see model WebhookJob).
// The webhook enqueues a job in the same transaction as its rows, answers
// Stripe, then calls kickJob(); POST /api/cron/webhook-jobs (Railway cron,
// every 5 min) retries anything still due.

export const MAX_ATTEMPTS  = 8
const BACKOFF_MINUTES      = [1, 5, 15, 60]   // after attempt 1, 2, 3, 4+; then hourly
const STALE_LOCK_MS        = 10 * 60 * 1000   // a 'running' job older than this was killed mid-run

const HANDLERS = {
  guest_access: runGuestAccessJob,
}

/**
 * Claim a due job (pending and due, or running with a stale lock) and bump
 * attempts. Atomic, so two runners never process the same job.
 * @returns {Promise<boolean>}
 */
async function claimJob(id) {
  const now = new Date()
  const { count } = await prisma.webhookJob.updateMany({
    where: {
      id,
      OR: [
        { status: 'pending', nextRunAt: { lte: now } },
        { status: 'running', lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
    },
    data: { status: 'running', lockedAt: now, attempts: { increment: 1 } },
  })
  return count === 1
}

/**
 * Run one job if it's due. Never throws: a failure is saved on the job
 * (failedStep, lastError, next retry time), logged with the pass/member ID,
 * and audited once the job gives up after MAX_ATTEMPTS.
 *
 * @param {string} id
 * @returns {Promise<'done' | 'retry' | 'failed' | 'skipped'>}
 */
export async function runJob(id) {
  if (!(await claimJob(id))) return 'skipped'
  const job = await prisma.webhookJob.findUnique({ where: { id } })
  const handler = HANDLERS[job.kind]
  const save = data => prisma.webhookJob.update({ where: { id }, data })

  try {
    if (!handler) throw new JobStepError('unknown', `no handler for kind ${job.kind}`)
    await handler(job, { save })
    await save({ status: 'done', lockedAt: null, nextRunAt: null, failedStep: null, lastError: null })
    console.log('[webhook-job] done job=%s kind=%s pass=%s member=%s attempt=%d', id, job.kind, job.guestPassId, job.memberId, job.attempts)
    return 'done'
  } catch (err) {
    const step      = err.step ?? 'unknown'
    const message   = String(err.message ?? err).slice(0, 1000)
    const gaveUp    = job.attempts >= MAX_ATTEMPTS
    const delayMin  = BACKOFF_MINUTES[Math.min(job.attempts, BACKOFF_MINUTES.length) - 1]
    await save({
      status:     gaveUp ? 'failed' : 'pending',
      nextRunAt:  gaveUp ? null : new Date(Date.now() + delayMin * 60 * 1000),
      lockedAt:   null,
      failedStep: step,
      lastError:  message,
    }).catch(e => console.error('[webhook-job] could not save failure job=%s: %s', id, e.message))
    console.error('[webhook-job] FAILED job=%s kind=%s pass=%s member=%s session=%s step=%s attempt=%d/%d %s error=%s',
      id, job.kind, job.guestPassId, job.memberId, job.stripeSessionId, step, job.attempts, MAX_ATTEMPTS,
      gaveUp ? 'GAVE UP' : `retry in ${delayMin}m`, message)
    if (gaveUp) {
      writeAudit({ gym: { id: job.gymId }, user: null }, 'webhook_job.failed', 'WebhookJob', id, {
        kind: job.kind, guestPassId: job.guestPassId, memberId: job.memberId, step, error: message,
      })
    }
    return gaveUp ? 'failed' : 'retry'
  }
}

/** Run a job in the background (after the response). Errors are logged. */
export function kickJob(id) {
  runJob(id).catch(err => console.error('[webhook-job] run crashed job=%s: %s', id, err.message))
}

/**
 * Run every due job, oldest first (cron entry point).
 * @returns {Promise<Record<string, number>>} counts by outcome
 */
export async function runDueJobs({ limit = 50 } = {}) {
  const now = new Date()
  const due = await prisma.webhookJob.findMany({
    where: {
      OR: [
        { status: 'pending', nextRunAt: { lte: now } },
        { status: 'running', lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take:    limit,
    select:  { id: true },
  })
  const counts = { due: due.length, done: 0, retry: 0, failed: 0, skipped: 0 }
  for (const { id } of due) counts[await runJob(id)] += 1
  return counts
}

/**
 * Staff manual retry: make a job due now with a fresh attempt budget.
 * Steps that already succeeded stay done.
 * @returns {Promise<boolean>} false if no retryable job with this ID at this gym
 */
export async function retryJobNow(gymId, id) {
  const { count } = await prisma.webhookJob.updateMany({
    where: { id, gymId, status: { in: ['failed', 'pending'] } },
    data:  { status: 'pending', nextRunAt: new Date(), attempts: 0 },
  })
  if (count === 1) kickJob(id)
  return count === 1
}
