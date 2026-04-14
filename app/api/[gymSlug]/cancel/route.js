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
    const thirtyDaysFromNow = Math.floor(Date.now() / 1000) + 30 * 86400

    console.log('[cancel] memberId:', memberId, '| subId:', subId, '| stripeKey set:', Boolean(stripeKey), '| key prefix:', stripeKey?.slice(0, 8) ?? 'n/a')

    if (subId && stripeKey) {
      try {
        const stripeClient = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

        // Retrieve subscription to get current period end
        const sub = await stripeClient.subscriptions.retrieve(subId)
        const cancelAt = Math.max(thirtyDaysFromNow, sub.current_period_end)

        console.log('[cancel] current_period_end:', sub.current_period_end, '| 30d from now:', thirtyDaysFromNow, '| cancel_at:', cancelAt)

        const result = await stripeClient.subscriptions.update(subId, { cancel_at: cancelAt })
        console.log('[cancel] Stripe result — status:', result.status, '| cancel_at:', result.cancel_at)
      } catch (stripeErr) {
        console.error('[cancel] Stripe error:', stripeErr.message)
      }
    } else {
      console.warn('[cancel] Skipping Stripe — subId:', subId, '| stripeKey present:', Boolean(stripeKey))
    }

    const now    = new Date()
    const member = await prisma.member.update({
      where: { id: memberId },
      data: {
        status:      'CANCELLED',
        dateCanceled: existing.dateCanceled ?? now,
        updatedAt:   now,
      },
    })

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[cancel]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
