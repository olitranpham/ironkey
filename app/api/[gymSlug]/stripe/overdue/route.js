import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

export async function GET(request) {
  try {
    const gymId = request.headers.get('x-gym-id')
    if (!gymId) return NextResponse.json({ error: 'Gym identity missing' }, { status: 400 })

    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: { stripeAccountId: true },
    })

    const stripeAccountId = gym?.stripeAccountId
    const platformKey     = process.env.STRIPE_SECRET_KEY
    const stripeOk        = Boolean(stripeAccountId && platformKey)

    if (stripeOk) {
      try {
        const stripe = new Stripe(platformKey, { apiVersion: '2024-06-20' })
        const opts   = { stripeAccount: stripeAccountId }
        const expand = ['data.customer', 'data.latest_invoice', 'data.latest_invoice.payment_intent']

        const [r1, r2] = await Promise.all([
          stripe.subscriptions.list({ status: 'past_due', limit: 50, expand }, opts),
          stripe.subscriptions.list({ status: 'unpaid',   limit: 50, expand }, opts),
        ])

        const overdue = [...r1.data, ...r2.data]

        // Match to DB members for names, membership type, and internal ID
        const emails = overdue
          .map(s => s.customer?.email?.toLowerCase().trim())
          .filter(Boolean)

        const members = await prisma.member.findMany({
          where:  { gymId, email: { in: emails } },
          select: {
            id: true, firstName: true, lastName: true, email: true,
            membershipType: true, status: true,
            stripeCustomerId: true, stripeSubscriptionId: true,
          },
        })
        const memberByEmail = {}
        for (const m of members) {
          if (m.email) memberByEmail[m.email.toLowerCase()] = m
        }

        const rows = overdue.map(sub => {
          const email  = sub.customer?.email?.toLowerCase().trim()
          const member = memberByEmail[email] ?? null
          const inv    = sub.latest_invoice

          return {
            // DB member fields (may be null if not matched)
            id:             member?.id             ?? null,
            firstName:      member?.firstName      ?? sub.customer?.name?.split(' ')[0] ?? '—',
            lastName:       member?.lastName       ?? sub.customer?.name?.split(' ').slice(1).join(' ') ?? '',
            email:          email                  ?? null,
            membershipType: member?.membershipType ?? 'GENERAL',

            // Stripe fields
            invoiceId:     inv?.id         ?? null,
            amountDue:     inv?.amount_due ?? null,
            invoiceStatus: sub.status,
            dueDate:       inv?.due_date   ?? null,
            declineReason: inv?.payment_intent?.last_payment_error?.message ?? null,
            failedAt:      inv?.created    ?? null,
          }
        })

        // Sync DB status to OVERDUE for matched members so dashboard + members page reflect correctly
        const memberIdsToMark = rows
          .map(r => r.id)
          .filter(Boolean)
        if (memberIdsToMark.length > 0) {
          await prisma.member.updateMany({
            where: {
              id:     { in: memberIdsToMark },
              status: { notIn: ['CANCELLED', 'OVERDUE'] },
            },
            data: { status: 'OVERDUE' },
          })
        }

        return NextResponse.json({ overdue: rows })
      } catch (err) {
        console.error('[stripe/overdue GET]', err.message)
        return NextResponse.json({ overdue: [], stripeError: err.message })
      }
    }

    // Fallback: DB-only
    const members = await prisma.member.findMany({
      where:  { gymId, status: 'OVERDUE' },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        membershipType: true, status: true,
        stripeCustomerId: true, stripeSubscriptionId: true, createdAt: true,
      },
    })
    const overdue = members.map(m => ({
      id: m.id, firstName: m.firstName, lastName: m.lastName,
      email: m.email, membershipType: m.membershipType,
      invoiceId: null, amountDue: null, invoiceStatus: null,
      dueDate: null, declineReason: null, failedAt: null,
    }))

    return NextResponse.json({ overdue })
  } catch (error) {
    console.error('[stripe/overdue GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const gymId = request.headers.get('x-gym-id')
    const body  = await request.json()

    let member

    if (body.memberId) {
      member = await prisma.member.findFirst({ where: { id: body.memberId, gymId } })
    } else if (body.stripeSubscriptionId) {
      member = await prisma.member.findFirst({ where: { stripeSubscriptionId: body.stripeSubscriptionId, gymId } })
    } else if (body.type === 'invoice.payment_failed') {
      const subscription = body.data?.object?.subscription
      if (!subscription) return NextResponse.json({ error: 'Missing subscription in event' }, { status: 400 })
      member = await prisma.member.findFirst({ where: { stripeSubscriptionId: subscription, gymId } })
    } else {
      return NextResponse.json({ error: 'Provide memberId, stripeSubscriptionId, or invoice.payment_failed event' }, { status: 400 })
    }

    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (member.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Cannot mark a canceled membership as overdue' }, { status: 400 })
    }

    const updated = await prisma.member.update({ where: { id: member.id }, data: { status: 'OVERDUE' } })
    return NextResponse.json({ member: updated })
  } catch (error) {
    console.error('[stripe/overdue POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
