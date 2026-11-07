import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { monthStart, DEFAULT_GYM_TIME_ZONE } from '@/lib/etMonth'
import { isPtProduct } from '@/lib/ptProducts'
import { cachedLookup } from '@/lib/stripeLookupCache'
import { trainerBillingProductId } from '@/lib/trainerBilling'

// ── Server-side cache ─────────────────────────────────────────────────────────

const revenueCache = new Map()
const CACHE_TTL    = 30 * 60 * 1000  // 30 minutes

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
    const { errorResponse } = await requirePermission(request, gymSlug, 'billing.view')
    if (errorResponse) return errorResponse

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
    const gymTz    = gym.timezone || DEFAULT_GYM_TIME_ZONE

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

    // PT = the gym's PT products (lib/ptProducts) plus the outside-trainer
    // billing product (lib/trainerBilling), looked up per account (10 min cache)
    const trainerProductId = await cachedLookup(`trainer-product:${gym.id}`, () => trainerBillingProductId(stripe), 10 * 60 * 1000)
    const isPt = productId => isPtProduct(gymSlug, productId) || Boolean(trainerProductId && productId === trainerProductId)

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
          // invoice expanded: its lines (product per line) split PT from memberships
          stripeListAll(p => stripe.charges.list(p), { created: { gte: start, lt: end }, expand: ['data.invoice'] }),
          stripeListAll(p => stripe.checkout.sessions.list(p), { created: { gte: start, lt: end } }),
        ])
      )
    )

    // A completed session's line items never change — cached (lib/stripeLookupCache)
    const sessionLineItems = session => cachedLookup(`session-lines:${gym.id}:${session.id}`, async () => {
      const lineItems = await stripeWithRetry(() =>
        stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] })
      )
      return (lineItems.data ?? []).map(li => {
        const prod = li.price?.product
        return {
          productId:   typeof prod === 'string' ? prod : prod?.id ?? null,
          name:        typeof prod === 'string' ? '' : (prod?.name ?? ''),
          description: li.description ?? '',
        }
      })
    })

    async function categorizeOneTimeSession(session) {
      const source = session.metadata?.source
      if (source === 'concessions') return 'concessions'
      if (source === 'guest_pass')  return 'guestPasses'

      // Otherwise inspect the session's line item product(s)
      try {
        const lines = await sessionLineItems(session)
        if (lines.some(l => isPt(l.productId))) return 'pt'
        for (const l of lines) {
          if (l.productId && concessionsProductIds.has(l.productId)) return 'concessions'
          if (isGuestPassName(l.name) || isGuestPassName(l.description)) return 'guestPasses'
        }
      } catch (err) {
        console.error('[stripe/revenue] failed to classify session', session.id, err.message)
      }
      return 'guestPasses'  // default for legacy one-time payments
    }

    // { productId, amount } per invoice line. The expanded invoice carries its
    // first page of lines; only an invoice with more is fetched (and cached —
    // a paid invoice's lines never change).
    async function invoiceLines(invoice) {
      const id = typeof invoice === 'string' ? invoice : invoice?.id
      if (!id) return []
      const toLine = l => ({ productId: l.price?.product ?? null, amount: l.amount ?? 0 })
      if (typeof invoice === 'object' && invoice.lines && !invoice.lines.has_more) {
        return invoice.lines.data.map(toLine)
      }
      return cachedLookup(`invoice-lines:${gym.id}:${id}`, async () =>
        (await stripeListAll(p => stripe.invoices.listLineItems(id, p), {})).map(toLine)
      )
    }

    // PT share of a subscription/invoice charge: the PT lines' share of the
    // invoice, applied to what was actually charged (so discounts/tax split
    // the same way). Bundled PT products count in full.
    async function ptCentsOfCharge(charge) {
      try {
        const lines = await invoiceLines(charge.invoice)
        const total = lines.reduce((sum, l) => sum + Math.max(0, l.amount), 0)
        const pt    = lines.filter(l => isPt(l.productId)).reduce((sum, l) => sum + Math.max(0, l.amount), 0)
        if (pt === 0)      return 0
        if (total <= 0)    return charge.amount
        return Math.round(charge.amount * (pt / total))
      } catch (err) {
        console.error('[stripe/revenue] failed to classify charge', charge.id, err.message)
        return 0
      }
    }

    const monthly = await Promise.all(monthRanges.map(async ({ key }, i) => {
      const [charges, sessions] = monthResults[i]

      // Memberships — recurring subscription charges (tied to an invoice),
      // minus the PT lines on them
      const invoiceCharges = charges.filter(c => c.status === 'succeeded' && !c.refunded && c.invoice)
      const ptShares       = await Promise.all(invoiceCharges.map(ptCentsOfCharge))
      let ptCents          = ptShares.reduce((sum, n) => sum + n, 0)
      const membershipCents = invoiceCharges.reduce((sum, c) => sum + c.amount, 0) - ptCents

      // One-time payments — paid Checkout Sessions in payment mode
      const oneTimeSessions = sessions.filter(s => s.mode === 'payment' && s.payment_status === 'paid')
      const categories = await Promise.all(oneTimeSessions.map(categorizeOneTimeSession))

      let guestPassCents   = 0
      let concessionsCents = 0
      oneTimeSessions.forEach((session, idx) => {
        const amt = session.amount_total ?? 0
        if (categories[idx] === 'concessions') concessionsCents += amt
        else if (categories[idx] === 'pt')     ptCents         += amt
        else                                   guestPassCents  += amt
      })

      const memberships = membershipCents  / 100
      const guestPasses  = guestPassCents   / 100
      const concessions  = concessionsCents / 100
      const pt           = ptCents          / 100

      console.log(
        '[stripe/revenue] %s %s — memberships=%s pt=%s guestPasses=%s concessions=%s',
        gymSlug, key, memberships.toFixed(2), pt.toFixed(2), guestPasses.toFixed(2), concessions.toFixed(2),
      )

      return {
        month: key,
        memberships,
        guestPasses,
        concessions,
        pt,
        amount: memberships + pt + guestPasses + concessions,
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
