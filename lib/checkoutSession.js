import Stripe from 'stripe'

/**
 * Verify a Stripe Checkout session for a gym's success page.
 *
 * Valid only if:
 *  - it can be retrieved with THIS gym's Stripe key (sessions are created on
 *    the gym's own connected account, so another account's session 404s), and
 *    its metadata.gymId is this gym;
 *  - it is paid: guest → payment_status 'paid'; join → payment_status 'paid',
 *    or status 'complete' with a subscription (e.g. a free trial).
 *
 * @param {{ id: string, stripeSecretKey: string | null }} gym
 * @param {string | null} sessionId
 * @param {'guest' | 'join'} kind
 * @returns {Promise<{ ok: true, email: string, session: object } | { ok: false }>}
 */
export async function verifyPaidCheckoutSession(gym, sessionId, kind) {
  if (!gym?.stripeSecretKey || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) return { ok: false }

  let session
  try {
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch {
    return { ok: false }
  }

  if (session.metadata?.gymId !== gym.id) return { ok: false }

  const paid = session.payment_status === 'paid'
    || (kind === 'join' && session.status === 'complete' && Boolean(session.subscription))
  if (!paid) return { ok: false }

  const email = (session.customer_email ?? session.customer_details?.email ?? '').trim().toLowerCase()
  if (!email) return { ok: false }

  return { ok: true, email, session }
}
