import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// ── GET /api/[gymSlug]/stripe/overdue ─────────────────────────────────────────
// Returns all OVERDUE members enriched with live Stripe invoice data.
// Gracefully falls back to DB-only data when Stripe isn't connected.

export async function GET(request) {
  try {
    const gymId = request.headers.get('x-gym-id')
    if (!gymId) return NextResponse.json({ error: 'Gym identity missing' }, { status: 400 })

    const members = await prisma.member.findMany({
      where:   { gymId, status: 'OVERDUE' },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true, firstName: true, lastName: true, email: true,
        membershipType: true, status: true,
        stripeCustomerId: true, stripeSubscriptionId: true, createdAt: true,
      },
    })

    // Enrich with open Stripe invoices when a connected account is configured
    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: { stripeAccountId: true },
    })

    const stripeAccountId = gym?.stripeAccountId
    const platformKey     = process.env.STRIPE_SECRET_KEY
    const stripeOk        = Boolean(stripeAccountId && platformKey)
    let invoiceBySubId    = {}

    if (stripeOk && members.some(m => m.stripeSubscriptionId)) {
      try {
        const stripe = new Stripe(platformKey, { apiVersion: '2024-06-20' })
        const subIds = [...new Set(members.map(m => m.stripeSubscriptionId).filter(Boolean))]
        const results = await Promise.all(
          subIds.map(subId =>
            stripe.invoices.list(
              { subscription: subId, status: 'open', limit: 1 },
              { stripeAccount: stripeAccountId },
            )
              .then(res => ({ subId, invoice: res.data[0] ?? null }))
              .catch(() => ({ subId, invoice: null }))
          )
        )
        for (const { subId, invoice } of results) {
          if (invoice) invoiceBySubId[subId] = invoice
        }
      } catch (err) {
        console.warn('[stripe/overdue GET] Stripe fetch failed:', err.message)
      }
    }

    const overdue = members.map(m => {
      const inv = m.stripeSubscriptionId ? invoiceBySubId[m.stripeSubscriptionId] : null
      return {
        id: m.id, firstName: m.firstName, lastName: m.lastName,
        email: m.email, membershipType: m.membershipType, status: m.status,
        stripeCustomerId: m.stripeCustomerId, stripeSubscriptionId: m.stripeSubscriptionId,
        createdAt: m.createdAt,
        invoiceId:     inv?.id         ?? null,
        amountDue:     inv?.amount_due ?? null,  // cents
        invoiceStatus: inv?.status     ?? null,
        dueDate:       inv?.due_date   ?? null,  // unix timestamp
      }
    })

    return NextResponse.json({ overdue })
  } catch (error) {
    console.error('[stripe/overdue GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/[gymSlug]/stripe/overdue ────────────────────────────────────────
// Webhook / internal: mark a member as OVERDUE.

export async function POST(request) {
  try {
    const gymId = request.headers.get('x-gym-id')
    const body  = await request.json()

    let member

    if (body.memberId) {
      member = await prisma.member.findFirst({ where: { id: body.memberId, gymId } })
    } else if (body.stripeSubscriptionId) {
      member = await prisma.member.findFirst({
        where: { stripeSubscriptionId: body.stripeSubscriptionId, gymId },
      })
    } else if (body.type === 'invoice.payment_failed') {
      const subscription = body.data?.object?.subscription
      if (!subscription) return NextResponse.json({ error: 'Missing subscription in event' }, { status: 400 })
      member = await prisma.member.findFirst({ where: { stripeSubscriptionId: subscription, gymId } })
    } else {
      return NextResponse.json({ error: 'Provide memberId, stripeSubscriptionId, or invoice.payment_failed event' }, { status: 400 })
    }

    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (member.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Cannot mark a cancelled membership as overdue' }, { status: 400 })
    }

    const updated = await prisma.member.update({ where: { id: member.id }, data: { status: 'OVERDUE' } })
    return NextResponse.json({ member: updated })
  } catch (error) {
    console.error('[stripe/overdue POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
