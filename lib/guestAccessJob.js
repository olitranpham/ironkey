import prisma from '@/lib/prisma'
import { generateUniquePin } from '@/lib/pins'
import { postWebhook } from '@/lib/guestCodeDelivery'
import { maskPin } from '@/lib/redact'
import { JobStepError } from '@/lib/jobStepError'

const SEAM_API = 'https://connect.getseam.com'
export const SEAM_TIMEOUT_MS = 8000
const MAX_PIN_TRIES = 5

/**
 * Seam POST with a hard timeout. Resolves to the parsed body plus `ok`;
 * a timeout or network error throws JobStepError('seam').
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

/**
 * Program the guest's time-bound code on every Seam device (window: purchase
 * → pass expiry). Done means Seam accepted the create on each device (an
 * access_code_id came back), same as before this moved into a job.
 *
 * Progress is saved per device in payload.seamCodes, so a retry only creates
 * codes on devices that don't have one yet. duplicate_access_code (PIN taken
 * on a lock) removes this guest's new codes and retries with a fresh PIN,
 * which is saved to the profile and used for the Zapier email.
 */
async function provisionSeam(job, gym, state, persist) {
  const apiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
  if (!apiKey) {
    console.log('[guest-access] job=%s pass=%s no Seam key — skipping Seam', job.id, job.guestPassId)
    return
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
    console.warn('[guest-access] job=%s pass=%s no Seam devices — nothing to program', job.id, job.guestPassId)
    return
  }

  const tried = new Set()
  for (let pinTry = 1; pinTry <= MAX_PIN_TRIES; pinTry++) {
    const pending = devices.filter(d => !state.seamCodes[d])
    const results = await Promise.all(pending.map(async device => {
      const r = await seamPost(headers, '/access_codes/create', {
        device_id: device, name: state.seamName, code: state.accessCode, starts_at: state.startsAt, ends_at: state.endsAt,
      }).catch(err => ({ error: err }))
      return { device, ...r }
    }))

    for (const r of results) {
      const codeId = r.json?.access_code?.access_code_id
      if (codeId) {
        state.seamCodes[r.device] = codeId
        console.log('[guest-access] job=%s pass=%s Seam accepted device=%s access_code_id=%s code=%s', job.id, job.guestPassId, r.device, codeId, maskPin(state.accessCode))
      }
    }
    await persist({ seamCodes: state.seamCodes })

    if (results.some(r => r.json?.error?.type === 'duplicate_access_code')) {
      // PIN taken on a lock: drop this guest's new codes, pick a fresh PIN, redo every device
      await Promise.all(Object.values(state.seamCodes).map(id =>
        seamPost(headers, '/access_codes/delete', { access_code_id: id }).catch(() => {})))
      state.seamCodes = {}
      tried.add(state.accessCode)
      if (pinTry === MAX_PIN_TRIES) throw new JobStepError('seam', `duplicate_access_code after ${MAX_PIN_TRIES} PINs`)
      const previous = state.accessCode
      state.accessCode = await generateUniquePin(gym.id, previous.length, { exclude: tried, guestId: state.guestProfileId })
      if (state.guestProfileId) await prisma.guest.update({ where: { id: state.guestProfileId }, data: { accessCode: state.accessCode } })
      await persist({ seamCodes: {}, accessCode: state.accessCode })
      console.warn('[guest-access] job=%s duplicate_access_code for pin=%s — retrying with %s', job.id, maskPin(previous), maskPin(state.accessCode))
      continue
    }

    const failed = results.filter(r => !r.json?.access_code?.access_code_id)
    if (failed.length) {
      const f = failed[0]
      const why = f.error ? f.error.message : `HTTP ${f.status} ${f.json?.error?.type ?? ''}`.trim()
      throw new JobStepError('seam', `create on device ${f.device}: ${why}`)
    }
    return
  }
}

/**
 * Job handler for kind 'guest_access': Seam code, then the guest Zapier
 * email (which carries the code, so it waits for Seam). Payload is written by
 * the platform webhook — see buildGuestAccessPayload there.
 */
export async function runGuestAccessJob(job, { save }) {
  const gym = await prisma.gym.findUnique({
    where:  { id: job.gymId },
    select: { id: true, slug: true, seamApiKey: true, seamDeviceId: true, zapierGuestWebhookUrl: true },
  })
  const state   = { seamCodes: {}, ...job.payload }
  const persist = patch => save({ payload: Object.assign(state, patch) })

  if (!job.seamDone) {
    await provisionSeam(job, gym, state, persist)
    await save({ seamDone: true, payload: state })
  }

  if (!job.zapierDone) {
    const url = gym.zapierGuestWebhookUrl || process.env.ZAPIER_GUEST_WEBHOOK_URL
    const { ok, status } = await postWebhook(url, gym.slug, { ...state.zapier, accessCode: state.accessCode }, 'guest')
    if (!ok) throw new JobStepError('zapier', `guest webhook: ${status}`)
    await save({ zapierDone: true })
  }
}
