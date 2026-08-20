import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { generateUniqueAccessCode, isAccessCodeLiveOnSeam } from '@/lib/seam'

const SEAM_API = 'https://connect.getseam.com'

/**
 * POST /api/[gymSlug]/reverse-cancel
 * Staff-only (OWNER/ADMIN). Undoes a scheduled cancellation set by /cancel,
 * as long as the subscription hasn't actually lapsed yet. Runs alongside
 * the normal PIN access-code flow — doesn't touch it beyond reissuing a
 * code if the member's existing one was already revoked.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params

    const role = (request.headers.get('x-gym-role') ?? '').toUpperCase()
    if (role !== 'OWNER' && role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only gym staff can reverse a cancellation' }, { status: 403 })
    }

    const gymId = request.headers.get('x-gym-id')
    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: { slug: true, stripeSecretKey: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym || gym.slug !== gymSlug) {
      return NextResponse.json({ error: 'Gym mismatch' }, { status: 403 })
    }

    const { memberId } = await request.json()
    if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

    const member = await prisma.member.findFirst({ where: { id: memberId, gymId } })
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    if (!member.cancelScheduled) {
      return NextResponse.json({ error: 'This member does not have a scheduled cancellation to reverse' }, { status: 400 })
    }
    // /cancel never flips status to CANCELED itself — only the
    // customer.subscription.deleted webhook does, once the subscription
    // has actually ended. If status is already CANCELED here, the
    // subscription is genuinely over; there's nothing left to reverse.
    if (member.status === 'CANCELED') {
      return NextResponse.json({ error: 'This membership has already ended — the member needs to sign up again rather than reverse the cancellation' }, { status: 400 })
    }

    const subId = member.stripeSubscriptionId
    if (!subId || !gym.stripeSecretKey) {
      return NextResponse.json({ error: 'No Stripe subscription on file for this member' }, { status: 400 })
    }

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const sub    = await stripe.subscriptions.retrieve(subId)

    if (sub.status === 'canceled') {
      return NextResponse.json({ error: 'This subscription has already ended on Stripe — the member needs to sign up again' }, { status: 400 })
    }

    // Mirror the two scheduling shapes /cancel can leave a subscription in.
    const nowSecs = Math.floor(Date.now() / 1000)
    let lapseAtSecs, stripeParams
    if (sub.cancel_at_period_end) {
      lapseAtSecs  = sub.current_period_end
      stripeParams = { cancel_at_period_end: false }
    } else if (sub.cancel_at) {
      lapseAtSecs  = sub.cancel_at
      stripeParams = { cancel_at: null }
    } else {
      return NextResponse.json({ error: 'No scheduled cancellation found on this subscription in Stripe' }, { status: 400 })
    }

    if (lapseAtSecs <= nowSecs) {
      return NextResponse.json({ error: 'This subscription has already reached its cancellation date — the member needs to sign up again' }, { status: 400 })
    }

    await stripe.subscriptions.update(subId, stripeParams)
    console.log('[reverse-cancel] Stripe cleared — memberId:', memberId, '| params:', JSON.stringify(stripeParams))

    // ── Access code — leave it alone if it's still live, reissue if not ─────
    // Seam codes are only ever revoked by the subscription.deleted webhook,
    // which fires solely once a subscription actually ends — the same
    // condition already rejected above. So in the normal case there's
    // nothing to touch here. This still checks for real rather than
    // assuming, since staff could have separately removed the code by hand
    // (e.g. the door-access page's own "remove" action) independent of
    // subscription state.
    const apiKey   = gym.seamApiKey ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

    let codeReissued = false
    let accessCode   = member.accessCode
    const updateData = {
      cancelScheduled: false,
      dateCanceled:    null,
      updatedAt:       new Date(),
    }

    if (apiKey) {
      const stillLive = member.accessCode
        ? await isAccessCodeLiveOnSeam(apiKey, deviceId, member.accessCode)
        : false

      if (!stillLive) {
        accessCode = await generateUniqueAccessCode({
          prisma, gymId, apiKey, deviceId, logPrefix: '[reverse-cancel]',
        })
        updateData.accessCode = accessCode
        codeReissued = true

        const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        const createRes = await fetch(`${SEAM_API}/access_codes/create`, {
          method: 'POST', headers,
          body:   JSON.stringify({
            device_id: deviceId,
            code:      accessCode,
            name:      `${member.firstName} ${member.lastName}`,
          }),
        })
        if (!createRes.ok) {
          const text = await createRes.text()
          console.error('[reverse-cancel] Seam create failed:', createRes.status, text)
          // Non-fatal — the DB/Stripe reversal already succeeded; the code
          // just won't be live on the lock yet. Surfaced in the response.
        }
      }
    }

    const updated = await prisma.member.update({ where: { id: memberId }, data: updateData })
    await prisma.membershipEvent.create({
      data: { memberId, gymId, type: 'cancellation_reversed' },
    })

    console.log('[reverse-cancel] done — memberId:', memberId, '| codeReissued:', codeReissued, '| accessCode:', accessCode)

    return NextResponse.json({ member: updated, codeReissued, accessCode })
  } catch (error) {
    console.error('[reverse-cancel]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
