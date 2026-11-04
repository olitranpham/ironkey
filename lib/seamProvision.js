import { generateUniquePin } from '@/lib/pins'
import { maskPin } from '@/lib/redact'
import { JobStepError } from '@/lib/jobStepError'

const SEAM_API = 'https://connect.getseam.com'
export const SEAM_TIMEOUT_MS = 8000
const MAX_PIN_TRIES = 5

/**
 * Seam POST with a hard timeout. Resolves to { ok, status, json }; a timeout
 * or network error throws JobStepError('seam').
 */
async function seamPost(headers, path, body) {
  let res
  try {
    res = await fetch(`${SEAM_API}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(SEAM_TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err.name === 'TimeoutError' || err.name === 'AbortError' ? `timeout after ${SEAM_TIMEOUT_MS}ms` : err.message
    throw new JobStepError('seam', `${path}: ${reason}`)
  }
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

/** Every code on the devices, managed and unmanaged (codes set on the keypad). */
async function lockCodes(headers, devices) {
  const lists = await Promise.all(devices.flatMap(device =>
    ['/access_codes/list', '/access_codes/unmanaged/list'].map(async path => {
      const r = await seamPost(headers, path, { device_id: device })
      if (!r.ok) throw new JobStepError('seam', `${path}: HTTP ${r.status} ${r.json?.error?.type ?? ''}`.trim())
      return (r.json.access_codes ?? []).map(c => String(c.code).trim())
    })))
  return new Set(lists.flat())
}

/**
 * Program `state.accessCode` on every Seam device of the gym. Done means Seam
 * accepted the create on each device (an access_code_id came back).
 *
 * Progress is kept per device in state.seamCodes (saved via persist), so a
 * retry only creates codes on devices that don't have one yet. A PIN taken on
 * a lock (duplicate_access_code, or — with checkLockFirst — already in the
 * lock's code list) gets a fresh PIN; onNewPin saves it wherever it belongs.
 *
 * @param {{ id: string, seamApiKey?: string|null, seamDeviceId?: string|null }} gym
 * @param {object} state      job payload: accessCode, seamCodes, guestProfileId?
 * @param {object} options
 * @param {string} options.name            Seam code label
 * @param {string} [options.startsAt]      time-bound window (guest passes)
 * @param {string} [options.endsAt]
 * @param {boolean} [options.checkLockFirst]  compare against the lock's codes before creating (members)
 * @param {(patch: object) => Promise<void>} options.persist
 * @param {(pin: string) => Promise<void>} options.onNewPin
 * @param {string} options.logPrefix
 * @returns {Promise<'skipped' | 'done'>}
 */
export async function provisionSeamCode(gym, state, { name, startsAt, endsAt, checkLockFirst = false, persist, onNewPin, logPrefix }) {
  const apiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
  if (!apiKey) {
    console.log('%s no Seam key — skipping Seam', logPrefix)
    return 'skipped'
  }
  const headers  = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

  let devices = deviceId ? [deviceId] : []
  if (!deviceId) {
    const list = await seamPost(headers, '/devices/list', {})
    if (!list.ok) throw new JobStepError('seam', `/devices/list: HTTP ${list.status} ${list.json?.error?.type ?? ''}`.trim())
    devices = (list.json.devices ?? []).map(d => d.device_id)
  }
  if (!devices.length) {
    console.warn('%s no Seam devices — nothing to program', logPrefix)
    return 'skipped'
  }

  state.seamCodes ??= {}
  const tried = new Set()
  const newPin = async (taken = []) => {
    tried.add(state.accessCode)
    const previous = state.accessCode
    state.accessCode = await generateUniquePin(gym.id, previous.length, { seamCodes: taken, exclude: tried, guestId: state.guestProfileId ?? null })
    await onNewPin(state.accessCode)
    await persist({ seamCodes: {}, accessCode: state.accessCode })
    console.warn('%s pin=%s taken on the lock — using %s', logPrefix, maskPin(previous), maskPin(state.accessCode))
  }

  if (checkLockFirst && !Object.keys(state.seamCodes).length) {
    const taken = await lockCodes(headers, devices)
    if (taken.has(state.accessCode)) await newPin([...taken])
  }

  for (let pinTry = 1; pinTry <= MAX_PIN_TRIES; pinTry++) {
    const pending = devices.filter(d => !state.seamCodes[d])
    const results = await Promise.all(pending.map(async device => {
      const r = await seamPost(headers, '/access_codes/create', {
        device_id: device, name, code: state.accessCode,
        ...(startsAt ? { starts_at: startsAt } : {}),
        ...(endsAt   ? { ends_at:   endsAt }   : {}),
      }).catch(err => ({ error: err }))
      return { device, ...r }
    }))

    for (const r of results) {
      const codeId = r.json?.access_code?.access_code_id
      if (codeId) {
        state.seamCodes[r.device] = codeId
        console.log('%s Seam accepted device=%s access_code_id=%s code=%s', logPrefix, r.device, codeId, maskPin(state.accessCode))
      }
    }
    await persist({ seamCodes: state.seamCodes })

    if (results.some(r => r.json?.error?.type === 'duplicate_access_code')) {
      // Drop this attempt's codes, then redo every device with a fresh PIN
      await Promise.all(Object.values(state.seamCodes).map(id =>
        seamPost(headers, '/access_codes/delete', { access_code_id: id }).catch(() => {})))
      state.seamCodes = {}
      if (pinTry === MAX_PIN_TRIES) throw new JobStepError('seam', `duplicate_access_code after ${MAX_PIN_TRIES} PINs`)
      await newPin()
      continue
    }

    const failed = results.filter(r => !r.json?.access_code?.access_code_id)
    if (failed.length) {
      const f = failed[0]
      const why = f.error ? f.error.message : `HTTP ${f.status} ${f.json?.error?.type ?? ''}`.trim()
      throw new JobStepError('seam', `create on device ${f.device}: ${why}`)
    }
    return 'done'
  }
}
