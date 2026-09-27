import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'
import { formatPhone, toE164 } from '@/lib/phone'

/**
 * POST /api/[gymSlug]/overdue-cancel
 * Cron-callable (no JWT). Secured by CRON_SECRET token in request body.
 *
 * Body: { token: string, dryRun?: boolean }
 *
 * For each past_due / unpaid Stripe subscription:
 *   1–13 days overdue  → fire Zapier warning webhook
 *  14+  days overdue  → cancel sub, set member CANCELED, delete Seam code, fire Zapier cancel webhook
 *
 * dryRun:true skips every Stripe mutation, DB write (including the phone
 * write-back below), and Zapier fetch — it only computes and returns the
 * payloads that would have been sent, for safe testing against real data.
 */

/**
 * Resolves the phone number to notify for one overdue subscription:
 *   1. Member.phone from the DB (already matched by gymId + email).
 *   2. Otherwise, the Stripe customer's phone — using the subscription's
 *      already-expanded customer if present, else retrieving it directly
 *      (a plain string id means the expand didn't resolve).
 *   3. If (2) found something and Member.phone was null, write it back —
 *      skipped entirely in dryRun.
 * Returns the raw phone string (DB-formatted convention) or null.
 */
async function resolvePhone({ stripe, member, sub, gymSlug, email, dryRun }) {
  if (member?.phone) return member.phone

  let stripePhone = null
  if (sub.customer && typeof sub.customer === 'object') {
    stripePhone = sub.customer.phone || null
  } else if (sub.customer) {
    try {
      const customer = await stripe.customers.retrieve(sub.customer)
      stripePhone = customer?.phone || null
    } catch (err) {
      console.error('[overdue-cancel] customer retrieve failed for %s: %s', sub.customer, err.message)
    }
  }

  if (stripePhone) {
    const formatted = formatPhone(stripePhone)
    if (member && !dryRun) {
      await prisma.member.update({ where: { id: member.id }, data: { phone: formatted } })
    }
    return formatted
  }

  console.log('[overdue-cancel] no phone for %s gym=%s', email, gymSlug)
  return null
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params

    // ── Auth ──────────────────────────────────────────────────────────────────
    const bodyText = await request.text()
    const body     = bodyText ? JSON.parse(bodyText) : {}
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || body.token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dryRun = body.dryRun === true

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
      return NextResponse.json({
        ok: true, processed: 0, warnings: 0, canceled: 0,
        ...(dryRun ? { dryRun: true, payloads: [] } : {}),
      })
    }

    // ── Batch-fetch matching DB members ───────────────────────────────────────
    const emails = [...new Set(
      subs.map(s => s.customer?.email?.toLowerCase().trim()).filter(Boolean)
    )]
    const dbMembers = await prisma.member.findMany({
      where:  { gymId: gym.id, email: { in: emails } },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        accessCode: true, stripeSubscriptionId: true, status: true,
      },
    })
    const memberByEmail = {}
    for (const m of dbMembers) {
      if (m.email) memberByEmail[m.email.toLowerCase()] = m
    }

    const zapierUrl = gym.zapierOverdueWebhookUrl || process.env.ZAPIER_OVERDUE_WEBHOOK_URL
    const nowSecs   = Math.floor(Date.now() / 1000)

    let warnings = 0
    let canceled = 0
    const payloads = dryRun ? [] : null

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
      const invoiceCreated = typeof inv === 'object' && inv !== null ? inv.created           : null
      const invoiceUrl     = typeof inv === 'object' && inv !== null ? inv.hosted_invoice_url : null
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

      // Phone for the outbound Zapier payload — resolved only once we know
      // this sub is actually going to produce a warning or cancel event.
      const resolvedPhone = await resolvePhone({ stripe, member, sub, gymSlug, email, dryRun })
      let phone = ''
      if (resolvedPhone) {
        const e164 = toE164(resolvedPhone)
        if (e164) {
          phone = e164
        } else {
          console.log('[overdue-cancel] phone could not be normalized to E.164 for %s gym=%s value=%s', email, gymSlug, resolvedPhone)
        }
      }

      if (daysOverdue >= 14) {
        // ── Cancel ─────────────────────────────────────────────────────────────

        if (!dryRun) {
          // 1. Cancel Stripe subscription immediately
          try {
            await stripe.subscriptions.cancel(sub.id)
            console.log('[overdue-cancel] canceled Stripe sub %s', sub.id)
          } catch (err) {
            console.error('[overdue-cancel] Stripe cancel error for %s: %s', sub.id, err.message)
          }

          // 2. Update DB member status
          if (member && member.status !== 'CANCELED') {
            await prisma.member.update({
              where: { id: member.id },
              data:  { status: 'CANCELED', dateCanceled: new Date() },
            })
            await prisma.membershipEvent.create({
              data: { memberId: member.id, gymId: gym.id, type: 'canceled' },
            })
            console.log('[overdue-cancel] set member %s CANCELED', member.id)
          }

          // 3. Delete Seam access code and clear from DB
          if (accessCode) {
            const seamKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
            if (seamKey) {
              await deleteSeamCodeByPin(seamKey, accessCode, gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID, '[overdue-cancel]')
            }
            if (member) {
              await prisma.member.update({ where: { id: member.id }, data: { accessCode: null } })
            }
          }
        }

        // 4. Zapier cancel webhook (fire-and-forget) — or, in dryRun, just
        // record what would have been sent.
        const cancelPayload = { name, email, status: 'overdue_canceled', daysOverdue, invoiceUrl, phone }
        if (dryRun) {
          payloads.push({ type: 'overdue_canceled', payload: cancelPayload })
        } else if (zapierUrl) {
          fetch(zapierUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(cancelPayload),
          }).catch(e => console.error('[overdue-cancel] zapier cancel webhook error:', e.message))
        }

        canceled++
      } else {
        // ── Warning (day 1, 7, or 13 only) ───────────────────────────────────────

        if ([1, 7, 13].includes(daysOverdue)) {
          const warningPayload = { name, email, accessCode, status: 'overdue_warning', daysOverdue, invoiceUrl, phone }
          if (dryRun) {
            payloads.push({ type: 'overdue_warning', payload: warningPayload })
            warnings++
          } else if (zapierUrl) {
            fetch(zapierUrl, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(warningPayload),
            }).catch(e => console.error('[overdue-cancel] zapier warning webhook error:', e.message))
            warnings++
          }
        }
      }
    }

    console.log(
      '[overdue-cancel] gym=%s total=%d warnings=%d canceled=%d',
      gymSlug, subs.length, warnings, canceled,
    )

    return NextResponse.json({
      ok: true, processed: subs.length, warnings, canceled,
      ...(dryRun ? { dryRun: true, payloads } : {}),
    })
  } catch (error) {
    console.error('[overdue-cancel]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
