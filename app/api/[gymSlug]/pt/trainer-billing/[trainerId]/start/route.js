import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { requireBillingAdmin, startTrainerBilling } from '@/lib/trainerBilling'
import { stripeErrorCopy } from '@/lib/stripePriceToggle'
import { writeAudit } from '@/lib/audit'

/**
 * POST /api/[gymSlug]/pt/trainer-billing/[trainerId]/start
 * OWNER / ADMIN. Body: { paymentMethodId } — the card staff confirmed on
 * screen. Creates the metered monthly subscription (anchored to the next
 * 1st, Boston time) on the trainer's linked customer.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug, trainerId } = await params
    const { ctx, errorResponse } = await requireBillingAdmin(request, gymSlug)
    if (errorResponse) return errorResponse
    const { paymentMethodId } = await request.json().catch(() => ({}))
    if (!paymentMethodId) return NextResponse.json({ error: 'confirm the payment method first' }, { status: 400 })

    const trainer = await prisma.personalTrainer.findFirst({ where: { id: trainerId, gymId: ctx.gym.id } })
    if (!trainer) return NextResponse.json({ error: 'trainer not found' }, { status: 404 })
    const gym    = await prisma.gym.findUnique({ where: { id: ctx.gym.id }, select: { stripeSecretKey: true } })
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const { subscription, paymentMethod } = await startTrainerBilling(stripe, trainer, paymentMethodId)
    writeAudit(ctx, 'trainer.billing_start', 'PersonalTrainer', trainer.id, { subscription: subscription.id, card: `${paymentMethod.brand} ${paymentMethod.last4}` })
    console.log('[trainer-billing] started trainer=%s sub=%s', trainer.id, subscription.id)
    return NextResponse.json({ ok: true, subscriptionId: subscription.id })
  } catch (error) {
    console.error('[pt/trainer-billing start]', error.type ?? '', error.message)
    if (error.status) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: error.type ? stripeErrorCopy(error) : 'Internal server error' }, { status: error.type ? 502 : 500 })
  }
}
