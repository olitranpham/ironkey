import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

// ── Server-side cache ─────────────────────────────────────────────────────────

const revenueCache = new Map()
const CACHE_TTL    = 30 * 60 * 1000  // 30 minutes

// Midnight on the 1st of `year`-`month` (0-indexed), as a UTC epoch second,
// interpreted in `timeZone` rather than the server process's own local time.
// Without this, "this month" silently follows whatever TZ the server
// happens to run in (e.g. Railway's container defaults to UTC) instead of
// the gym's actual local day — pushing early/late-month charges into the
// wrong bucket relative to what a gym owner sees on their own clock.
function monthStart(year, month, timeZone = 'America/New_York') {
  const utcGuess = Date.UTC(year, month, 1)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(utcGuess).map(p => [p.type, p.value]))
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  const offsetMs = asUTC - utcGuess
  return Math.floor((utcGuess - offsetMs) / 1000)
}

// Fallback keyword match for one-time payments whose Checkout Session predates
// (or is otherwise missing) the metadata.source tagging — mirrors the keyword
// list used to identify guest-pass products in /api/[gymSlug]/guest.
const GUEST_PASS_KEYWORDS = ['day pass', 'single', '3-pack', 'three-pack', '5-pack', 'five-pack', '10-pack', 'ten-pack']
function isGuestPassName(name = '') {
  const n = name.toLowerCase()
  return GUEST_PASS_KEYWORDS.some(kw => n.includes(kw))
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

// Stripe list endpoints cap a single page at 100 records — any month (or any
// account) with more than that silently gets truncated to whatever `list()`
// returns on the first page unless `has_more`/`starting_after` are followed.
// This walks every page and returns the full result set.
async function stripeListAll(fn, params) {
  let results = []
  let startingAfter
  while (true) {
    const page = await stripeWithRetry(() => fn({ ...params, limit: 100, starting_after: startingAfter }))
    results = results.concat(page.data)
    if (!page.has_more) break
    startingAfter = page.data[page.data.length - 1].id
  }
  return results
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request, { params }) {
  const { gymSlug } = await params
  const cached = revenueCache.get(gymSlug)

  try {
    // Fresh cache — return immediately without touching Stripe.
    // Only serve cache entries that have a non-empty monthly array; if the
    // cached entry was written when monthly was [] (e.g. no entries at the time),
    // fall through and recompute.
    if (cached && Date.now() - cached.ts < CACHE_TTL && cached.data.monthly?.length > 0) {
      return NextResponse.json(cached.data)
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, stripeSecretKey: true, timezone: true },
    })
    if (!gym?.stripeSecretKey) {
      return NextResponse.json({ error: 'Stripe not configured for this gym' }, { status: 400 })
    }

    const stripe   = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const gymTz    = gym.timezone || 'America/New_York'

    // "Now" in the gym's own timezone, not the server's — otherwise a gym
    // near a month boundary can have "this month" resolve to a different
    // calendar month than what its own clock shows.
    const nowParts  = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: gymTz, year: 'numeric', month: 'numeric' })
        .formatToParts(new Date())
        .map(p => [p.type, p.value])
    )
    const thisYear  = Number(nowParts.year)
    const thisMonth = Number(nowParts.month) - 1  // 0-indexed

    // ── Parallel: earliest FinancialEntry + always-needed Stripe calls ────────
    const [firstEntry, activeSubs, recentResult, inventoryItems] = await Promise.all([
      prisma.financialEntry.findFirst({
        where:   { gymId: gym.id },
        orderBy: { date: 'asc' },
        select:  { date: true },
      }),
      stripeListAll(p => stripe.subscriptions.list(p), { status: 'active' }),
      stripeWithRetry(() => stripe.charges.list({ limit: 50, expand: ['data.customer'] })),
      prisma.inventoryItem.findMany({
        where:  { gymId: gym.id, stripeProductId: { not: null } },
        select: { stripeProductId: true },
      }),
    ])

    // Product IDs that identify a one-time payment as a concessions purchase
    const concessionsProductIds = new Set(inventoryItems.map(i => i.stripeProductId))

    // ── MRR ───────────────────────────────────────────────────────────────────
    let mrrCents = 0
    for (const sub of activeSubs) {
      for (const item of sub.items.data) {
        const amount   = item.price?.unit_amount ?? 0
        const interval = item.price?.recurring?.interval
        if (interval === 'month')     mrrCents += amount
        else if (interval === 'year') mrrCents += Math.round(amount / 12)
      }
    }

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

    // ── Determine chart start ─────────────────────────────────────────────────
    // If the gym has FinancialEntries, anchor to the earliest one (those early
    // months must appear even if Stripe charges are $0 for them).
    // Otherwise fall back to 24 months so we capture the full Stripe charge
    // history without a fixed cutoff; leading zero-revenue months are trimmed
    // below so the chart starts at the first actual transaction.
    const gymId = gym.id
    const anchoredToEntry = Boolean(firstEntry)
    const startD = firstEntry
      ? new Date(firstEntry.date)
      : new Date(thisYear, thisMonth - 23, 1)  // 24 months back; Date handles year rollover

    let rangeYear  = startD.getFullYear()
    let rangeMonth = startD.getMonth()  // 0-indexed

    console.log(
      '[stripe/revenue] %s (gymId=%s) — firstEntry=%s anchor=%s startD=%s-%s',
      gymSlug, gymId,
      firstEntry ? firstEntry.date.toISOString().slice(0, 10) : 'none',
      anchoredToEntry ? 'entry' : 'fallback-24mo',
      rangeYear, String(rangeMonth + 1).padStart(2, '0'),
    )

    const monthRanges = []
    while (
      rangeYear < thisYear ||
      (rangeYear === thisYear && rangeMonth <= thisMonth)
    ) {
      monthRanges.push({
        key:   `${rangeYear}-${String(rangeMonth + 1).padStart(2, '0')}`,
        start: monthStart(rangeYear, rangeMonth, gymTz),
        end:   monthStart(rangeYear, rangeMonth + 1, gymTz),
      })
      rangeMonth++
      if (rangeMonth > 11) { rangeMonth = 0; rangeYear++ }
      if (monthRanges.length >= 60) break
    }

    // ── Per-month Stripe totals, broken down into memberships / guest passes /
    // concessions ──────────────────────────────────────────────────────────────
    // Memberships come from recurring subscription billing — those charges are
    // tied to an invoice (true for both the initial signup and every renewal).
    // One-time payments (guest passes, concessions) go through a Checkout
    // Session in `mode: 'payment'`, so those are categorized via the session's
    // `metadata.source` (set at creation by the guest/concessions checkout
    // routes), falling back to product-based matching when metadata is missing.
    const monthResults = await Promise.all(
      monthRanges.map(({ start, end }) =>
        Promise.all([
          stripeListAll(p => stripe.charges.list(p), { created: { gte: start, lt: end } }),
          stripeListAll(p => stripe.checkout.sessions.list(p), { created: { gte: start, lt: end } }),
        ])
      )
    )

    async function categorizeOneTimeSession(session) {
      const source = session.metadata?.source
      if (source === 'concessions') return 'concessions'
      if (source === 'guest_pass')  return 'guestPasses'

      // Fallback — inspect the session's line item product(s) directly
      try {
        const lineItems = await stripeWithRetry(() =>
          stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] })
        )
        for (const li of lineItems.data ?? []) {
          const prod   = li.price?.product
          const prodId = typeof prod === 'string' ? prod : prod?.id
          const name   = typeof prod === 'string' ? '' : (prod?.name ?? '')
          if (prodId && concessionsProductIds.has(prodId)) return 'concessions'
          if (isGuestPassName(name) || isGuestPassName(li.description ?? '')) return 'guestPasses'
        }
      } catch (err) {
        console.error('[stripe/revenue] failed to classify session', session.id, err.message)
      }
      return 'guestPasses'  // default for legacy one-time payments
    }

    const monthly = await Promise.all(monthRanges.map(async ({ key }, i) => {
      const [charges, sessions] = monthResults[i]

      // Memberships — recurring subscription charges (tied to an invoice)
      const membershipCents = charges
        .filter(c => c.status === 'succeeded' && !c.refunded && c.invoice)
        .reduce((sum, c) => sum + c.amount, 0)

      // One-time payments — paid Checkout Sessions in payment mode
      const oneTimeSessions = sessions.filter(s => s.mode === 'payment' && s.payment_status === 'paid')
      const categories = await Promise.all(oneTimeSessions.map(categorizeOneTimeSession))

      let guestPassCents   = 0
      let concessionsCents = 0
      oneTimeSessions.forEach((session, idx) => {
        const amt = session.amount_total ?? 0
        if (categories[idx] === 'concessions') concessionsCents += amt
        else                                   guestPassCents  += amt
      })

      const memberships = membershipCents  / 100
      const guestPasses  = guestPassCents   / 100
      const concessions  = concessionsCents / 100

      console.log(
        '[stripe/revenue] %s %s — memberships=%s guestPasses=%s concessions=%s',
        gymSlug, key, memberships.toFixed(2), guestPasses.toFixed(2), concessions.toFixed(2),
      )

      return {
        month: key,
        memberships,
        guestPasses,
        concessions,
        amount: memberships + guestPasses + concessions,
      }
    }))

    // When the start is a fallback (no FinancialEntries), trim leading months
    // with $0 Stripe revenue so the chart begins at the first real charge.
    // When anchored to an entry date, keep all months — those early months may
    // have manual income/expense records that should appear in the chart.
    const trimmed = anchoredToEntry
      ? monthly
      : monthly.slice(monthly.findIndex(m => m.amount > 0) + (monthly.some(m => m.amount > 0) ? 0 : monthly.length))

    console.log(
      '[stripe/revenue] %s — %d month(s) raw, %d after trim: %s … %s',
      gymSlug, monthly.length, trimmed.length, trimmed.at(0)?.month, trimmed.at(-1)?.month,
    )

    // ── Summary figures ───────────────────────────────────────────────────────
    const thisMonthAmt = monthly.at(-1)?.amount ?? 0
    const lastMonthAmt = monthly.at(-2)?.amount ?? 0
    const ytd = monthly
      .filter(m => m.month.startsWith(String(thisYear)))
      .reduce((sum, m) => sum + m.amount, 0)

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
