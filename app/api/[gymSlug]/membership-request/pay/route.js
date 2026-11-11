import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { hit, clientIp, tooManyRequests } from '@/lib/rateLimit'
import { getOverdueState, overdueAuditMeta } from '@/lib/overdue'
import { writeAudit } from '@/lib/audit'

// 3 attempts per hour, per email and per IP — each attempt can charge a card
const PAY_LIMIT = { limit: 3, windowSec: 60 * 60 }

/**
 * POST /api/[gymSlug]/membership-request/pay
 * Public (self-service membership page). Body: { email }
 *
 * Retries the open invoice(s) on the member's OWN membership subscription with
 * the card on file — nothing else is ever charged. Oldest first, stopping at
 * the first decline. Never returns invoice or card details.
 *
 *   nothing owed → { ok: true, paid: false, nothingOwed: true, overdue: false }
 *   paid     → { ok: true, paid: true, overdue }  (OVERDUE → ACTIVE via getOverdueState)
 *   declined → { ok: false, paid: false, updatePaymentUrl }  — Stripe's hosted
 *              page for that one invoice (pay it with another card; it can't
 *              change the saved card or the subscription)
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body  = await request.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

    const checks = await Promise.all([
      hit(`membership-pay:ip:${clientIp(request)}`, PAY_LIMIT.limit, PAY_LIMIT.windowSec),
      hit(`membership-pay:email:${email}`,           PAY_LIMIT.limit, PAY_LIMIT.windowSec),
    ])
    const blocked = checks.filter(c => !c.allowed)
    if (blocked.length) return tooManyRequests(Math.max(...blocked.map(c => c.retryAfterSec)))

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true, slug: true, stripeSecretKey: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where:  { gymId_email: { gymId: gym.id, email } },
      select: { id: true, status: true, stripeSubscriptionId: true },
    })
    if (!member) {
      return NextResponse.json({ error: "we couldn't find a membership associated with that email" }, { status: 404 })
    }

    // Already clear (this also clears a stale OVERDUE flag) → nothing to charge
    const before = await getOverdueState(gym, member)
    if (before.stripeChecked && !before.overdue) {
      return NextResponse.json({ ok: true, paid: false, nothingOwed: true, overdue: false })
    }
    if (!before.stripeChecked || before.openInvoices.length === 0) {
      return NextResponse.json({ ok: false, paid: false, error: "we couldn't find an open balance to pay. please contact the gym." }, { status: 409 })
    }

    // Only the open invoices on this member's own subscription (getOverdueState
    // lists them by member.stripeSubscriptionId and checks the customer)
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    for (const inv of before.openInvoices) {
      try {
        const paid = await stripe.invoices.pay(inv.id)
        if (paid.status !== 'paid') throw new Error(`invoice status ${paid.status}`)
      } catch (err) {
        console.warn('[membership-pay] invoice %s not paid for member %s: %s', inv.id, member.id, err.code ?? err.message)
        writeAudit({ gym, user: null }, 'billing.self_pay_declined', 'Member', member.id, { invoiceId: inv.id, ...overdueAuditMeta(before) })
        return NextResponse.json({ ok: false, paid: false, updatePaymentUrl: inv.hostedInvoiceUrl })
      }
    }

    writeAudit({ gym, user: null }, 'billing.self_pay', 'Member', member.id, overdueAuditMeta(before))
    // Re-check: with nothing left open, an OVERDUE member goes back to ACTIVE
    const after = await getOverdueState(gym, member, { clearReason: 'cleared overdue flag after payment' })
    return NextResponse.json({ ok: true, paid: true, overdue: after.overdue })
  } catch (error) {
    console.error('[membership-request/pay]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
