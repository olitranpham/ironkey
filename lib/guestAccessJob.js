import prisma from '@/lib/prisma'
import { postWebhook } from '@/lib/guestCodeDelivery'
import { JobStepError } from '@/lib/jobStepError'
import { provisionSeamCode } from '@/lib/seamProvision'
import { withPhone } from '@/lib/zapierPayload'

/**
 * Job handler for kind 'guest_access': the guest's time-bound Seam code, then
 * the guest Zapier email (which carries the code, so it waits for Seam).
 * Payload is written by the platform webhook with the pass.
 */
export async function runGuestAccessJob(job, { save }) {
  const gym = await prisma.gym.findUnique({
    where:  { id: job.gymId },
    select: { id: true, slug: true, seamApiKey: true, seamDeviceId: true, zapierGuestWebhookUrl: true },
  })
  const state   = { seamCodes: {}, ...job.payload }
  const persist = patch => save({ payload: Object.assign(state, patch) })

  if (!job.seamDone) {
    await provisionSeamCode(gym, state, {
      name:      state.seamName,
      startsAt:  state.startsAt,
      endsAt:    state.endsAt,
      persist,
      onNewPin:  pin => state.guestProfileId
        ? prisma.guest.update({ where: { id: state.guestProfileId }, data: { accessCode: pin } })
        : Promise.resolve(),
      logPrefix: `[guest-access] job=${job.id} pass=${job.guestPassId}`,
    })
    await save({ seamDone: true, payload: state })
  }

  if (!job.zapierDone) {
    const url  = gym.zapierGuestWebhookUrl || process.env.ZAPIER_GUEST_WEBHOOK_URL
    const pass = job.guestPassId
      ? await prisma.guestVisit.findUnique({ where: { id: job.guestPassId }, select: { guestProfile: { select: { phone: true } } } })
      : null
    const payload = withPhone(
      { ...state.zapier, accessCode: state.accessCode },
      pass?.guestProfile?.phone || state.stripePhone,
      `pass=${job.guestPassId}`,
    )
    const { ok, status } = await postWebhook(url, gym.slug, payload, 'guest')
    if (!ok) throw new JobStepError('zapier', `guest webhook: ${status}`)
    await save({ zapierDone: true })
  }
}
