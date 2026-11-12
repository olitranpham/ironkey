import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { gymStripe } from '@/lib/memberBilling'

/**
 * GET /api/[gymSlug]/members/[memberId]/invoices
 * members.edit, gym from the URL. Read-only: the member's last 12 Stripe
 * invoices on the gym's own account — { invoices: [{ id, number, created,
 * amountDue, amountPaid, amountRemaining, currency, status, hostedInvoiceUrl }] },
 * newest first. Empty when the member has no Stripe customer.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.edit')
    if (errorResponse) return errorResponse

    const [member, gym] = await Promise.all([
      prisma.member.findFirst({ where: { id: memberId, gymId: ctx.gym.id }, select: { id: true, stripeCustomerId: true } }),
      prisma.gym.findUnique({ where: { id: ctx.gym.id }, select: { stripeSecretKey: true } }),
    ])
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (!member.stripeCustomerId || !gym?.stripeSecretKey) return NextResponse.json({ invoices: [] })

    const list = await gymStripe(gym).invoices.list({ customer: member.stripeCustomerId, limit: 12 })
    return NextResponse.json({
      invoices: list.data.map(inv => ({
        id:               inv.id,
        number:           inv.number ?? null,
        created:          new Date(inv.created * 1000).toISOString(),
        amountDue:        inv.amount_due,
        amountPaid:       inv.amount_paid,
        amountRemaining:  inv.amount_remaining,
        currency:         inv.currency,
        status:           inv.status,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      })),
    })
  } catch (error) {
    console.error('[members/invoices GET]', error.type ?? '', error.message)
    return NextResponse.json({ error: "couldn't load invoices" }, { status: 502 })
  }
}
