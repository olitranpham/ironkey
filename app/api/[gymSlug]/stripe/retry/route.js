import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/stripe/retry
 * Body: { invoiceId }
 *
 * Retries payment on an open Stripe invoice via the gym's connected account.
 */
export async function POST(request) {
  try {
    const gymId = request.headers.get('x-gym-id')
    const { invoiceId } = await request.json()

    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: { stripeAccountId: true },
    })

    if (!gym?.stripeAccountId) {
      return NextResponse.json({ error: 'Stripe not connected for this gym' }, { status: 422 })
    }

    const stripe          = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
    const stripeAccount   = gym.stripeAccountId
    const connectOpts     = { stripeAccount }

    // Verify the invoice belongs to a member in this gym before retrying
    const invoice = await stripe.invoices.retrieve(invoiceId, {}, connectOpts)
    const member  = await prisma.member.findFirst({
      where: { gymId, stripeCustomerId: invoice.customer },
    })

    if (!member) {
      return NextResponse.json({ error: 'Invoice does not belong to a member in this gym' }, { status: 403 })
    }

    const paid = await stripe.invoices.pay(invoiceId, {}, connectOpts)

    // If payment succeeded, mark member active
    if (paid.status === 'paid') {
      await prisma.member.update({
        where: { id: member.id },
        data:  { status: 'ACTIVE' },
      })
    }

    return NextResponse.json({ invoice: { id: paid.id, status: paid.status } })
  } catch (error) {
    console.error('[stripe/retry]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
