// Railway cron service entry point (schedule: */5 * * * *).
// Asks the app to run due WebhookJobs, then exits — Railway cron requires the
// process to finish. Needs APP_URL (e.g. https://portal.ironkeyentry.com)
// and CRON_SECRET.
//
//   node scripts/cron-webhook-jobs.js

const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
const token  = process.env.CRON_SECRET

async function main() {
  if (!appUrl || !token) throw new Error('APP_URL and CRON_SECRET are required')
  const res  = await fetch(`${appUrl}/api/cron/webhook-jobs`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token }),
    signal:  AbortSignal.timeout(4 * 60 * 1000),
  })
  const text = await res.text()
  console.log('[cron-webhook-jobs] status=%d %s', res.status, text.slice(0, 500))
  if (!res.ok) process.exitCode = 1
}

main().catch(err => { console.error('[cron-webhook-jobs]', err.message); process.exitCode = 1 })
