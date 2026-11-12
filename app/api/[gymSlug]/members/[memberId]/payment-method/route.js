import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { gymStripe, cardOnFile } from '@/lib/memberBilling'
import { emailEnabled } from '@/lib/email'

/**
 * GET /api/[gymSlug]/members/[memberId]/payment-method
 * members.edit. The member's card on file (brand, last 4, expiry — never
 * more), whether a link can be made (Stripe customer linked) and whether
 * "email link to member" is available (Resend configured).
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.edit')
    if (errorResponse) return errorResponse

    const [member, gym] = await Promise.all([
      prisma.member.findFirst({ where: { id: memberId, gymId: ctx.gym.id }, select: { id: true, stripeCustomerId: true, stripeSubscriptionId: true } }),
      prisma.gym.findUnique({ where: { id: ctx.gym.id }, select: { stripeSecretKey: true } }),
    ])
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const hasCustomer = Boolean(member.stripeCustomerId && gym?.stripeSecretKey)
    const card = hasCustomer ? await cardOnFile(gymStripe(gym), member) : null
    return NextResponse.json({ card, hasCustomer, emailEnabled: emailEnabled() })
  } catch (error) {
    console.error('[members/payment-method GET]', error.type ?? '', error.message)
    return NextResponse.json({ error: "couldn't load the card on file" }, { status: 502 })
  }
}
