import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

async function getGym(gymSlug) {
  return prisma.gym.findUnique({
    where:  { slug: gymSlug },
    select: { id: true, stripeSecretKey: true },
  })
}

/**
 * PATCH /api/[gymSlug]/stripe/coupons/[promotionCodeId]
 * Body: { active: boolean }
 *
 * Promotion codes can't be deleted in Stripe, only deactivated (or
 * reactivated) — this preserves Stripe's own redemption/audit history.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, promotionCodeId } = await params
    const body = await request.json()

    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'active (boolean) is required' }, { status: 400 })
    }

    const gym = await getGym(gymSlug)
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },         { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const promotionCode = await stripe.promotionCodes.update(promotionCodeId, { active: body.active })

    return NextResponse.json({
      promotionCode: {
        id:     promotionCode.id,
        code:   promotionCode.code,
        active: promotionCode.active,
      },
    })
  } catch (error) {
    console.error('[stripe/coupons/[promotionCodeId] PATCH]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
