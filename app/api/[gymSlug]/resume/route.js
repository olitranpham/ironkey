import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

export async function POST(request) {
  try {
    const gymId        = request.headers.get('x-gym-id')
    const { memberId } = await request.json()

    if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

    const [existing, gym] = await Promise.all([
      prisma.member.findFirst({ where: { id: memberId, gymId } }),
      prisma.gym.findUnique({
        where:  { id: gymId },
        select: { stripeSecretKey: true, seamApiKey: true, seamDeviceId: true },
      }),
    ])

    if (!existing) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const subId     = existing.stripeSubscriptionId
    const stripeKey = gym?.stripeSecretKey

    console.log('[resume] memberId:', memberId, '| subId:', subId, '| stripeKey set:', Boolean(stripeKey), '| key prefix:', stripeKey?.slice(0, 8) ?? 'n/a')

    // ── Resume Stripe subscription ────────────────────────────────────────
    if (subId && stripeKey) {
      try {
        const stripeClient = new Stripe(stripeKey, { apiVersion: '2024-06-20' })
        const result = await stripeClient.subscriptions.update(subId, {
          pause_collection: '',
          cancel_at:        '',
        })
        console.log('[resume] Stripe result — status:', result.status, '| pause_collection:', JSON.stringify(result.pause_collection), '| cancel_at:', result.cancel_at)
      } catch (stripeErr) {
        console.error('[resume] Stripe error:', stripeErr.message)
      }
    } else {
      console.warn('[resume] Skipping Stripe — subId:', subId, '| stripeKey present:', Boolean(stripeKey))
    }

    // ── Recreate Seam access code ─────────────────────────────────────────
    const seamKey      = gym?.seamApiKey ?? process.env.SEAM_API_KEY
    const seamDeviceId = gym?.seamDeviceId
    const accessCode   = existing.accessCode
    const fullName     = `${existing.firstName} ${existing.lastName}`.trim()

    console.log('[resume] Seam — accessCode:', accessCode, '| deviceId:', seamDeviceId, '| key set:', Boolean(seamKey))

    if (seamKey && seamDeviceId && accessCode) {
      try {
        const seamHeaders = { Authorization: `Bearer ${seamKey}`, 'Content-Type': 'application/json' }
        const createRes = await fetch(`${SEAM_API}/access_codes/create`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify({
            device_id: seamDeviceId,
            name:      fullName,
            code:      accessCode,
          }),
        })
        const createBody = await createRes.json()
        console.log('[resume] Seam create status:', createRes.status, '| access_code_id:', createBody.access_code?.access_code_id ?? 'n/a')
      } catch (seamErr) {
        console.error('[resume] Seam error:', seamErr.message)
      }
    } else {
      console.warn('[resume] Skipping Seam — accessCode:', accessCode, '| deviceId:', seamDeviceId, '| key present:', Boolean(seamKey))
    }

    // ── Update DB ─────────────────────────────────────────────────────────
    const now    = new Date()
    const member = await prisma.member.update({
      where: { id: memberId },
      data: {
        status:     'ACTIVE',
        dateFrozen: null,
        maxFreeze:  null,
        updatedAt:  now,
      },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[resume]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
