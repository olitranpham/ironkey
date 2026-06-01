const SEAM_API = 'https://connect.getseam.com'

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
        const body = await res.json()
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
        const body  = await res.json()
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
