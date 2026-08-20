import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'

/**
 * POST /api/[gymSlug]/stripe/webhook
 * Public route — registered in the gym's Stripe dashboard.
 *
 * Handles:
 *   customer.subscription.deleted  → delete Seam access code when subscription actually ends
 */
export async function POST(request, { params }) {
  const { gymSlug } = await params
  const rawBody     = await request.text()
  const sig         = request.headers.get('stripe-signature')

  // ── Load gym + webhook secret ─────────────────────────────────────────────
  const gym = await prisma.gym.findUnique({
    where:  { slug: gymSlug },
    select: {
      id:                 true,
      stripeSecretKey:    true,
      stripeWebhookSecret: true,
      seamApiKey:         true,
      seamDeviceId:       true,
    },
  })

  if (!gym) {
    console.error('[webhook] gym not found for slug:', gymSlug)
    return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
  }

  if (!gym.stripeSecretKey) {
    console.warn('[webhook] Stripe not configured for gym:', gymSlug)
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
  const webhookSecret = gym.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET
  let event
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    } else {
      event = JSON.parse(rawBody)
    }
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log('[webhook]', gymSlug, '| event:', event.type)

  // ── checkout.session.completed is handled exclusively by the platform webhook
  // ── (/api/stripe/webhook) to avoid double processing. Do not handle it here.

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    const subId = sub.id

    // Find member by subscription ID
    const member = await prisma.member.findFirst({
      where: { gymId: gym.id, stripeSubscriptionId: subId },
      select: { id: true, accessCode: true, status: true },
    })

    if (!member) {
      console.warn('[webhook] no member found for subscription:', subId)
      return NextResponse.json({ received: true })
    }

    console.log('[webhook] subscription deleted for member:', member.id, '| accessCode:', member.accessCode)

    // ── Delete Seam access code ─────────────────────────────────────────────
    if (member.accessCode && gym.seamApiKey) {
      await deleteSeamCodeByPin(gym.seamApiKey, member.accessCode, gym.seamDeviceId, '[webhook]')
    }

    // ── Ensure DB status is CANCELED ────────────────────────────────────────
    if (member.status !== 'CANCELED') {
      await prisma.member.update({
        where: { id: member.id },
        data:  { status: 'CANCELED', cancelScheduled: false, cancelEffectiveDate: null, dateCanceled: new Date(), updatedAt: new Date() },
      })
      await prisma.membershipEvent.create({
        data: { memberId: member.id, gymId: gym.id, type: 'canceled' },
      })
      console.log('[webhook] member status updated to CANCELED:', member.id)
    }
  }

  return NextResponse.json({ received: true })
}
