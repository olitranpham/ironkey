import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { hit, clientIp, tooManyRequests } from '@/lib/rateLimit'
import { getOverdueState, overdueAuditMeta, payOpenInvoices } from '@/lib/overdue'
import { requireMemberSession } from '@/lib/memberSession'
import { writeAudit } from '@/lib/audit'

// 3 attempts per hour, per member and per IP — each attempt can charge a card
const PAY_LIMIT = { limit: 3, windowSec: 60 * 60 }

/**
 * POST /api/[gymSlug]/membership-request/pay
 * Member session required (email code → cookie, see /verify). No body — it
 * always pays for the signed-in member.
 *
 * Retries the open invoice(s) on the member's OWN membership subscription with
 * the card on file — nothing else is ever charged. Oldest first, stopping at
 * the first decline. Never returns invoice or card details.
 *
 *   nothing owed → { ok: true, paid: false, nothingOwed: true, overdue: false }
 *   paid     → { ok: true, paid: true, overdue }  (OVERDUE → ACTIVE via getOverdueState)
 *   declined → { ok: false, paid: false, declined: true, updatePaymentUrl } — Stripe's
 *              hosted page for that one invoice (pay it with another card; it
 *              doesn't change the saved card — "update payment method" does)
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const { gym, member, errorResponse } = await requireMemberSession(request, gymSlug, { gymSelect: { stripeSecretKey: true } })
    if (errorResponse) return errorResponse

    const checks = await Promise.all([
      hit(`membership-pay:ip:${clientIp(request)}`, PAY_LIMIT.limit, PAY_LIMIT.windowSec),
      hit(`membership-pay:member:${member.id}`,     PAY_LIMIT.limit, PAY_LIMIT.windowSec),
    ])
    const blocked = checks.filter(c => !c.allowed)
    if (blocked.length) return tooManyRequests(Math.max(...blocked.map(c => c.retryAfterSec)))

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
    const result = await payOpenInvoices(stripe, before.openInvoices, { logPrefix: '[membership-pay]', memberId: member.id })
    if (!result.paid) {
      writeAudit({ gym, user: null }, 'billing.self_pay_declined', 'Member', member.id, { invoiceId: result.declined.id, ...overdueAuditMeta(before) })
      return NextResponse.json({ ok: false, paid: false, declined: true, updatePaymentUrl: result.declined.hostedInvoiceUrl })
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
