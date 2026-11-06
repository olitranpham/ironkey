import { toE164 } from '@/lib/phone'

/**
 * Adds `phone` (strict E.164, or '' when missing / not a usable US number) to
 * an outgoing Zapier payload. Logs the record id when a stored number can't
 * be normalized — never the number itself.
 *
 * @param {object} payload
 * @param {string | null | undefined} rawPhone
 * @param {string | null | undefined} id — record id for the log line
 * @returns {object}
 */
export function withPhone(payload, rawPhone, id) {
  const phone = toE164(rawPhone) ?? ''
  if (rawPhone && !phone) {
    console.log('[zapier-payload] phone could not be normalized to E.164 for %s', id ?? 'unknown')
  }
  return { ...payload, phone }
}

/**
 * Phone from a Stripe Checkout session when there's no stored one: the
 * session's customer_details, then the Customer object. Errors → null.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {object} session — checkout.session.completed object
 * @param {object} [requestOptions] — e.g. { stripeAccount } for Connect
 * @returns {Promise<string | null>}
 */
export async function stripeSessionPhone(stripe, session, requestOptions = {}) {
  if (session.customer_details?.phone) return session.customer_details.phone
  if (session.customer && typeof session.customer === 'object') return session.customer.phone || null
  if (!session.customer) return null
  try {
    const customer = await stripe.customers.retrieve(session.customer, { timeout: 3000, ...requestOptions })
    return customer?.phone || null
  } catch (err) {
    console.error('[zapier-payload] customer retrieve failed for session=%s: %s', session.id, err.message)
    return null
  }
}
