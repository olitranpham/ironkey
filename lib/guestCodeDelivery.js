// Guest door-code delivery. Codes are never returned to the kiosk — they are
// sent only through the gym's guest Zapier webhook, which emails them to the
// address ON THE GUEST PROFILE.

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
 * POST the guest's code to the gym's guest Zapier webhook and wait for it.
 * Success = a 2xx within 5 s. Logs gym slug + webhook status only.
 *
 * @param {{ zapierGuestWebhookUrl?: string | null }} gym
 * @param {string} gymSlug
 * @param {object} payload — must carry the profile's email, never a request-supplied one
 * @returns {Promise<boolean>} true if the webhook accepted it
 */
export async function deliverGuestCode(gym, gymSlug, payload) {
  if (!gym.zapierGuestWebhookUrl) {
    console.error('[guest-code-delivery] gym=%s status=no_webhook_configured', gymSlug)
    return false
  }
  try {
    const res = await fetch(gym.zapierGuestWebhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    console.log('[guest-code-delivery] gym=%s status=%d', gymSlug, res.status)
    return res.ok
  } catch (err) {
    const status = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'network_error'
    console.error('[guest-code-delivery] gym=%s status=%s', gymSlug, status)
    return false
  }
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
