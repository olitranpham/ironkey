import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { requireBillingAdmin } from '@/lib/trainerBilling'
import { stripeErrorCopy } from '@/lib/stripePriceToggle'
import { writeAudit } from '@/lib/audit'

/**
 * PATCH /api/[gymSlug]/pt/trainer-billing/[trainerId]
 * OWNER / ADMIN. Body: { promotionCodeId?: string | null, customer?: string | null }
 *   customer — a member's email at this gym (uses their existing Stripe
 *   customer) or a cus_… id on this gym's account. Can't change once
 *   billing has started.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, trainerId } = await params
    const { ctx, errorResponse } = await requireBillingAdmin(request, gymSlug)
    if (errorResponse) return errorResponse
    const body = await request.json().catch(() => ({}))

    const trainer = await prisma.personalTrainer.findFirst({ where: { id: trainerId, gymId: ctx.gym.id } })
    if (!trainer) return NextResponse.json({ error: 'trainer not found' }, { status: 404 })
    const gym    = await prisma.gym.findUnique({ where: { id: ctx.gym.id }, select: { id: true, stripeSecretKey: true } })
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const data   = {}

    if (body.promotionCodeId !== undefined) {
      if (body.promotionCodeId) {
        const promo = await stripe.promotionCodes.retrieve(body.promotionCodeId)   // must exist on this gym's account
        const taken = await prisma.personalTrainer.findFirst({ where: { gymId: gym.id, promotionCodeId: promo.id, id: { not: trainer.id } }, select: { name: true } })
        if (taken) return NextResponse.json({ error: `that code is already linked to ${taken.name}` }, { status: 409 })
        data.promotionCodeId = promo.id
      } else data.promotionCodeId = null
    }

    if (body.customer !== undefined) {
      if (trainer.billingSubscriptionId) return NextResponse.json({ error: 'billing has started — the customer can’t change' }, { status: 409 })
      const value = String(body.customer ?? '').trim()
      if (!value) data.stripeCustomerId = null
      else if (value.startsWith('cus_')) {
        const c = await stripe.customers.retrieve(value)
        if (c.deleted) return NextResponse.json({ error: 'that stripe customer was deleted' }, { status: 400 })
        data.stripeCustomerId = c.id
      } else {
        const member = await prisma.member.findFirst({ where: { gymId: gym.id, email: value.toLowerCase() }, select: { stripeCustomerId: true, stripeSubscriptionId: true } })
        if (!member) return NextResponse.json({ error: 'no member with that email at this gym' }, { status: 404 })
        let cus = member.stripeCustomerId
        if (!cus && member.stripeSubscriptionId) cus = (await stripe.subscriptions.retrieve(member.stripeSubscriptionId)).customer
        if (!cus) return NextResponse.json({ error: 'that member has no stripe customer' }, { status: 400 })
        data.stripeCustomerId = typeof cus === 'string' ? cus : cus.id
      }
    }

    if (!Object.keys(data).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    await prisma.personalTrainer.update({ where: { id: trainer.id }, data })
    writeAudit(ctx, 'trainer.billing_link', 'PersonalTrainer', trainer.id, data)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[pt/trainer-billing PATCH]', error.type ?? '', error.message)
    return NextResponse.json({ error: error.type ? stripeErrorCopy(error) : 'Internal server error' }, { status: error.type ? 502 : 500 })
  }
}
