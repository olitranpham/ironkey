import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import {
  requireBillingAdmin, resolvePaymentMethod, trainerVisits, amountForVisits, monthRange, zonedMidnight,
  VISIT_CAP, BILLING_TIME_ZONE,
} from '@/lib/trainerBilling'
import { stripeErrorCopy } from '@/lib/stripePriceToggle'

/**
 * GET /api/[gymSlug]/pt/trainer-billing[?month=YYYY-MM]
 * OWNER / ADMIN. Per trainer: linked promotion code and Stripe customer,
 * billing status, payment method (or a "none" flag), the month's visits
 * (guest passes bought with the code — same-day repeats flagged), visits
 * metered so far, amount so far (min(visits × $20, $500)), cap reached, and
 * past invoices. Also the gym's active promotion codes for the code picker.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requireBillingAdmin(request, gymSlug)
    if (errorResponse) return errorResponse
    const gym = await prisma.gym.findUnique({ where: { id: ctx.gym.id }, select: { id: true, stripeSecretKey: true } })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'stripe isn’t connected for this gym' }, { status: 400 })
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const monthParam = new URL(request.url).searchParams.get('month')
    let range = monthRange()
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number)
      range = { start: new Date(zonedMidnight(y, m - 1, 1)), end: new Date(zonedMidnight(y, m, 1)) }
    }
    const month = range.start.toLocaleDateString('en-CA', { timeZone: BILLING_TIME_ZONE }).slice(0, 7)

    const [trainers, promos] = await Promise.all([
      prisma.personalTrainer.findMany({ where: { gymId: gym.id }, orderBy: { name: 'asc' } }),
      stripe.promotionCodes.list({ active: true, limit: 100 }),
    ])
    const codeById = new Map(promos.data.map(p => [p.id, p.code]))

    const rows = await Promise.all(trainers.map(async t => {
      const visits = await trainerVisits(gym.id, t.promotionCodeId, range.start, range.end)
      let customerLabel = null, paymentMethod = null, subscription = null, invoices = []
      if (t.stripeCustomerId) {
        const member = await prisma.member.findFirst({ where: { gymId: gym.id, stripeCustomerId: t.stripeCustomerId }, select: { firstName: true, lastName: true, email: true } })
        customerLabel = member ? `${member.firstName} ${member.lastName} (${member.email}) — member` : t.stripeCustomerId
        paymentMethod = await resolvePaymentMethod(stripe, t.stripeCustomerId).catch(() => null)
      }
      if (t.billingSubscriptionId) {
        const sub = await stripe.subscriptions.retrieve(t.billingSubscriptionId).catch(() => null)
        subscription = sub && { id: sub.id, status: sub.status, startedAt: new Date(sub.start_date * 1000).toISOString(), nextInvoiceAt: new Date(sub.current_period_end * 1000).toISOString() }
        const inv = await stripe.invoices.list({ subscription: t.billingSubscriptionId, limit: 24 }).catch(() => ({ data: [] }))
        // $0.00 invoices (e.g. the one Stripe makes when billing starts) aren't worth listing
        invoices = inv.data.filter(i => i.total !== 0).map(i => ({
          id: i.id, number: i.number, status: i.status, total: i.total, amountPaid: i.amount_paid,
          periodStart: new Date(i.period_start * 1000).toISOString(), periodEnd: new Date(i.period_end * 1000).toISOString(),
          url: i.hosted_invoice_url,
        }))
      }
      // Pre-billing invoice items (addTrainerInvoiceItem) cover visits from
      // before metering started — matched to a visit by its date (metadata
      // ironkey_visit_date, else the "pt visit YYYY-MM-DD" description).
      // Pending or already invoiced, the visit is billed either way.
      const preBilling = new Map()   // 'YYYY-MM-DD' → [amount cents, …]
      if (t.stripeCustomerId && t.billingSubscriptionId) {
        const items = await stripe.invoiceItems.list({ customer: t.stripeCustomerId, limit: 100 }).catch(() => ({ data: [] }))
        for (const ii of items.data) {
          const sub = typeof ii.subscription === 'string' ? ii.subscription : ii.subscription?.id
          if (ii.metadata?.ironkey_kind !== 'trainer_billing' || sub !== t.billingSubscriptionId) continue
          const day = ii.metadata?.ironkey_visit_date ?? /pt visit (\d{4}-\d{2}-\d{2})/.exec(ii.description ?? '')?.[1]
          if (day) (preBilling.get(day) ?? preBilling.set(day, []).get(day)).push(ii.amount)
        }
      }
      let metered = 0, preBilled = 0, preBillingCents = 0
      for (const v of visits) {
        if (v.metered) { v.billed = 'yes'; metered++; continue }
        const amount = preBilling.get(v.day)?.shift()
        if (amount != null) { v.billed = 'pre-billing'; preBilled++; preBillingCents += amount }
        else v.billed = 'no'
      }

      return {
        id: t.id, name: t.name,
        promotionCodeId: t.promotionCodeId, promotionCode: t.promotionCodeId ? (codeById.get(t.promotionCodeId) ?? t.promotionCodeId) : null,
        stripeCustomerId: t.stripeCustomerId, customerLabel,
        paymentMethod, billing: subscription,
        month: {
          visits:       visits.length,
          billedVisits: metered + preBilled,
          amountCents:  amountForVisits(metered) + preBillingCents,
          capReached:   metered >= VISIT_CAP,
        },
        visits, invoices,
      }
    }))

    return NextResponse.json({ month, trainers: rows, promotionCodes: promos.data.map(p => ({ id: p.id, code: p.code })) })
  } catch (error) {
    console.error('[pt/trainer-billing GET]', error.type ?? '', error.message)
    return NextResponse.json({ error: error.type ? stripeErrorCopy(error) : 'Internal server error' }, { status: 500 })
  }
}
