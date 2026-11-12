// Whether a membership is overdue, for blocking freeze / cancel. Stripe is the
// source of truth whenever it can be reached: past_due / unpaid, or any open
// invoice on the membership subscription, is overdue (the webhook leaves
// past_due members ACTIVE, so the DB alone misses them). An OVERDUE flag on a
// subscription that's active with nothing open is stale — it's cleared to
// ACTIVE (audited). Member.status is only trusted when Stripe can't be checked.

import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { overdueMessage } from '@/lib/overdueMessage'

export const OVERDUE_MESSAGE = overdueMessage()

const OVERDUE_STRIPE_STATUSES = new Set(['past_due', 'unpaid'])
const ACTIVE_STRIPE_STATUSES  = new Set(['active', 'trialing'])

/**
 * @param {{ id?: string, stripeSecretKey?: string|null }} gym
 * @param {{ id: string, gymId?: string, status: string, stripeSubscriptionId?: string|null }} member
 * @param {{ clearReason?: string }} [options]  audit reason when a stale OVERDUE flag is cleared
 * @returns {Promise<{
 *   overdue: boolean,
 *   memberStatus: string,
 *   stripeStatus: string|null,     // subscription status, null if not checked
 *   stripeChecked: boolean,        // false: no subscription/key, or Stripe unreachable (DB status only)
 *   clearedStaleFlag: boolean,     // OVERDUE → ACTIVE because Stripe shows nothing owed
 *   amountDue: number,             // cents, summed over the subscription's open invoices
 *   currency: string|null,
 *   openInvoices: { id: string, amountRemaining: number, hostedInvoiceUrl: string|null }[], // oldest first
 * }>}
 */
export async function getOverdueState(gym, member, { clearReason = 'cleared stale overdue flag' } = {}) {
  const state = {
    overdue:          member.status === 'OVERDUE',   // DB fallback until Stripe answers
    memberStatus:     member.status,
    stripeStatus:     null,
    stripeChecked:    false,
    clearedStaleFlag: false,
    amountDue:        0,
    currency:         null,
    openInvoices:     [],
  }
  if (!member.stripeSubscriptionId || !gym?.stripeSecretKey) return state

  try {
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const [sub, invoices] = await Promise.all([
      stripe.subscriptions.retrieve(member.stripeSubscriptionId),
      stripe.invoices.list({ subscription: member.stripeSubscriptionId, status: 'open', limit: 20 }),
    ])
    state.stripeStatus  = sub.status
    state.stripeChecked = true
    state.openInvoices = invoices.data
      .filter(inv => inv.subscription === member.stripeSubscriptionId && inv.customer === sub.customer)
      .sort((a, b) => a.created - b.created)
      .map(inv => ({ id: inv.id, amountRemaining: inv.amount_remaining ?? 0, hostedInvoiceUrl: inv.hosted_invoice_url ?? null }))
    state.amountDue = state.openInvoices.reduce((sum, inv) => sum + inv.amountRemaining, 0)
    state.currency  = invoices.data[0]?.currency ?? null
    // Stripe decides now — the DB flag no longer counts
    state.overdue = OVERDUE_STRIPE_STATUSES.has(sub.status) || state.openInvoices.length > 0
  } catch (err) {
    // Stripe unreachable — fall back to the DB status rather than blocking on an outage
    console.error('[overdue] Stripe check failed for member %s: %s', member.id, err.message)
    return state
  }

  // Stale flag: marked OVERDUE, but the subscription is active with nothing open
  if (member.status === 'OVERDUE' && !state.overdue && ACTIVE_STRIPE_STATUSES.has(state.stripeStatus)) {
    const { count } = await prisma.member.updateMany({ where: { id: member.id, status: 'OVERDUE' }, data: { status: 'ACTIVE' } })
    if (count === 1) {
      state.clearedStaleFlag = true
      state.memberStatus     = 'ACTIVE'
      const gymId = gym?.id ?? member.gymId ?? (await prisma.member.findUnique({ where: { id: member.id }, select: { gymId: true } }))?.gymId
      writeAudit({ gym: { id: gymId }, user: null }, 'member.overdue_cleared', 'Member', member.id, { reason: clearReason, stripeStatus: state.stripeStatus })
      console.log('[overdue] %s — member %s OVERDUE → ACTIVE (stripe %s, nothing open)', clearReason, member.id, state.stripeStatus)
    }
  }
  return state
}

/** 2500, 'usd' → "$25.00" */
export function formatAmount(cents, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((cents ?? 0) / 100)
}

/** Audit meta describing the overdue balance. */
export function overdueAuditMeta(state) {
  return {
    amountDue:    state.amountDue,
    amountDueFmt: formatAmount(state.amountDue, state.currency),
    currency:     state.currency,
    memberStatus: state.memberStatus,
    stripeStatus: state.stripeStatus,
    openInvoices: state.openInvoices.map(i => i.id),
  }
}
