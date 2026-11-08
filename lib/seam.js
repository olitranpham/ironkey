import { maskPin, redactJsonText } from './redact'
import { generateUniquePin, DEFAULT_PIN_LENGTH } from './pins'

const SEAM_API = 'https://connect.getseam.com'

/**
 * Checks whether a given PIN currently exists as a live code — managed or
 * unmanaged — on the gym's Seam device(s) right now. Read-only; doesn't
 * modify anything. Used to tell whether a member's stored `accessCode` is
 * still actually on the lock or was already revoked out from under them
 * (e.g. by a subscription-ended webhook) before deciding whether to reissue.
 *
 * @param {string}      apiKey    Seam API key
 * @param {string|null} deviceId  Scope to this device; null checks every device on the account
 * @param {string}      pin       Numeric PIN to look for
 * @returns {Promise<boolean>}
 */
export async function isAccessCodeLiveOnSeam(apiKey, deviceId, pin) {
  if (!apiKey || !pin) return false
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  let devices = deviceId ? [{ device_id: deviceId }] : []
  if (!deviceId) {
    const devRes = await fetch(`${SEAM_API}/devices/list`, { method: 'POST', headers, body: JSON.stringify({}) })
    if (devRes.ok) {
      const { devices: devList = [] } = await devRes.json()
      devices = devList
    }
  }

  for (const dev of devices) {
    for (const endpoint of ['access_codes/list', 'access_codes/unmanaged/list']) {
      const res = await fetch(`${SEAM_API}/${endpoint}`, {
        method: 'POST', headers, body: JSON.stringify({ device_id: dev.device_id }),
      })
      if (!res.ok) continue
      const { access_codes = [] } = await res.json()
      if (access_codes.some(c => String(c.code).trim() === String(pin).trim())) return true
    }
  }
  return false
}

/**
 * Polls until a given PIN is confirmed gone from the gym's Seam device(s).
 * Seam's delete endpoints report success as soon as the request is
 * accepted, not once the deletion has actually propagated — recreating the
 * same PIN immediately after a delete can lose that race and get rejected
 * as duplicate_access_code, even though the delete "succeeded". Call this
 * after deleteSeamCodeByPin/deleteSeamCodeById and before recreating the
 * same PIN.
 *
 * @param {string}      apiKey     Seam API key
 * @param {string|null} deviceId   Scope to this device; null checks every device on the account
 * @param {string}      pin        Numeric PIN to wait on
 * @param {object}      [options]
 * @param {number}      [options.maxAttempts=8]
 * @param {number}      [options.intervalMs=1000]
 * @returns {Promise<boolean>} true once confirmed gone, false if it timed out still present
 */
export async function waitForAccessCodeGone(apiKey, deviceId, pin, { maxAttempts = 8, intervalMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const stillLive = await isAccessCodeLiveOnSeam(apiKey, deviceId, pin)
    if (!stillLive) return true
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

/**
 * Generates a random 4-digit access code that doesn't collide with any
 * member, guest or partner check-in code at the gym (see lib/pins.js) or any
 * code currently active on the gym's Seam device(s) right now — checking both
 * Seam's managed and unmanaged code lists, since a code can live in either. Without this check, two members
 * can independently land on the same random code (birthday-paradox territory once a gym has a
 * couple hundred members) — Seam then silently reassigns the physical code's
 * name to whichever member most recently had it pushed, leaving the earlier
 * member's DB record pointing at a code that's no longer actually theirs.
 *
 * Callers still pass prisma/apiKey/deviceId/logPrefix; they're ignored — the
 * gym's own Seam config is read by lockPins.
 *
 * @param {object} params
 * @param {string} params.gymId
 * @param {string|null} [params.guestId]  for a guest's (global) code: also check every gym the guest has passes at
 * @returns {Promise<string>} a 4-digit numeric code string, unique as of this check
 */
export async function generateUniqueAccessCode({ gymId, guestId = null }) {
  // generateUniquePin checks the DB and every code on the gym's lock
  // (managed + unmanaged) itself — see lockPins in lib/pins.js
  return generateUniquePin(gymId, DEFAULT_PIN_LENGTH, { guestId })
}

const normalizeCodeName = s => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Creates `pin` as an access code on each device. Seam's duplicate_access_code
 * means the PIN is already on that lock (managed or unmanaged):
 *  - the code holding it is named `name` → it's this person's own code; success
 *  - otherwise, with allowNewPin → undo this attempt's codes and retry with a
 *    fresh collision-checked PIN (a lock-only collision the DB couldn't see)
 *  - otherwise → fail with duplicate: true (caller keeps/rejects the PIN)
 * The caller must persist and deliver the returned `pin` — it may differ.
 *
 * @param {object} params
 * @param {string}   params.apiKey
 * @param {string[]} params.deviceIds
 * @param {string}   params.gymId
 * @param {string}   params.pin
 * @param {string}   params.name
 * @param {string|null} [params.guestId]   widen new-PIN uniqueness to the guest's gyms
 * @param {string|null} [params.startsAt]  ISO — time-bound codes only
 * @param {string|null} [params.endsAt]
 * @param {boolean}  [params.allowNewPin=true]
 * @param {number}   [params.maxAttempts=5]
 * @param {string}   [params.logPrefix]
 * @returns {Promise<{ ok: boolean, pin: string, codeIds: string[], duplicate: boolean }>}
 */
export async function createLockCode({ apiKey, deviceIds, gymId, pin, name, guestId = null, startsAt = null, endsAt = null, allowNewPin = true, maxAttempts = 5, logPrefix = '[seam]' }) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const post    = (endpoint, body) => fetch(`${SEAM_API}/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }))
  const isOwnCode = async (deviceId, candidate) => {
    for (const endpoint of ['access_codes/list', 'access_codes/unmanaged/list']) {
      const { ok, json } = await post(endpoint, { device_id: deviceId })
      const holder = ok ? json.access_codes?.find(c => String(c.code).trim() === candidate) : null
      if (holder) return { own: normalizeCodeName(holder.name) === normalizeCodeName(name), codeId: holder.access_code_id }
    }
    return { own: false, codeId: null }
  }

  const tried   = new Set()
  let candidate = String(pin).trim()
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const results = await Promise.all(deviceIds.map(async deviceId => {
      const res = await post('access_codes/create', {
        device_id: deviceId, name, code: candidate,
        ...(startsAt ? { starts_at: startsAt } : {}),
        ...(endsAt   ? { ends_at:   endsAt }   : {}),
      }).catch(err => ({ ok: false, status: 0, json: { error: { type: 'network_error', message: err.message } } }))
      if (res.ok) return { ok: true, codeId: res.json.access_code?.access_code_id ?? null }
      if (res.json.error?.type !== 'duplicate_access_code') {
        console.error('%s createLockCode: device=%s code=%s failed — %d %s', logPrefix, deviceId, maskPin(candidate), res.status, res.json.error?.type)
        return { ok: false }
      }
      const { own, codeId } = await isOwnCode(deviceId, candidate)
      if (own) console.log('%s createLockCode: code=%s already on device=%s as this person\'s own code', logPrefix, maskPin(candidate), deviceId)
      return own ? { ok: true, codeId } : { ok: false, duplicate: true }
    }))

    const codeIds = results.map(r => r.codeId).filter(Boolean)
    if (!results.some(r => r.duplicate)) {
      return { ok: results.every(r => r.ok), pin: candidate, codeIds, duplicate: false }
    }
    if (!allowNewPin) {
      console.warn('%s createLockCode: code=%s is already on the lock for someone else', logPrefix, maskPin(candidate))
      return { ok: false, pin: candidate, codeIds, duplicate: true }
    }

    // Undo this attempt's new codes on the other devices, then try a fresh PIN
    await Promise.all(results.filter(r => r.ok && r.codeId).map(r => post('access_codes/delete', { access_code_id: r.codeId }).catch(() => null)))
    tried.add(candidate)
    if (attempt === maxAttempts) break
    const previous = candidate
    candidate = await generateUniquePin(gymId, previous.length, { guestId, exclude: tried })
    console.warn('%s createLockCode: duplicate_access_code for code=%s — retrying with code=%s (attempt %d/%d)', logPrefix, maskPin(previous), maskPin(candidate), attempt + 1, maxAttempts)
  }
  console.error('%s createLockCode: still duplicate after %d PINs', logPrefix, maxAttempts)
  return { ok: false, pin: candidate, codeIds: [], duplicate: true }
}

/**
 * Deletes a Seam access code identified by its PIN value.
 *
 * Searches one device (if deviceId provided) or all devices on the account,
 * finds the code whose `code` field matches `pin`, then deletes it by
 * `access_code_id`.
 *
 * @param {string}      apiKey     Seam API key
 * @param {string}      pin        Numeric PIN to find and delete
 * @param {string|null} deviceId   Scope search to this device; null = all devices
 * @param {string}      logPrefix  Prefix for console log/error lines
 * @returns {Promise<{ ok: boolean, codeId: string|null }>}
 */
export async function deleteSeamCodeByPin(apiKey, pin, deviceId = null, logPrefix = '[seam]') {
  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    // ── Resolve device list ─────────────────────────────────────────────────
    let devices = []
    if (deviceId) {
      devices = [{ device_id: deviceId }]
    } else {
      const res = await fetch(`${SEAM_API}/devices/list`, {
        method: 'POST', headers, body: JSON.stringify({}),
      })
      if (res.ok) {
        const text = await res.text()
        const body = text ? JSON.parse(text) : {}
        devices = body.devices ?? []
      }
    }

    // ── Find code by PIN (managed list, then unmanaged fallback) ───────────
    let targetCodeId = null
    for (const device of devices) {
      for (const endpoint of ['access_codes/list', 'access_codes/unmanaged/list']) {
        const res = await fetch(`${SEAM_API}/${endpoint}`, {
          method: 'POST', headers,
          body:   JSON.stringify({ device_id: device.device_id }),
        })
        if (!res.ok) continue
        const text  = await res.text()
        const body  = text ? JSON.parse(text) : {}
        const match = (body.access_codes ?? []).find(
          c => String(c.code).trim() === String(pin).trim()
        )
        if (match) { targetCodeId = match.access_code_id; break }
      }
      if (targetCodeId) break
    }

    if (!targetCodeId) {
      console.warn('%s deleteSeamCodeByPin: PIN %s not found on any device — skipping delete', logPrefix, maskPin(pin))
      return { ok: false, codeId: null }
    }

    // ── Delete (managed, with unmanaged fallback) ───────────────────────────
    const { ok } = await deleteSeamCodeById(apiKey, targetCodeId, logPrefix)
    if (!ok) return { ok: false, codeId: targetCodeId }

    console.log('%s deleteSeamCodeByPin: deleted access_code_id=%s PIN=%s', logPrefix, targetCodeId, maskPin(pin))
    return { ok: true, codeId: targetCodeId }
  } catch (err) {
    console.error('%s deleteSeamCodeByPin: unexpected error: %s', logPrefix, err.message)
    return { ok: false, codeId: null }
  }
}

/**
 * Deletes a Seam access code by its access_code_id directly (no PIN lookup needed).
 *
 * @param {string} apiKey  Seam API key
 * @param {string} codeId  Seam access_code_id
 * @param {string} logPrefix
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deleteSeamCodeById(apiKey, codeId, logPrefix = '[seam]') {
  const headers = {
    Authorization:  `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  const NOT_FOUND_TYPES = new Set(['access_code_not_found', 'resource_not_found', 'not_found'])

  try {
    // Try managed endpoint first; fall back to unmanaged for migrated codes
    for (const endpoint of ['access_codes/delete', 'access_codes/unmanaged/delete']) {
      const res  = await fetch(`${SEAM_API}/${endpoint}`, {
        method: 'POST', headers,
        body:   JSON.stringify({ access_code_id: codeId }),
      })
      if (res.ok) {
        console.log('%s deleteSeamCodeById: deleted access_code_id=%s via %s', logPrefix, codeId, endpoint)
        return { ok: true }
      }
      const text     = await res.text()
      const errType  = (() => { try { return JSON.parse(text)?.error?.type } catch { return null } })()

      // Code doesn't exist on Seam — already deleted or never existed; treat as success
      if (res.status === 404 || NOT_FOUND_TYPES.has(errType)) {
        console.log('%s deleteSeamCodeById: access_code_id=%s not found (errType=%s) — treating as success', logPrefix, codeId, errType)
        return { ok: true }
      }

      // Unmanaged codes owned by another workspace require force: true
      if (endpoint === 'access_codes/unmanaged/delete' && errType === 'managed_by_other_workspace') {
        console.warn('%s deleteSeamCodeById: managed_by_other_workspace — retrying with force=true', logPrefix)
        const forceRes = await fetch(`${SEAM_API}/access_codes/unmanaged/delete`, {
          method: 'POST', headers,
          body:   JSON.stringify({ access_code_id: codeId, force: true }),
        })
        if (forceRes.ok) {
          console.log('%s deleteSeamCodeById: deleted access_code_id=%s via unmanaged/delete (force)', logPrefix, codeId)
          return { ok: true }
        }
        const forceText = await forceRes.text()
        console.error('%s deleteSeamCodeById: unmanaged/delete force failed status=%s body=%j', logPrefix, forceRes.status, redactJsonText(forceText))
        return { ok: false }
      }

      console.warn('%s deleteSeamCodeById: %s failed status=%s body=%j — %s', logPrefix, endpoint, res.status, redactJsonText(text),
        endpoint === 'access_codes/delete' ? 'retrying with unmanaged endpoint' : 'giving up')
    }
    return { ok: false }
  } catch (err) {
    console.error('%s deleteSeamCodeById: unexpected error: %s', logPrefix, err.message)
    return { ok: false }
  }
}
