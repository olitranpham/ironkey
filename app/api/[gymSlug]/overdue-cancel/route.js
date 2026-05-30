import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

/**
 * POST /api/[gymSlug]/overdue-cancel
 * Cron-callable (no JWT). Secured by CRON_SECRET token in request body.
 *
 * Body: { token: string }
 *
 * For each past_due / unpaid Stripe subscription:
 *   1–13 days overdue  → fire Zapier warning webhook
 *  14+  days overdue  → cancel sub, set member CANCELLED, delete Seam code, fire Zapier cancel webhook
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params

    // ── Auth ──────────────────────────────────────────────────────────────────
    const body  = await request.json()
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || body.token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Gym ───────────────────────────────────────────────────────────────────
    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: {
        id:                     true,
        stripeSecretKey:        true,
        seamApiKey:             true,
        seamDeviceId:           true,
        zapierOverdueWebhookUrl: true,
      },
    })
    if (!gym)                  return NextResponse.json({ error: 'Gym not found' },        { status: 404 })
    if (!gym.stripeSecretKey)  return NextResponse.json({ error: 'Stripe not configured' }, { status: 422 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    // ── Fetch all past_due + unpaid subscriptions ─────────────────────────────
    const [r1, r2] = await Promise.all([
      stripe.subscriptions.list({ status: 'past_due', limit: 100, expand: ['data.customer', 'data.latest_invoice'] }),
      stripe.subscriptions.list({ status: 'unpaid',   limit: 100, expand: ['data.customer', 'data.latest_invoice'] }),
    ])
    const subs = [...r1.data, ...r2.data]

    if (subs.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, warnings: 0, cancelled: 0 })
    }

    // ── Batch-fetch matching DB members ───────────────────────────────────────
    const emails = [...new Set(
      subs.map(s => s.customer?.email?.toLowerCase().trim()).filter(Boolean)
    )]
    const dbMembers = await prisma.member.findMany({
      where:  { gymId: gym.id, email: { in: emails } },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        accessCode: true, stripeSubscriptionId: true, status: true,
      },
    })
    const memberByEmail = {}
    for (const m of dbMembers) {
      if (m.email) memberByEmail[m.email.toLowerCase()] = m
    }

    const zapierUrl = gym.zapierOverdueWebhookUrl || process.env.ZAPIER_OVERDUE_WEBHOOK_URL
    const nowSecs   = Math.floor(Date.now() / 1000)

    let warnings  = 0
    let cancelled = 0

    for (const sub of subs) {
      const email      = sub.customer?.email?.toLowerCase().trim()
      const member     = email ? memberByEmail[email] : null
      const name       = member
        ? `${member.firstName} ${member.lastName}`.trim()
        : (sub.customer?.name?.trim() ?? email ?? 'Unknown')
      const accessCode = member?.accessCode ?? null

      // Determine when this subscription actually became overdue.
      //
      // For past_due/unpaid subs, Stripe advances current_period_end to the END
      // of the NEW billing period (in the future), so it can't be used directly.
      // Instead, use the latest invoice's created timestamp — that's when Stripe
      // first attempted to collect and failed, which is the true "overdue since" date.
      // Fall back to current_period_end only if it's already in the past.
      const inv = sub.latest_invoice
      const invoiceCreated = typeof inv === 'object' && inv !== null ? inv.created : null
      const periodEnd      = sub.current_period_end

      let overdueSince = null
      if (invoiceCreated && invoiceCreated < nowSecs) {
        overdueSince = invoiceCreated
      } else if (periodEnd && periodEnd < nowSecs) {
        overdueSince = periodEnd
      }

      const daysOverdue = overdueSince
        ? Math.max(0, Math.floor((nowSecs - overdueSince) / 86400))
        : 0

      console.log(
        '[overdue-cancel] sub=%s email=%s daysOverdue=%d status=%s',
        sub.id, email, daysOverdue, sub.status,
      )

      if (daysOverdue < 1) continue

      if (daysOverdue >= 14) {
        // ── Cancel ─────────────────────────────────────────────────────────────

        // 1. Cancel Stripe subscription immediately
        try {
          await stripe.subscriptions.cancel(sub.id)
          console.log('[overdue-cancel] cancelled Stripe sub %s', sub.id)
        } catch (err) {
          console.error('[overdue-cancel] Stripe cancel error for %s: %s', sub.id, err.message)
        }

        // 2. Update DB member status
        if (member && member.status !== 'CANCELLED') {
          await prisma.member.update({
            where: { id: member.id },
            data:  { status: 'CANCELLED', dateCanceled: new Date() },
          })
          console.log('[overdue-cancel] set member %s CANCELLED', member.id)
        }

        // 3. Delete Seam access code
        if (accessCode) {
          await deleteSeamAccessCode(gym, accessCode, member?.id)
        }

        // 4. Zapier cancel webhook (fire-and-forget)
        if (zapierUrl) {
          fetch(zapierUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name, email, status: 'overdue_cancelled', daysOverdue }),
          }).catch(e => console.error('[overdue-cancel] zapier cancel webhook error:', e.message))
        }

        cancelled++
      } else {
        // ── Warning (1–13 days) ────────────────────────────────────────────────

        if (zapierUrl) {
          fetch(zapierUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name, email, accessCode, status: 'overdue_warning', daysOverdue }),
          }).catch(e => console.error('[overdue-cancel] zapier warning webhook error:', e.message))
        }

        warnings++
      }
    }

    console.log(
      '[overdue-cancel] gym=%s total=%d warnings=%d cancelled=%d',
      gymSlug, subs.length, warnings, cancelled,
    )

    return NextResponse.json({ ok: true, processed: subs.length, warnings, cancelled })
  } catch (error) {
    console.error('[overdue-cancel]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Finds the Seam access_code_id for a given PIN, deletes it, and clears it
 * from the member record in the DB.
 */
async function deleteSeamAccessCode(gym, pin, memberId) {
  const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
  const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

  if (!apiKey) {
    console.warn('[overdue-cancel/seam] no API key configured — skipping code deletion')
    return
  }

  const seamHeaders = {
    Authorization:  `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    // List codes for the device to find the access_code_id matching this PIN
    let devices = deviceId ? [{ device_id: deviceId }] : []

    if (!deviceId) {
      const devRes = await fetch(`${SEAM_API}/devices/list`, {
        method:  'POST',
        headers: seamHeaders,
        body:    JSON.stringify({}),
      })
      if (devRes.ok) {
        const devBody = await devRes.json()
        devices = devBody.devices ?? []
      }
    }

    // Collect all codes across devices, find matching PIN
    let targetCodeId = null
    for (const device of devices) {
      const codesRes = await fetch(`${SEAM_API}/access_codes/list`, {
        method:  'POST',
        headers: seamHeaders,
        body:    JSON.stringify({ device_id: device.device_id }),
      })
      if (!codesRes.ok) continue
      const codesBody = await codesRes.json()
      const match = (codesBody.access_codes ?? []).find(
        c => String(c.code).trim() === String(pin).trim()
      )
      if (match) { targetCodeId = match.access_code_id; break }
    }

    if (!targetCodeId) {
      console.warn('[overdue-cancel/seam] no code found for PIN %s — skipping delete', pin)
      // Still clear the DB field even if Seam code not found
      if (memberId) {
        await prisma.member.update({ where: { id: memberId }, data: { accessCode: null } })
      }
      return
    }

    // Delete from Seam
    const delRes = await fetch(`${SEAM_API}/access_codes/delete`, {
      method:  'POST',
      headers: seamHeaders,
      body:    JSON.stringify({ access_code_id: targetCodeId }),
    })
    if (!delRes.ok) {
      const text = await delRes.text()
      console.error('[overdue-cancel/seam] delete error %s: %s', delRes.status, text)
    } else {
      console.log('[overdue-cancel/seam] deleted code %s (PIN %s)', targetCodeId, pin)
    }

    // Clear DB regardless of Seam result
    if (memberId) {
      await prisma.member.update({ where: { id: memberId }, data: { accessCode: null } })
    }
  } catch (err) {
    console.error('[overdue-cancel/seam] unexpected error:', err.message)
  }
}
