import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { requireBillingAdmin, createCardSetupLink } from '@/lib/trainerBilling'
import { stripeErrorCopy } from '@/lib/stripePriceToggle'

/**
 * POST /api/[gymSlug]/pt/trainer-billing/[trainerId]/setup-link
 * OWNER / ADMIN. A Stripe-hosted card-setup page (setup mode, this gym's
 * account) to send to the trainer; the webhook makes the saved card their
 * default for billing.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug, trainerId } = await params
    const { ctx, errorResponse } = await requireBillingAdmin(request, gymSlug)
    if (errorResponse) return errorResponse
    const trainer = await prisma.personalTrainer.findFirst({ where: { id: trainerId, gymId: ctx.gym.id } })
    if (!trainer) return NextResponse.json({ error: 'trainer not found' }, { status: 404 })
    const gym    = await prisma.gym.findUnique({ where: { id: ctx.gym.id }, select: { stripeSecretKey: true } })
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? `https://${request.headers.get('host')}`
    const url = await createCardSetupLink(stripe, trainer, origin, gymSlug)
    return NextResponse.json({ url })
  } catch (error) {
    console.error('[pt/trainer-billing setup-link]', error.type ?? '', error.message)
    if (error.status) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: error.type ? stripeErrorCopy(error) : 'Internal server error' }, { status: error.type ? 502 : 500 })
  }
}
