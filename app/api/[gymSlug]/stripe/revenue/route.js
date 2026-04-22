import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// ── Server-side cache ─────────────────────────────────────────────────────────

const revenueCache = new Map()
const CACHE_TTL    = 30 * 60 * 1000  // 30 minutes

function monthStart(year, month) {
  // month is 0-indexed; Date handles year/month rollover automatically
  return Math.floor(new Date(year, month, 1).getTime() / 1000)
}

// ── Stripe call with one retry on 429 ─────────────────────────────────────────

async function stripeWithRetry(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err?.statusCode === 429 || err?.raw?.statusCode === 429) {
      await new Promise(r => setTimeout(r, 1000))
      return await fn()
    }
    throw err
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request, { params }) {
  const { gymSlug } = await params
  const cached = revenueCache.get(gymSlug)

  try {
    // Fresh cache — return immediately without touching Stripe
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data)
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { stripeSecretKey: true },
    })
    if (!gym?.stripeSecretKey) {
      return NextResponse.json({ error: 'Stripe not configured for this gym' }, { status: 400 })
    }

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    const now       = new Date()
    const thisYear  = now.getFullYear()
    const thisMonth = now.getMonth()  // 0-indexed

    // Build 12 month ranges (oldest → newest).
    // 12 parallel calls vs the previous 36 keeps us well under Stripe's rate limit.
    // Leading zero-revenue months are trimmed before returning.
    const monthRanges = []
    for (let i = 11; i >= 0; i--) {
      const d     = new Date(thisYear, thisMonth - i, 1)
      const year  = d.getFullYear()
      const month = d.getMonth()
      monthRanges.push({
        key:   `${year}-${String(month + 1).padStart(2, '0')}`,
        start: monthStart(year, month),
        end:   monthStart(year, month + 1),
      })
    }

    // ── All Stripe fetches in parallel — 14 calls total ───────────────────────
    // subscriptions (MRR) + recent transactions + 12 per-month charge buckets
    const [subsResult, recentResult, ...monthResults] = await Promise.all([
      stripeWithRetry(() => stripe.subscriptions.list({ status: 'active', limit: 100 })),
      stripeWithRetry(() => stripe.charges.list({ limit: 50, expand: ['data.customer'] })),
      ...monthRanges.map(({ start, end }) =>
        stripeWithRetry(() => stripe.charges.list({ limit: 100, created: { gte: start, lt: end } }))
      ),
    ])

    // ── MRR ───────────────────────────────────────────────────────────────────
    let mrrCents = 0
    for (const sub of subsResult.data) {
      for (const item of sub.items.data) {
        const amount   = item.price?.unit_amount ?? 0
        const interval = item.price?.recurring?.interval
        if (interval === 'month')     mrrCents += amount
        else if (interval === 'year') mrrCents += Math.round(amount / 12)
      }
    }

    // ── Monthly chart data ────────────────────────────────────────────────────
    const monthly = monthRanges.map(({ key }, i) => {
      const charges = monthResults[i]?.data ?? []
      const cents   = charges
        .filter(c => c.status === 'succeeded' && !c.refunded)
        .reduce((sum, c) => sum + c.amount, 0)
      return { month: key, amount: cents / 100 }
    })

    // Trim leading months with no revenue so chart starts at first payment
    const firstNonZero = monthly.findIndex(m => m.amount > 0)
    const trimmed      = firstNonZero === -1 ? monthly : monthly.slice(firstNonZero)

    // ── Summary figures ───────────────────────────────────────────────────────
    const thisMonthAmt = monthly.at(-1)?.amount ?? 0
    const lastMonthAmt = monthly.at(-2)?.amount ?? 0
    const ytd = monthly
      .filter(m => m.month.startsWith(String(thisYear)))
      .reduce((sum, m) => sum + m.amount, 0)

    // ── Recent transactions ───────────────────────────────────────────────────
    const transactions = recentResult.data
      .filter(c => c.status === 'succeeded')
      .map(c => ({
        id:     c.id,
        date:   c.created,
        name:   c.customer?.name  ?? c.billing_details?.name  ?? null,
        email:  c.customer?.email ?? c.billing_details?.email ?? null,
        amount: c.amount / 100,
        status: c.status,
      }))

    const data = {
      mrr:       mrrCents / 100,
      thisMonth: thisMonthAmt,
      lastMonth: lastMonthAmt,
      ytd,
      monthly:   trimmed,
      transactions,
    }

    revenueCache.set(gymSlug, { data, ts: Date.now() })
    return NextResponse.json(data)

  } catch (err) {
    const isRateLimit = err?.statusCode === 429 || err?.raw?.statusCode === 429

    // On 429, serve stale cache rather than failing
    if (isRateLimit && cached) {
      console.warn('[stripe/revenue] rate-limited, serving stale cache for', gymSlug)
      return NextResponse.json(cached.data)
    }

    console.error('[stripe/revenue]', err)
    return NextResponse.json(
      { error: isRateLimit ? 'Stripe rate limit — please wait and retry' : (err.message ?? 'Internal server error') },
      { status: isRateLimit ? 429 : 500 },
    )
  }
}
