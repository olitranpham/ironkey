// Link existing GuestPass rows to the paid guest_pass Checkout sessions that
// created them: sets stripeSessionId, amountPaid, stripePriceId and packSize.
//
//   node scripts/backfill-guest-pass-sessions.js                 # dry run, all gyms
//   node scripts/backfill-guest-pass-sessions.js --gym <slug>    # one gym
//   node scripts/backfill-guest-pass-sessions.js --apply         # write
//
// Match rule (same as the Triumph audit): same email and pass type, row
// created from 60 s before to 3 h after the session; each session takes the
// earliest such row. Unmatched rows are reported and never touched — rows
// that look like duplicates of a matched row are listed separately so they
// can be reviewed and deleted by ID.

import Stripe from 'stripe'
import prisma from '../lib/prisma.js'
import { resolvePackSize } from '../lib/gymPassTypes.js'
import { OASIS_GUEST_PASS_PRODUCTS } from '../lib/oasisGuestPasses.js'
import { DEFAULT_GYM_TIME_ZONE } from '../lib/etMonth.js'

const APPLY      = process.argv.includes('--apply')
const gymArg     = process.argv.indexOf('--gym')
const ONLY_GYM   = gymArg > -1 ? process.argv[gymArg + 1] : null
const BEFORE_SEC = 60
const AFTER_SEC  = 3 * 60 * 60

const maskEmail = e => (e ? `${e.slice(0, 3)}…@${e.split('@')[1] ?? ''}` : '(no email)')

function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
function localTime(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(date)
}

/** Paid guest_pass Checkout sessions for this gym, oldest first, with their first line item. */
async function listGuestPassSessions(stripe, gym, since, requestOptions) {
  const sessions = []
  const params   = { limit: 100, created: { gte: since }, expand: ['data.line_items'] }
  for await (const s of stripe.checkout.sessions.list(params, requestOptions)) {
    if (s.mode !== 'payment' || s.payment_status !== 'paid') continue
    if (s.metadata?.source !== 'guest_pass') continue
    if (s.metadata?.gymId && s.metadata.gymId !== gym.id) continue
    if (!s.metadata?.gymId && s.metadata?.gymSlug && s.metadata.gymSlug !== gym.slug) continue
    const item      = s.line_items?.data?.[0]
    const productId = typeof item?.price?.product === 'string' ? item.price.product : item?.price?.product?.id ?? null
    sessions.push({
      id:        s.id,
      created:   s.created,
      email:     (s.customer_email ?? s.customer_details?.email ?? s.metadata?.email ?? '').trim().toLowerCase(),
      // Same pass type the webhook derived for this session
      passType:  s.metadata?.passType || (productId && OASIS_GUEST_PASS_PRODUCTS[productId]?.passType) || 'SINGLE',
      amount:    s.amount_total,
      priceId:   item?.price?.id ?? null,
      productId,
    })
  }
  return sessions.sort((a, b) => a.created - b.created)
}

async function backfillGym(gym) {
  const timeZone = gym.timezone || DEFAULT_GYM_TIME_ZONE
  const rows = await prisma.guestVisit.findMany({
    where:   { gymId: gym.id },
    select:  { id: true, guestEmail: true, passType: true, createdAt: true, amountPaid: true, stripeSessionId: true, packSize: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!rows.length) return

  const stripe = gym.stripeSecretKey
    ? new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    : new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  const requestOptions = gym.stripeSecretKey ? undefined : { stripeAccount: gym.stripeAccountId }

  const since    = Math.floor(rows[0].createdAt.getTime() / 1000) - AFTER_SEC
  const sessions = await listGuestPassSessions(stripe, gym, since, requestOptions)

  // Product metadata (passes) for pack size — fetched once per product
  const products = new Map()
  for (const id of new Set(sessions.map(s => s.productId).filter(Boolean))) {
    products.set(id, await stripe.products.retrieve(id, undefined, requestOptions).catch(() => ({ id })))
  }

  const linkedSessions = new Set(rows.map(r => r.stripeSessionId).filter(Boolean))
  const used           = new Set(rows.filter(r => r.stripeSessionId).map(r => r.id))
  const matches        = []   // { row, session }
  const stripeOnly     = []

  for (const session of sessions) {
    if (linkedSessions.has(session.id)) continue
    const row = rows.find(r =>
      !used.has(r.id)
      && (r.guestEmail ?? '').toLowerCase() === session.email
      && r.passType === session.passType
      && r.createdAt.getTime() / 1000 >= session.created - BEFORE_SEC
      && r.createdAt.getTime() / 1000 <= session.created + AFTER_SEC,
    )
    if (!row) { stripeOnly.push(session); continue }
    used.add(row.id)
    matches.push({ row, session })
  }

  // Unmatched rows: duplicates of a matched/linked row (same email, type and
  // local day) vs rows with no session at all (Zapier-era, imports)
  const linkedKey = r => `${(r.guestEmail ?? '').toLowerCase()}|${r.passType}|${localDate(r.createdAt, timeZone)}`
  const linkedByKey = new Map()
  for (const r of rows) if (r.stripeSessionId) linkedByKey.set(linkedKey(r), r)
  for (const { row } of matches) linkedByKey.set(linkedKey(row), row)

  const duplicates = []
  const noSession  = []
  for (const r of rows) {
    if (used.has(r.id)) continue
    const original = linkedByKey.get(linkedKey(r))
    if (original) duplicates.push({ row: r, original })
    else noSession.push(r)
  }

  const amountChanges = matches.filter(({ row, session }) => row.amountPaid != null && row.amountPaid !== session.amount)

  console.log(`\n== ${gym.slug} (${gym.id})`)
  console.log(`rows ${rows.length} | already linked ${linkedSessions.size} | guest_pass sessions ${sessions.length}`)
  console.log(`matched ${matches.length} | stripe-only sessions ${stripeOnly.length} | duplicate rows ${duplicates.length} | rows with no session ${noSession.length}`)
  if (amountChanges.length) {
    console.log(`amountPaid differs from the session on ${amountChanges.length} matched row(s):`)
    for (const { row, session } of amountChanges) console.log(`  ${row.id} ${row.amountPaid} → ${session.amount}`)
  }
  if (stripeOnly.length) {
    console.log('stripe-only sessions (no row matched):')
    for (const s of stripeOnly) console.log(`  ${s.id} ${localTime(new Date(s.created * 1000), timeZone)} ${maskEmail(s.email)} ${s.passType} ${s.amount}`)
  }
  if (duplicates.length) {
    console.log('duplicate rows (same email, type and day as a matched row) — not touched:')
    for (const { row, original } of duplicates) {
      console.log(`  ${row.id} ${localTime(row.createdAt, timeZone)} ${maskEmail(row.guestEmail)} ${row.passType} — duplicates ${original.id}`)
    }
  }
  if (noSession.length) {
    console.log('rows with no matching session — not touched:')
    for (const r of noSession) console.log(`  ${r.id} ${localTime(r.createdAt, timeZone)} ${maskEmail(r.guestEmail)} ${r.passType}`)
  }

  if (!APPLY || !matches.length) return
  await prisma.$transaction(matches.map(({ row, session }) => prisma.guestVisit.update({
    where: { id: row.id },
    data:  {
      stripeSessionId: session.id,
      amountPaid:      session.amount,
      stripePriceId:   session.priceId,
      packSize:        row.packSize ?? resolvePackSize(gym.slug, {
        priceId: session.priceId,
        product: products.get(session.productId) ?? session.productId,
      }),
    },
  })))
  console.log(`applied ${matches.length} update(s)`)
}

async function main() {
  const gyms = await prisma.gym.findMany({
    where:  {
      ...(ONLY_GYM ? { slug: ONLY_GYM } : {}),
      OR: [{ stripeSecretKey: { not: null } }, { stripeAccountId: { not: null } }],
    },
    select:  { id: true, slug: true, timezone: true, stripeSecretKey: true, stripeAccountId: true },
    orderBy: { slug: 'asc' },
  })
  console.log(APPLY ? 'APPLY — writing matches' : 'DRY RUN — nothing is written (pass --apply to write)')
  for (const gym of gyms) await backfillGym(gym)
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
