// Member card on file + "update payment method". Same mechanism as the
// trainer card-setup link (lib/trainerBilling.js): a Stripe Checkout session
// in setup mode on the gym's account, finished by checkout.session.completed
// in the webhook — which makes the card the default and retries any open
// membership invoice with it. No card details ever touch our servers.

import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { getOverdueState, payOpenInvoices, overdueAuditMeta } from '@/lib/overdue'

export const MEMBER_CARD_SETUP_KIND = 'member_card_setup'

const idOf = v => (typeof v === 'string' ? v : v?.id ?? null)

export function gymStripe(gym) {
  if (!gym?.stripeSecretKey) throw Object.assign(new Error('stripe is not connected for this gym'), { status: 422 })
  return new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
}

export function appOrigin(request) {
  return process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? `https://${request.headers.get('host')}`
}

// A card → brand / last 4 / expiry. Any other default payment method gets a
// `label` instead: Link → "link (<email>)", a US bank account → "bank •••• 1234",
// anything else → its Stripe type name.
function paymentMethodSummary(pm) {
  if (!pm) return null
  const card = pm.card
  if (card) return { id: pm.id, brand: card.brand ?? 'card', last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year }
  if (pm.type === 'link') return { id: pm.id, type: 'link', label: pm.link?.email ? `link (${pm.link.email})` : 'link' }
  if (pm.type === 'us_bank_account') return { id: pm.id, type: pm.type, label: `bank •••• ${pm.us_bank_account?.last4 ?? '????'}` }
  return { id: pm.id, type: pm.type, label: String(pm.type ?? 'payment method').replace(/_/g, ' ') }
}

/**
 * The card the membership is charged with: the subscription's default payment
 * method, else the customer's invoice default, else a legacy default card
 * source. null when there's no customer or no card.
 *
 * @returns {Promise<{ id, brand, last4, expMonth, expYear } | { id, type, label } | null>}
 */
export async function cardOnFile(stripe, member) {
  if (!member.stripeCustomerId) return null
  const [customer, sub] = await Promise.all([
    stripe.customers.retrieve(member.stripeCustomerId, { expand: ['invoice_settings.default_payment_method', 'default_source'] }),
    member.stripeSubscriptionId
      ? stripe.subscriptions.retrieve(member.stripeSubscriptionId, { expand: ['default_payment_method'] }).catch(() => null)
      : null,
  ])
  if (customer?.deleted) return null
  // A subscription that isn't this customer's is ignored (bad data, never shown)
  const subPm = sub && idOf(sub.customer) === member.stripeCustomerId ? sub.default_payment_method : null
  const pm    = subPm || customer?.invoice_settings?.default_payment_method
  if (pm && typeof pm === 'object') return paymentMethodSummary(pm)
  const source = customer?.default_source
  if (source && typeof source === 'object' && source.object === 'card') {
    return { id: source.id, brand: source.brand?.toLowerCase() ?? 'card', last4: source.last4, expMonth: source.exp_month, expYear: source.exp_year }
  }
  return null
}

/**
 * Stripe-hosted setup page for this member's own customer. Returns the URL
 * and its actual expiry (Checkout's expires_at, 24h by default).
 *
 * @param {'member'|'staff'} source  who asked for it — recorded in metadata
 */
export async function createMemberCardSetupSession(stripe, gym, member, { origin, source, actorId = null }) {
  if (!member.stripeCustomerId) throw Object.assign(new Error('this member has no stripe customer'), { status: 400 })
  const back = `${origin}/${gym.slug}/membership`
  const metadata = {
    ironkey_kind:      MEMBER_CARD_SETUP_KIND,
    ironkey_member_id: member.id,
    ironkey_gym_id:    gym.id,
    ironkey_source:    source,
    ...(actorId ? { ironkey_actor_id: actorId } : {}),
  }
  const session = await stripe.checkout.sessions.create({
    mode:                 'setup',
    customer:             member.stripeCustomerId,
    currency:             'usd',
    payment_method_types: ['card'],
    success_url:          `${back}?card=saved`,
    cancel_url:           `${back}?card=canceled`,
    metadata,
    setup_intent_data:    { metadata },
  })
  return { url: session.url, sessionId: session.id, expiresAt: new Date(session.expires_at * 1000).toISOString() }
}

/**
 * Webhook: a member finished the setup page. Make the card the default for
 * the customer and the membership subscription, then retry open membership
 * invoices with it (the same retry as "pay now"). Every step is audited.
 * Never throws for bad input — a session that doesn't match its member and
 * gym is logged and ignored.
 */
export async function handleMemberCardSetupCompleted(stripe, gym, session) {
  const meta   = session.metadata ?? {}
  const member = await prisma.member.findFirst({
    where:  { id: meta.ironkey_member_id, gymId: gym.id },
    select: { id: true, gymId: true, status: true, stripeCustomerId: true, stripeSubscriptionId: true },
  })
  if (!member || !member.stripeCustomerId || idOf(session.customer) !== member.stripeCustomerId || (meta.ironkey_gym_id && meta.ironkey_gym_id !== gym.id)) {
    console.warn('[member-billing] card setup session %s does not match a member of gym %s — ignored', session.id, gym.id)
    return
  }
  if (!session.setup_intent) return

  const intent = await stripe.setupIntents.retrieve(idOf(session.setup_intent))
  const pmId   = idOf(intent.payment_method)
  if (!pmId || intent.status !== 'succeeded') return

  await stripe.customers.update(member.stripeCustomerId, { invoice_settings: { default_payment_method: pmId } })
  if (member.stripeSubscriptionId) {
    await stripe.subscriptions.update(member.stripeSubscriptionId, { default_payment_method: pmId })
  }
  const auditCtx = { gym, user: meta.ironkey_actor_id ? { id: meta.ironkey_actor_id } : null }
  writeAudit(auditCtx, 'member.payment_method_updated', 'Member', member.id, { source: meta.ironkey_source ?? null, sessionId: session.id })
  console.log('[member-billing] card saved for member=%s (source %s)', member.id, meta.ironkey_source ?? '?')

  // Retry whatever is open on the membership with the new card
  const before = await getOverdueState(gym, member)
  if (!before.stripeChecked || before.openInvoices.length === 0) return
  const result = await payOpenInvoices(stripe, before.openInvoices, { paymentMethod: pmId, logPrefix: '[member-billing]', memberId: member.id })
  writeAudit(auditCtx, result.paid ? 'billing.card_update_paid' : 'billing.card_update_declined', 'Member', member.id, {
    ...overdueAuditMeta(before), paidInvoices: result.paidIds, declinedInvoice: result.declined?.id ?? null,
  })
  if (result.paid) await getOverdueState(gym, member, { clearReason: 'cleared overdue flag after card update' })
}
