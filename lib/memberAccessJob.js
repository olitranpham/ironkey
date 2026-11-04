import prisma from '@/lib/prisma'
import { ensureKisiMembership } from '@/lib/kisi'
import { postWebhook } from '@/lib/guestCodeDelivery'
import { JobStepError } from '@/lib/jobStepError'
import { provisionSeamCode } from '@/lib/seamProvision'

const KISI_TIMEOUT_MS = 15000

function withTimeout(promise, ms, step, what) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new JobStepError(step, `${what}: timeout after ${ms}ms`)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Job handler for kind 'member_access' (join checkout): Kisi access (Kisi
 * gyms) or the member's Seam code, then the member Zapier email (which
 * carries the code, so it waits for Seam). Payload is written by the
 * platform webhook with the member.
 */
export async function runMemberAccessJob(job, { save }) {
  const gym = await prisma.gym.findUnique({
    where:  { id: job.gymId },
    select: {
      id: true, slug: true, seamApiKey: true, seamDeviceId: true, zapierMemberWebhookUrl: true,
      kisiApiKey: true, kisiPlaceId: true, kisiMemberGroupId: true, kisiWeekendGroupId: true,
    },
  })
  const state   = { seamCodes: {}, ...job.payload }
  const persist = patch => save({ payload: Object.assign(state, patch) })
  const logPrefix = `[member-access] job=${job.id} member=${job.memberId}`

  if (!job.kisiDone) {
    // existingMember is the member as it was before this checkout (tier-change check)
    let result
    try {
      result = await withTimeout(ensureKisiMembership(gym, state.kisi), KISI_TIMEOUT_MS, 'kisi', 'ensureKisiMembership')
    } catch (err) {
      throw err instanceof JobStepError ? err : new JobStepError('kisi', err.message)
    }
    if (result) {
      await prisma.member.update({
        where: { id: job.memberId },
        data:  { kisiUserId: result.kisiUserId, kisiRoleAssignmentId: result.kisiRoleAssignmentId },
      })
      console.log('%s Kisi access granted kisiUserId=%s roleAssignment=%s', logPrefix, result.kisiUserId, result.kisiRoleAssignmentId)
    }
    await save({ kisiDone: true })
  }

  if (!job.seamDone) {
    await provisionSeamCode(gym, state, {
      name:           state.seamName,
      checkLockFirst: true,
      persist,
      onNewPin:       pin => prisma.member.update({ where: { id: job.memberId }, data: { accessCode: pin } }),
      logPrefix,
    })
    await save({ seamDone: true, payload: state })
  }

  if (!job.zapierDone) {
    const url = gym.zapierMemberWebhookUrl || process.env.ZAPIER_MEMBER_WEBHOOK_URL
    const { ok, status } = await postWebhook(url, gym.slug, { ...state.zapier, accessCode: state.accessCode ?? null }, 'member')
    if (!ok) throw new JobStepError('zapier', `member webhook: ${status}`)
    await save({ zapierDone: true })
  }
}
