import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { runDueJobs } from '@/lib/webhookJobs'

function tokenMatches(token) {
  const expected = process.env.CRON_SECRET
  if (!expected || typeof token !== 'string') return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * POST /api/cron/webhook-jobs
 * Cron-callable (no JWT) — Railway cron every 5 minutes. Body: { token: CRON_SECRET }
 *
 * Runs every due WebhookJob (Seam / Kisi / Zapier follow-up work from the
 * platform Stripe webhook) and returns counts by outcome.
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  if (!tokenMatches(body.token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const counts = await runDueJobs()
    if (counts.due) console.log('[cron/webhook-jobs] %j', counts)
    return NextResponse.json(counts)
  } catch (err) {
    console.error('[cron/webhook-jobs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
