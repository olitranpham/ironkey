import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'

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
    const freezeEnd = new Date()
    freezeEnd.setMonth(freezeEnd.getMonth() + 6)

    console.log('[freeze] memberId:', memberId, '| subId:', subId, '| stripeKey set:', Boolean(stripeKey), '| key prefix:', stripeKey?.slice(0, 8) ?? 'n/a')
    console.log('[freeze] freezeEndDate (maxFreeze):', freezeEnd.toISOString())

    // ── Pause + schedule cancel in Stripe ─────────────────────────────────
    if (subId && stripeKey) {
      try {
        const stripeClient     = new Stripe(stripeKey, { apiVersion: '2024-06-20' })
        const sixMonthsFromNow = Math.floor(Date.now() / 1000) + (6 * 30 * 24 * 60 * 60)
        const result = await stripeClient.subscriptions.update(subId, {
          pause_collection: { behavior: 'void' },
          cancel_at:        sixMonthsFromNow,
        })
        console.log('[freeze] Stripe result — status:', result.status, '| pause_collection:', JSON.stringify(result.pause_collection))
      } catch (stripeErr) {
        console.error('[freeze] Stripe error:', stripeErr.message)
      }
    } else {
      console.warn('[freeze] Skipping Stripe — subId:', subId, '| stripeKey present:', Boolean(stripeKey))
    }

    // ── Delete Seam access code ───────────────────────────────────────────
    const seamKey      = gym?.seamApiKey ?? process.env.SEAM_API_KEY
    const seamDeviceId = gym?.seamDeviceId
    const accessCode   = existing.accessCode

    if (seamKey && accessCode) {
      await deleteSeamCodeByPin(seamKey, accessCode, seamDeviceId, '[freeze]')
    } else {
      console.warn('[freeze] Skipping Seam — accessCode:', accessCode, '| key present:', Boolean(seamKey))
    }

    // ── Update DB ─────────────────────────────────────────────────────────
    const now    = new Date()
    const member = await prisma.member.update({
      where: { id: memberId },
      data: {
        status:     'FROZEN',
        dateFrozen: existing.dateFrozen ?? now,
        maxFreeze:  freezeEnd,
        updatedAt:  now,
      },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[freeze]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
