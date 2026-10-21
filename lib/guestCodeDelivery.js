// Door-code delivery. Codes are never returned to the browser — they are sent
// only through the gym's Zapier webhooks, which email them to the address on
// the guest profile / member record.

const SEAM_API            = 'https://connect.getseam.com'
const DELIVERY_TIMEOUT_MS = 5000

/**
 * "jane@gmail.com" → "j•••@gmail.com". Empty/invalid → "your email".
 * @param {string | null | undefined} email
 * @returns {string}
 */
export function maskEmail(email) {
  const [local, domain] = String(email ?? '').split('@')
  if (!local || !domain) return 'your email'
  return `${local[0]}•••@${domain}`
}

/**
 * POST a payload to a Zapier webhook and wait for it. Success = a 2xx within
 * 5 s. Logs kind + gym slug + delivery status only (never the payload).
 *
 * @param {string | null | undefined} url
 * @param {string} gymSlug
 * @param {object} payload
 * @param {'guest' | 'member'} [kind]
 * @returns {Promise<{ ok: boolean, status: number | 'timeout' | 'network_error' | 'no_webhook_configured' }>}
 */
export async function postWebhook(url, gymSlug, payload, kind = 'guest') {
  if (!url) {
    console.error('[code-delivery] kind=%s gym=%s status=no_webhook_configured', kind, gymSlug)
    return { ok: false, status: 'no_webhook_configured' }
  }
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    const log = res.ok ? console.log : console.error
    log('[code-delivery] kind=%s gym=%s status=%d', kind, gymSlug, res.status)
    return { ok: res.ok, status: res.status }
  } catch (err) {
    const status = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'network_error'
    console.error('[code-delivery] kind=%s gym=%s status=%s', kind, gymSlug, status)
    return { ok: false, status }
  }
}

/**
 * POST the guest's code to the gym's guest Zapier webhook and wait for it.
 *
 * @param {{ zapierGuestWebhookUrl?: string | null }} gym
 * @param {string} gymSlug
 * @param {object} payload — must carry the profile's email, never a request-supplied one
 * @returns {Promise<boolean>} true if the webhook accepted it
 */
export async function deliverGuestCode(gym, gymSlug, payload) {
  return (await postWebhook(gym.zapierGuestWebhookUrl, gymSlug, payload, 'guest')).ok
}

/**
 * Looks up an existing Seam access code for the given PIN on a device and
 * returns it if it's still within its active window (no ends_at, or ends_at
 * in the future); otherwise null. Errors → null.
 */
export async function findValidSeamCode(seamHeaders, deviceId, pin) {
  try {
    const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
      method: 'POST', headers: seamHeaders,
      body:   JSON.stringify({ device_id: deviceId }),
    })
    if (!listRes.ok) return null
    const listJson = await listRes.json()
    const code = listJson.access_codes?.find(c => String(c.code).trim() === String(pin).trim())
    if (!code) return null
    const stillValid = !code.ends_at || new Date(code.ends_at) > new Date()
    return stillValid ? code : null
  } catch (err) {
    console.error('[guest-code-delivery] findValidSeamCode error:', err.message)
    return null
  }
}
