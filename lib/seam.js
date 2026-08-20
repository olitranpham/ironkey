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
 * Generates a random 4-digit access code that doesn't collide with any other
 * Member row in the same gym or any code currently active on the gym's Seam
 * device(s) right now — checking both Seam's managed and unmanaged code
 * lists, since a code can live in either. Without this check, two members
 * can independently land on the same random code (birthday-paradox territory once a gym has a
 * couple hundred members) — Seam then silently reassigns the physical code's
 * name to whichever member most recently had it pushed, leaving the earlier
 * member's DB record pointing at a code that's no longer actually theirs.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.gymId
 * @param {string|null} params.apiKey    Seam API key (gym's own, or platform fallback) — pass null/undefined to skip the Seam-side check entirely
 * @param {string|null} params.deviceId  Seam device ID to scope the check to; null checks every device on the account
 * @param {string} [params.logPrefix]
 * @returns {Promise<string>} a 4-digit numeric code string, unique as of this check
 */
export async function generateUniqueAccessCode({ prisma, gymId, apiKey, deviceId = null, logPrefix = '[seam]' }) {
  const maxAttempts = 20

  // Snapshot every code currently active on the relevant device(s) once,
  // up front — cheaper than re-querying Seam on every retry, and the
  // snapshot only needs to be "fresh enough", not perfectly real-time.
  let seamCodes = new Set()
  if (apiKey) {
    try {
      const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      let devices = deviceId ? [{ device_id: deviceId }] : []
      if (!deviceId) {
        const devRes = await fetch(`${SEAM_API}/devices/list`, {
          method: 'POST', headers, body: JSON.stringify({}),
        })
        if (devRes.ok) {
          const { devices: devList = [] } = await devRes.json()
          devices = devList
        }
      }
      // Codes can live in either Seam's managed list or its separate
      // "unmanaged" list (e.g. set directly on the keypad, or migrated from
      // before Seam tracked them) — a code only in the unmanaged list is
      // just as real and just as capable of colliding, so both must be
      // checked. Same dual-list pattern as deleteSeamCodeByPin below.
      const perDeviceCodes = await Promise.all(devices.flatMap(dev =>
        ['access_codes/list', 'access_codes/unmanaged/list'].map(async endpoint => {
          const res = await fetch(`${SEAM_API}/${endpoint}`, {
            method: 'POST', headers, body: JSON.stringify({ device_id: dev.device_id }),
          })
          if (!res.ok) return []
          const { access_codes = [] } = await res.json()
          return access_codes.map(c => String(c.code).trim())
        })
      ))
      seamCodes = new Set(perDeviceCodes.flat())
    } catch (err) {
      console.warn('%s generateUniqueAccessCode: Seam lookup failed (%s) — falling back to DB-only uniqueness check', logPrefix, err.message)
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000))

    if (seamCodes.has(candidate)) {
      console.warn('%s generateUniqueAccessCode: candidate %s collides with an active Seam code — regenerating (attempt %d/%d)', logPrefix, candidate, attempt, maxAttempts)
      continue
    }

    const dbCollision = await prisma.member.findFirst({
      where:  { gymId, accessCode: candidate },
      select: { id: true },
    })
    if (dbCollision) {
      console.warn('%s generateUniqueAccessCode: candidate %s collides with an existing Member row — regenerating (attempt %d/%d)', logPrefix, candidate, attempt, maxAttempts)
      continue
    }

    return candidate
  }

  throw new Error(`generateUniqueAccessCode: exhausted ${maxAttempts} attempts without finding a unique code for gym ${gymId} — device may be near 4-digit code-space saturation`)
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
      console.warn('%s deleteSeamCodeByPin: PIN %s not found on any device — skipping delete', logPrefix, pin)
      return { ok: false, codeId: null }
    }

    // ── Delete (managed, with unmanaged fallback) ───────────────────────────
    const { ok } = await deleteSeamCodeById(apiKey, targetCodeId, logPrefix)
    if (!ok) return { ok: false, codeId: targetCodeId }

    console.log('%s deleteSeamCodeByPin: deleted access_code_id=%s PIN=%s', logPrefix, targetCodeId, pin)
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
        console.error('%s deleteSeamCodeById: unmanaged/delete force failed status=%s body=%s', logPrefix, forceRes.status, forceText)
        return { ok: false }
      }

      console.warn('%s deleteSeamCodeById: %s failed status=%s body=%s — %s', logPrefix, endpoint, res.status, text,
        endpoint === 'access_codes/delete' ? 'retrying with unmanaged endpoint' : 'giving up')
    }
    return { ok: false }
  } catch (err) {
    console.error('%s deleteSeamCodeById: unexpected error: %s', logPrefix, err.message)
    return { ok: false }
  }
}
