import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { getPlanChangeContext, membershipTypeFor } from '@/lib/membershipPlans'
import { ensureKisiMembership } from '@/lib/kisi'
import { writeAudit } from '@/lib/audit'

const publicContext = c => (c.canChange
  ? { canChange: true, current: c.current, options: c.options, effectiveAt: c.effectiveAt, paused: c.paused }
  : { canChange: false, reason: c.reason, message: c.message })

async function loadMember(gymId, memberId) {
  return prisma.member.findFirst({ where: { id: memberId, gymId } })
}

/**
 * GET /api/[gymSlug]/members/[memberId]/plan
 * What the "change membership" control can offer: the current price, the
 * other membership prices on the same billing interval, and when a change
 * takes effect — or why it can't be changed. One read-only
 * subscriptions.retrieve (+ prices.list) on the gym's Stripe account.
 * Requires billing.act.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'billing.act')
    if (errorResponse) return errorResponse

    const member = await loadMember(ctx.gym.id, memberId)
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    return NextResponse.json(publicContext(await getPlanChangeContext(ctx.gym, member)))
  } catch (error) {
    console.error('[members/plan GET]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/[gymSlug]/members/[memberId]/plan   Body: { priceId }
 * Swap the subscription item's price on the gym's connected account with
 * proration_behavior 'none' — the new price applies from the next renewal.
 * pause_collection is never touched (frozen members stay paused). The DB is
 * changed only after Stripe succeeds; a Stripe error changes nothing and is
 * returned to the UI. Requires billing.act.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug, memberId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'billing.act')
    if (errorResponse) return errorResponse

    const { priceId } = await request.json().catch(() => ({}))
    if (!priceId) return NextResponse.json({ error: 'priceId is required' }, { status: 400 })

    const member = await loadMember(ctx.gym.id, memberId)
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    // Re-check everything server-side (never trust the dropdown)
    const plan = await getPlanChangeContext(ctx.gym, member)
    if (!plan.canChange) return NextResponse.json({ error: plan.message, reason: plan.reason }, { status: 409 })
    const target = plan.options.find(o => o.priceId === priceId)
    if (!target) return NextResponse.json({ error: 'that plan is not available for this member' }, { status: 400 })

    // ── Stripe first ──────────────────────────────────────────────────────────
    try {
      await plan.stripe.subscriptions.update(plan.subscriptionId, {
        items:              [{ id: plan.itemId, price: target.priceId }],
        proration_behavior: 'none',
      })
    } catch (err) {
      console.error('[members/plan POST] stripe update failed:', err.message)
      return NextResponse.json({ error: err.message || 'stripe rejected the change', stripe: true }, { status: 502 })
    }

    // ── Then the DB ───────────────────────────────────────────────────────────
    const fromType = member.membershipType
    const toType   = membershipTypeFor(target.name)
    const meta = {
      fromType, toType,
      fromPriceId: plan.current.priceId, toPriceId: target.priceId,
      fromAmount:  plan.current.amount,  toAmount:  target.amount,
      currency:    target.currency,
      effectiveAt: plan.effectiveAt,
    }
    const [updated] = await prisma.$transaction([
      prisma.member.update({ where: { id: member.id }, data: { membershipType: toType, priceId: target.priceId } }),
      prisma.membershipEvent.create({ data: { memberId: member.id, gymId: ctx.gym.id, type: 'plan_changed', meta, actorId: ctx.user.id } }),
    ])
    writeAudit(ctx, 'member.plan_change', 'Member', member.id, meta)

    // ── Access dependencies ───────────────────────────────────────────────────
    // Kisi group follows membershipType (weekend vs member group). Frozen
    // members have no access while frozen — resume re-grants for the new type.
    // Flex check-in eligibility reads membershipType directly; Seam is unaffected.
    let warning = null
    if (ctx.gym.accessProvider === 'KISI' && member.status !== 'FROZEN') {
      try {
        const result = await ensureKisiMembership(ctx.gym, {
          existingMember: member,
          email:          member.email,
          name:           `${member.firstName} ${member.lastName}`.trim(),
          membershipType: toType,
        })
        if (result) {
          await prisma.member.update({ where: { id: member.id }, data: { kisiUserId: result.kisiUserId, kisiRoleAssignmentId: result.kisiRoleAssignmentId } })
        }
      } catch (err) {
        console.error('[members/plan POST] kisi group update failed:', err.message)
        warning = 'plan changed, but the kisi door group could not be updated — check door access'
      }
    }

    return NextResponse.json({
      ok: true,
      member:      { id: updated.id, membershipType: updated.membershipType, priceId: updated.priceId },
      effectiveAt: plan.effectiveAt,
      ...(warning ? { warning } : {}),
    })
  } catch (error) {
    console.error('[members/plan POST]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
