import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { requirePermission, can } from '@/lib/permissions'
import { PT_PRODUCT_IDS } from '@/lib/ptProducts'
import { cachedLookup } from '@/lib/stripeLookupCache'

// PT subscriptions for a gym change rarely; a short cache keeps the PT page
// from listing every subscription on each load.
const SUBS_TTL_MS = 5 * 60 * 1000
const LIVE        = new Set(['active', 'trialing', 'past_due', 'unpaid'])

/**
 * GET /api/[gymSlug]/pt/memberships
 * Members with a live PT subscription (a subscription item whose product is
 * in PT_PRODUCT_IDS for this gym): name, PT plan, status, start date and
 * assigned trainer. Also returns the gym's trainers and whether the caller
 * can assign (pt.assign).
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, ['pt.manage_all', 'pt.assign'])
    if (errorResponse) return errorResponse

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true, stripeSecretKey: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const trainers = await prisma.personalTrainer.findMany({
      where:   { gymId: gym.id },
      orderBy: { name: 'asc' },
      select:  { id: true, name: true, color: true },
    })
    const canAssign = can(ctx.user, 'pt.assign')

    const ptIds = PT_PRODUCT_IDS[gymSlug]
    if (!ptIds?.size || !gym.stripeSecretKey) {
      return NextResponse.json({ rows: [], trainers, canAssign })
    }

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const subs = await cachedLookup(`pt-subs:${gym.id}`, async () => {
      const out = []
      for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] })) {
        if (!LIVE.has(sub.status)) continue
        const ptItems = sub.items.data.filter(i => ptIds.has(i.price?.product))
        if (!ptItems.length) continue
        out.push({
          id:          sub.id,
          status:      sub.status,
          startDate:   sub.start_date ? new Date(sub.start_date * 1000).toISOString() : null,
          email:       (typeof sub.customer === 'object' ? sub.customer?.email : null)?.toLowerCase() ?? null,
          name:        typeof sub.customer === 'object' ? sub.customer?.name ?? null : null,
          productIds:  [...new Set(ptItems.map(i => i.price.product))],
        })
      }
      return out
    }, SUBS_TTL_MS)

    // Product names for the plan column (cached; a product's name rarely changes)
    const productIds = [...new Set(subs.flatMap(s => s.productIds))]
    const names = Object.fromEntries(await Promise.all(productIds.map(async id => [
      id,
      await cachedLookup(`product-name:${gym.id}:${id}`, async () => (await stripe.products.retrieve(id)).name),
    ])))

    // Match to this gym's members by subscription id, then by email
    const members = await prisma.member.findMany({
      where: {
        gymId: gym.id,
        OR: [
          { stripeSubscriptionId: { in: subs.map(s => s.id) } },
          { email: { in: subs.map(s => s.email).filter(Boolean) } },
        ],
      },
      select: {
        id: true, firstName: true, lastName: true, email: true, stripeSubscriptionId: true,
        assignedTrainer: { select: { id: true, name: true } },
      },
    })
    const bySub   = new Map(members.filter(m => m.stripeSubscriptionId).map(m => [m.stripeSubscriptionId, m]))
    const byEmail = new Map(members.map(m => [m.email?.toLowerCase(), m]))

    const rows = subs.map(s => {
      const m = bySub.get(s.id) ?? (s.email ? byEmail.get(s.email) : null)
      return {
        subscriptionId: s.id,
        memberId:       m?.id ?? null,
        name:           m ? `${m.firstName} ${m.lastName}`.trim() : (s.name ?? s.email ?? 'unknown'),
        plan:           s.productIds.map(id => names[id] ?? id).join(' + '),
        status:         s.status,
        startDate:      s.startDate,
        trainer:        m?.assignedTrainer ?? null,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ rows, trainers, canAssign })
  } catch (error) {
    console.error('[pt/memberships GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
