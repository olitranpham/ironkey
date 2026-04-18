import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

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

  if (!gym.stripeSecretKey || !gym.stripeWebhookSecret) {
    console.warn('[webhook] Stripe not configured for gym:', gymSlug)
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  let event
  try {
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    event = stripe.webhooks.constructEvent(rawBody, sig, gym.stripeWebhookSecret)
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log('[webhook]', gymSlug, '| event:', event.type)

  // ── Handle events ─────────────────────────────────────────────────────────
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
    if (member.accessCode && gym.seamApiKey && gym.seamDeviceId) {
      try {
        const seamHeaders = {
          Authorization:  `Bearer ${gym.seamApiKey}`,
          'Content-Type': 'application/json',
        }
        const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify({ device_id: gym.seamDeviceId }),
        })
        const { access_codes = [] } = await listRes.json()
        const match = access_codes.find(
          c => String(c.code).trim() === String(member.accessCode).trim()
        )

        if (match) {
          const delRes = await fetch(`${SEAM_API}/access_codes/delete`, {
            method:  'POST',
            headers: seamHeaders,
            body:    JSON.stringify({ access_code_id: match.access_code_id }),
          })
          console.log('[webhook] Seam delete status:', delRes.status, '| code:', member.accessCode)
        } else {
          console.log('[webhook] Seam code not found on device (may already be removed):', member.accessCode)
        }
      } catch (seamErr) {
        console.error('[webhook] Seam error:', seamErr.message)
      }
    }

    // ── Ensure DB status is CANCELLED ───────────────────────────────────────
    if (member.status !== 'CANCELLED') {
      await prisma.member.update({
        where: { id: member.id },
        data:  { status: 'CANCELLED', dateCanceled: new Date(), updatedAt: new Date() },
      })
      console.log('[webhook] member status updated to CANCELLED:', member.id)
    }
  }

  return NextResponse.json({ received: true })
}
