import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/stripe/resolve
 * Body: { memberId, invoiceId? }
 *
 * Marks a member's overdue invoice as paid out-of-band in Stripe
 * (e.g. payment received via Cash App, Venmo, etc.), which clears
 * the subscription's past_due status so they stop appearing as overdue.
 * Also sets the member's DB status to ACTIVE.
 */
export async function POST(request) {
  try {
    const gymId              = request.headers.get('x-gym-id')
    const { memberId, invoiceId } = await request.json()

    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })

    const [gym, member] = await Promise.all([
      prisma.gym.findUnique({ where: { id: gymId }, select: { stripeAccountId: true } }),
      prisma.member.findFirst({ where: { id: memberId, gymId } }),
    ])

    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    // Mark invoice as paid out-of-band in Stripe (clears past_due on the subscription)
    if (invoiceId && gym?.stripeAccountId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
        await stripe.invoices.pay(
          invoiceId,
          { paid_out_of_band: true },
          { stripeAccount: gym.stripeAccountId },
        )
      } catch (stripeErr) {
        // Non-fatal — invoice may already be paid or voided; still update DB
        console.warn('[stripe/resolve] Could not mark invoice paid out-of-band:', stripeErr.message)
      }
    }

    // Update DB status to ACTIVE
    const updated = await prisma.member.update({
      where: { id: member.id },
      data:  { status: 'ACTIVE' },
    })

    return NextResponse.json({ member: updated })
  } catch (error) {
    console.error('[stripe/resolve]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
