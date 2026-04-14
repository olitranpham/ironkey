import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

export async function POST(request) {
  try {
    const gymId        = request.headers.get('x-gym-id')
    const { memberId } = await request.json()

    if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

    const [existing, gym] = await Promise.all([
      prisma.member.findFirst({ where: { id: memberId, gymId } }),
      prisma.gym.findUnique({ where: { id: gymId }, select: { stripeSecretKey: true } }),
    ])

    if (!existing) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const subId     = existing.stripeSubscriptionId
    const stripeKey = gym?.stripeSecretKey

    console.log('[resume] memberId:', memberId, '| subId:', subId, '| stripeKey set:', Boolean(stripeKey), '| key prefix:', stripeKey?.slice(0, 8) ?? 'n/a')

    if (subId && stripeKey) {
      try {
        const stripeClient = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

        // Clear pause_collection and any scheduled cancellation
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

    const now    = new Date()
    const member = await prisma.member.update({
      where: { id: memberId },
      data: {
        status:    'ACTIVE',
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
