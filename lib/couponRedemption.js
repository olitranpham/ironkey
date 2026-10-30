import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

// Promotion code metadata flag set from the staff "add coupon" modal
export const ONCE_PER_CUSTOMER_KEY = 'ironkey_once_per_customer'

/** Buyer identity for once-per-customer: trimmed, lowercased email ('' if none). */
export const normalizeEmail = email => (typeof email === 'string' ? email.trim().toLowerCase() : '')

/** A buyer-facing promo code problem; checkout routes return it as a 400. */
export class PromoCodeError extends Error {}

export const promoCodeErrorResponse = err => NextResponse.json({ error: err.message }, { status: 400 })

/**
 * The buyer at this gym: the member with this email here, and the guest
 * profile with this email that has a pass here. Either may be null.
 *
 * @param {string} gymId
 * @param {string} email — already normalized
 * @returns {Promise<{ memberId: string | null, guestProfileId: string | null }>}
 */
export async function resolveBuyer(gymId, email) {
  const [member, guestProfile] = await Promise.all([
    prisma.member.findFirst({
      where:  { gymId, email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    }),
    prisma.guest.findFirst({
      where:  { email: { equals: email, mode: 'insensitive' }, passes: { some: { gymId } } },
      select: { id: true },
    }),
  ])
  return { memberId: member?.id ?? null, guestProfileId: guestProfile?.id ?? null }
}

/**
 * Validate a buyer-entered promo code before a Checkout session is created.
 * Checkouts pass the result's `discounts` instead of allow_promotion_codes,
 * so the code can't be swapped on Stripe's page afterwards.
 *
 * Once-per-customer codes are refused when this gym already has a
 * CouponRedemption for the code + normalized email.
 *
 * @param {import('stripe').Stripe} stripe — the gym's Stripe client
 * @param {{ id: string }} gym
 * @param {unknown} rawCode
 * @param {unknown} rawEmail
 * @returns {Promise<null | { discounts: object[], metadata: Record<string, string> }>} null when no code was entered
 * @throws {PromoCodeError}
 */
export async function preparePromotionCode(stripe, gym, rawCode, rawEmail) {
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  if (!code) return null

  const { data } = await stripe.promotionCodes.list({ code, active: true, limit: 1 })
  const promo = data[0]
  if (!promo) throw new PromoCodeError("that promo code isn't valid")
  if (promo.expires_at && promo.expires_at * 1000 <= Date.now()) throw new PromoCodeError('that promo code has expired')
  if (promo.max_redemptions && promo.times_redeemed >= promo.max_redemptions) {
    throw new PromoCodeError('that promo code has been fully redeemed')
  }

  const oncePerCustomer = promo.metadata?.[ONCE_PER_CUSTOMER_KEY] === 'true'
  if (oncePerCustomer) {
    const email = normalizeEmail(rawEmail)
    if (!email) throw new PromoCodeError('enter your email to use this promo code')
    const used = await prisma.couponRedemption.findUnique({
      where:  { gymId_promotionCodeId_email: { gymId: gym.id, promotionCodeId: promo.id, email } },
      select: { id: true },
    })
    if (used) throw new PromoCodeError('this promo code has already been used with this email')
  }

  return {
    discounts: [{ promotion_code: promo.id }],
    metadata:  {
      promotionCodeId: promo.id,
      promotionCode:   promo.code,
      ...(oncePerCustomer ? { oncePerCustomer: 'true' } : {}),
    },
  }
}

/**
 * Stripe rejected a session that carried a promo code (e.g. the coupon is
 * restricted to products not in this order) → buyer-facing PromoCodeError.
 * Anything else is rethrown unchanged.
 */
export function rethrowPromoSessionError(err, promo) {
  if (promo && err?.type === 'StripeInvalidRequestError') {
    throw new PromoCodeError("that promo code can't be applied to this order")
  }
  throw err
}

/**
 * Record a once-per-customer redemption for a completed Checkout session.
 * No-op unless the session was created with a once-per-customer code. A
 * webhook retry for the same session is ignored; a different session that
 * slipped past the pre-checkout check (two checkouts at once) is logged and
 * audited as coupon.repeat_redemption. Never throws.
 *
 * @param {{ id: string, slug: string }} gym
 * @param {object} session — the Checkout session from the event
 * @param {'join' | 'guest_pass' | 'concessions'} source
 */
export async function recordCouponRedemption(gym, session, source) {
  const meta = session.metadata ?? {}
  if (meta.oncePerCustomer !== 'true' || !meta.promotionCodeId) return

  const promotionCodeId = meta.promotionCodeId
  const email = normalizeEmail(session.customer_email ?? session.customer_details?.email ?? meta.email)
  if (!email) {
    console.warn('[coupon] once-per-customer session without an email gym=%s session=%s', gym.slug, session.id)
    return
  }

  try {
    const buyer = await resolveBuyer(gym.id, email)
    await prisma.couponRedemption.create({
      data: {
        gymId: gym.id, promotionCodeId, code: meta.promotionCode ?? '', email,
        ...buyer, checkoutSessionId: session.id, source,
      },
    })
  } catch (err) {
    if (err.code !== 'P2002') {
      console.error('[coupon] redemption write failed gym=%s session=%s: %s', gym.slug, session.id, err.message)
      return
    }
    const retry = await prisma.couponRedemption.findUnique({ where: { checkoutSessionId: session.id }, select: { id: true } }).catch(() => null)
    if (retry) return
    console.warn('[coupon] once-per-customer code redeemed again gym=%s promo=%s session=%s', gym.slug, promotionCodeId, session.id)
    writeAudit({ gym, user: null }, 'coupon.repeat_redemption', 'CouponRedemption', null, {
      promotionCodeId, code: meta.promotionCode ?? null, checkoutSessionId: session.id, source,
    })
  }
}
