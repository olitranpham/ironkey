import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * Given the current period end (Unix timestamp) and the subscription object,
 * return a Unix timestamp representing the end of the next billing period.
 * Used when current_period_end is less than 30 days away and we need to push
 * the cancel_at date out by one full billing interval.
 */
function nextBillingPeriodEnd(currentPeriodEndSecs, sub) {
  const d         = new Date(currentPeriodEndSecs * 1000)
  const recurring = sub.items?.data?.[0]?.price?.recurring ?? {}
  const interval  = recurring.interval ?? 'month'
  const count     = recurring.interval_count ?? 1

  switch (interval) {
    case 'year':  d.setFullYear(d.getFullYear() + count); break
    case 'month': d.setMonth(d.getMonth() + count);       break
    case 'week':  d.setDate(d.getDate() + count * 7);     break
    case 'day':   d.setDate(d.getDate() + count);         break
    default:      d.setMonth(d.getMonth() + 1)
  }

  return Math.floor(d.getTime() / 1000)
}

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

    console.log('[cancel] memberId:', memberId, '| subId:', subId, '| stripeKey set:', Boolean(stripeKey), '| key prefix:', stripeKey?.slice(0, 8) ?? 'n/a')

    let stripeWarning = null

    if (subId && stripeKey) {
      try {
        const stripeClient = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

        const sub              = await stripeClient.subscriptions.retrieve(subId)
        const nowSecs          = Math.floor(Date.now() / 1000)
        const thirtyDaysFromNow = nowSecs + 30 * 86400

        let stripeParams
        if (sub.current_period_end >= thirtyDaysFromNow) {
          // Period end is already 30+ days out — cancel at natural period end
          stripeParams = { cancel_at_period_end: true }
          console.log('[cancel] current_period_end >= 30d — using cancel_at_period_end:true | period_end:', sub.current_period_end)
        } else {
          // Period end is < 30 days away — push to the next billing period end
          const nextEnd = nextBillingPeriodEnd(sub.current_period_end, sub)
          stripeParams  = { cancel_at: nextEnd }
          console.log('[cancel] current_period_end < 30d — using cancel_at:', nextEnd, '| current_period_end:', sub.current_period_end)
        }

        const result = await stripeClient.subscriptions.update(subId, stripeParams)
        console.log('[cancel] Stripe result — status:', result.status, '| cancel_at_period_end:', result.cancel_at_period_end, '| cancel_at:', result.cancel_at)
      } catch (stripeErr) {
        console.error('[cancel] Stripe error:', stripeErr.message)
        if (stripeErr.message?.includes('not created by your application')) {
          stripeWarning = 'stripe_dashboard_sub'
        }
      }
    } else {
      console.warn('[cancel] Skipping Stripe — subId:', subId, '| stripeKey present:', Boolean(stripeKey))
    }

    const now    = new Date()
    const member = await prisma.member.update({
      where: { id: memberId },
      data: {
        cancelScheduled: true,
        updatedAt:       now,
      },
    })

    await prisma.membershipEvent.create({ data: { memberId, gymId, type: 'cancellation_scheduled', date: now } })

    if (stripeWarning === 'stripe_dashboard_sub') {
      return NextResponse.json({
        member,
        ok:      false,
        error:   'stripe_dashboard_sub',
        message: 'This subscription was created outside of ironkey and cannot be canceled via the API. To cancel this member, cancel their subscription manually in the Stripe dashboard.',
      })
    }

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[cancel]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
