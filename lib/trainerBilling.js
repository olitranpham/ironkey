// Outside-trainer billing: each guest pass bought with a trainer's promotion
// code is one billable visit. Billed through Stripe Billing Meters on the
// gym's connected account:
//   meter  "pt_visits"            — one event (value 1) per visit, per customer
//   price  lookup_key below       — monthly, metered, graduated tiers:
//                                   visits 1–25 at $20, 26+ at $0 ($500 cap,
//                                   enforced by Stripe per billing period)
//   subscription per trainer      — anchored to the 1st, 00:00 America/New_York
// Ironkey never computes the bill; the visit list and month-to-date figures
// are for staff to verify.
import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { withGymContext } from '@/lib/auth/gymContext'

export const METER_EVENT_NAME   = 'pt_visits'
export const PRICE_LOOKUP_KEY   = 'ironkey_pt_visits_monthly'
export const VISIT_RATE_CENTS   = 2000
export const VISIT_CAP          = 25
export const BILLING_TIME_ZONE  = 'America/New_York'
export const BILLING_PRODUCT_KIND = 'trainer_billing'   // product metadata ironkey_kind

const idOf = v => (typeof v === 'string' ? v : v?.id ?? null)

/** UTC ms of 00:00 on y-m-d (m 0-based) in `timeZone`. */
export function zonedMidnight(y, m, d, timeZone = BILLING_TIME_ZONE) {
  const guess = Date.UTC(y, m, d)
  const inZone = new Date(new Date(guess).toLocaleString('en-US', { timeZone }))
  const inUtc  = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }))
  return guess - (inZone - inUtc)
}

/** { start, end } (Dates) of the calendar month containing `date`, in Boston time. */
export function monthRange(date = new Date(), timeZone = BILLING_TIME_ZONE) {
  const [y, m] = date.toLocaleDateString('en-CA', { timeZone }).split('-').map(Number)
  return { start: new Date(zonedMidnight(y, m - 1, 1, timeZone)), end: new Date(zonedMidnight(y, m, 1, timeZone)) }
}

/** The next 1st of the month, 00:00 Boston time, as a unix timestamp. */
export function nextMonthAnchor(now = new Date()) {
  return Math.floor(monthRange(now).end / 1000)
}

/** The pt_visits meter and its graduated monthly price, created on first use. */
export async function ensureMeterAndPrice(stripe) {
  let meter = null
  for await (const m of stripe.billing.meters.list({ status: 'active', limit: 100 })) {
    if (m.event_name === METER_EVENT_NAME) { meter = m; break }
  }
  if (!meter) {
    meter = await stripe.billing.meters.create({
      display_name:      'PT visits',
      event_name:        METER_EVENT_NAME,
      default_aggregation: { formula: 'sum' },
      customer_mapping:  { event_payload_key: 'stripe_customer_id', type: 'by_id' },
      value_settings:    { event_payload_key: 'value' },
    })
    console.log('[trainer-billing] created meter %s', meter.id)
  }

  let price = (await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 })).data[0] ?? null
  if (!price) {
    price = await stripe.prices.create({
      currency:      'usd',
      lookup_key:    PRICE_LOOKUP_KEY,
      nickname:      'outside trainer visits — $20 each, $500 / month cap',
      billing_scheme: 'tiered',
      tiers_mode:    'graduated',
      tiers:         [{ up_to: VISIT_CAP, unit_amount: VISIT_RATE_CENTS }, { up_to: 'inf', unit_amount: 0 }],
      recurring:     { interval: 'month', usage_type: 'metered', meter: meter.id },
      product_data:  { name: 'Outside trainer PT visits', metadata: { ironkey_kind: BILLING_PRODUCT_KIND } },
    })
    console.log('[trainer-billing] created price %s', price.id)
  }
  return { meter, price }
}

function describePm(pm, source) {
  if (!pm || typeof pm === 'string') return null
  return {
    id:     pm.id,
    source,                                     // 'customer default' | 'membership subscription'
    brand:  pm.card?.brand ?? pm.type,
    last4:  pm.card?.last4 ?? pm.us_bank_account?.last4 ?? null,
    exp:    pm.card ? `${String(pm.card.exp_month).padStart(2, '0')}/${pm.card.exp_year}` : null,
  }
}

/**
 * The payment method to bill a trainer: the customer's invoice default, else
 * the default on their active (non-trainer-billing) subscription — e.g. a
 * trainer who is also a member. null when neither exists.
 */
export async function resolvePaymentMethod(stripe, customerId) {
  const customer = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] })
  if (customer.deleted) return null
  const fromCustomer = describePm(customer.invoice_settings?.default_payment_method, 'customer default')
  if (fromCustomer) return fromCustomer
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10, expand: ['data.default_payment_method'] })
  for (const sub of subs.data) {
    if (sub.metadata?.ironkey_kind === BILLING_PRODUCT_KIND) continue
    const pm = describePm(sub.default_payment_method, 'membership subscription')
    if (pm) return pm
  }
  return null
}

/**
 * Start a trainer's monthly metered subscription, anchored to the next 1st
 * (Boston time) with normal proration. `paymentMethodId` must be the one
 * staff confirmed (resolvePaymentMethod) — it's re-checked here.
 */
export async function startTrainerBilling(stripe, trainer, paymentMethodId) {
  if (trainer.billingSubscriptionId) throw Object.assign(new Error('billing already started'), { status: 409 })
  if (!trainer.stripeCustomerId)    throw Object.assign(new Error('link a stripe customer first'), { status: 400 })
  if (!trainer.promotionCodeId)     throw Object.assign(new Error('link a promotion code first'), { status: 400 })
  const pm = await resolvePaymentMethod(stripe, trainer.stripeCustomerId)
  if (!pm)                          throw Object.assign(new Error('no payment method on file — send a card setup link first'), { status: 400 })
  if (pm.id !== paymentMethodId)    throw Object.assign(new Error('the payment method changed — refresh and confirm again'), { status: 409 })

  const { price } = await ensureMeterAndPrice(stripe)
  const sub = await stripe.subscriptions.create({
    customer:               trainer.stripeCustomerId,
    items:                  [{ price: price.id }],
    billing_cycle_anchor:   nextMonthAnchor(),
    proration_behavior:     'create_prorations',
    default_payment_method: pm.id,
    metadata:               { ironkey_kind: BILLING_PRODUCT_KIND, ironkey_trainer_id: trainer.id },
  })
  await prisma.personalTrainer.update({ where: { id: trainer.id }, data: { billingSubscriptionId: sub.id } })
  return { subscription: sub, paymentMethod: pm }
}

/** Stripe-hosted page (setup mode) where a trainer saves a card for billing. */
export async function createCardSetupLink(stripe, trainer, origin, gymSlug) {
  if (!trainer.stripeCustomerId) throw Object.assign(new Error('link a stripe customer first'), { status: 400 })
  const session = await stripe.checkout.sessions.create({
    mode:                 'setup',
    customer:             trainer.stripeCustomerId,
    currency:             'usd',
    payment_method_types: ['card'],
    success_url:          `${origin}/${gymSlug}/join/card-saved`,
    cancel_url:           `${origin}/${gymSlug}/join/card-saved?canceled=1`,
    metadata:             { ironkey_kind: 'trainer_card_setup', ironkey_trainer_id: trainer.id },
  })
  return session.url
}

/**
 * Webhook: a trainer's card-setup session completed — make the saved card the
 * customer's invoice default (and the billing subscription's, if started).
 */
export async function handleCardSetupCompleted(stripe, gym, session) {
  const trainer = await prisma.personalTrainer.findFirst({
    where:  { id: session.metadata?.ironkey_trainer_id, gymId: gym.id },
    select: { id: true, stripeCustomerId: true, billingSubscriptionId: true },
  })
  if (!trainer || !session.setup_intent) return
  const intent = await stripe.setupIntents.retrieve(idOf(session.setup_intent))
  const pmId   = idOf(intent.payment_method)
  if (!pmId) return
  await stripe.customers.update(trainer.stripeCustomerId, { invoice_settings: { default_payment_method: pmId } })
  if (trainer.billingSubscriptionId) {
    await stripe.subscriptions.update(trainer.billingSubscriptionId, { default_payment_method: pmId })
  }
  console.log('[trainer-billing] card saved for trainer=%s', trainer.id)
}

/**
 * Webhook, guest pass purchase: store the promotion code on the pass, and if
 * it's a billing trainer's code at this gym, send one pt_visits meter event
 * (identifier = session id; the pass's meterEventSentAt makes it once-only).
 * Never throws — a failed meter event is logged and audited for follow-up.
 */
export async function recordPassPromotion(stripe, gym, session, passId) {
  try {
    const discount = (session.discounts ?? []).find(d => d.promotion_code)
    const promoId  = idOf(discount?.promotion_code)
    if (!promoId) return
    let code = session.metadata?.promotionCode ?? null
    if (!code) code = await stripe.promotionCodes.retrieve(promoId).then(p => p.code).catch(() => null)
    await prisma.guestVisit.update({ where: { id: passId }, data: { promotionCodeId: promoId, promotionCode: code } })

    // Trainers are per gym, so a code from another gym's account never matches
    const trainer = await prisma.personalTrainer.findFirst({
      where:  { gymId: gym.id, promotionCodeId: promoId, billingSubscriptionId: { not: null }, stripeCustomerId: { not: null } },
      select: { id: true, stripeCustomerId: true },
    })
    if (!trainer) return

    const { count } = await prisma.guestVisit.updateMany({ where: { id: passId, meterEventSentAt: null }, data: { meterEventSentAt: new Date() } })
    if (!count) return   // already metered
    try {
      await stripe.billing.meterEvents.create({
        event_name: METER_EVENT_NAME,
        identifier: session.id,
        payload:    { stripe_customer_id: trainer.stripeCustomerId, value: '1' },
      })
      console.log('[trainer-billing] visit metered trainer=%s pass=%s session=%s', trainer.id, passId, session.id)
    } catch (err) {
      await prisma.guestVisit.update({ where: { id: passId }, data: { meterEventSentAt: null } })
      console.error('[trainer-billing] meter event failed trainer=%s session=%s: %s', trainer.id, session.id, err.message)
      writeAudit({ gym, user: null }, 'trainer.meter_event_failed', 'GuestPass', passId, { trainerId: trainer.id, session: session.id })
    }
  } catch (err) {
    console.error('[trainer-billing] recordPassPromotion failed session=%s: %s', session.id, err.message)
  }
}

/** Visits (guest passes with the trainer's code) in [start, end), oldest first, same-day repeats flagged. */
export async function trainerVisits(gymId, promotionCodeId, start, end) {
  if (!promotionCodeId) return []
  const passes = await prisma.guestVisit.findMany({
    where:   { gymId, promotionCodeId, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, createdAt: true, guestName: true, guestEmail: true, guestProfileId: true, stripeSessionId: true, meterEventSentAt: true, guestProfile: { select: { name: true, email: true } } },
  })
  const seen = new Map()
  return passes.map(p => {
    const day   = p.createdAt.toLocaleDateString('en-CA', { timeZone: BILLING_TIME_ZONE })
    const guest = p.guestProfileId ?? (p.guestEmail ?? p.guestName ?? '').toLowerCase()
    const key   = `${guest}|${day}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
    return {
      id:          p.id,
      date:        p.createdAt.toISOString(),
      day,
      guestName:   p.guestProfile?.name || p.guestName,
      sessionId:   p.stripeSessionId,
      metered:     Boolean(p.meterEventSentAt),
      sameDayRepeat: seen.get(key) > 1,
    }
  })
}

/** Amount so far for `billedVisits` this period — mirrors the price tiers. */
export function amountForVisits(billedVisits) {
  return Math.min(billedVisits, VISIT_CAP) * VISIT_RATE_CENTS
}

/** Route guard: trainer billing is OWNER / ADMIN only. */
export async function requireBillingAdmin(request, gymSlug) {
  const { ctx, errorResponse } = await withGymContext(request, gymSlug)
  if (errorResponse) return { errorResponse }
  if (!['OWNER', 'ADMIN'].includes(ctx.user.role)) {
    return { errorResponse: NextResponse.json({ error: 'only an owner or admin can manage trainer billing' }, { status: 403 }) }
  }
  return { ctx }
}
