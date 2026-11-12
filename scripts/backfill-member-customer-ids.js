// Fill Member.stripeCustomerId for members that have a subscription but no
// customer id — regular joins never saved session.customer before the
// webhook fix, so these members showed "no payment method on file".
//
//   node scripts/backfill-member-customer-ids.js            # dry run → writes the plan file
//   node scripts/backfill-member-customer-ids.js --apply    # write the planned rows
//
// The customer comes from subscription.customer, read with the gym's own
// Stripe key. A row is planned only if the customer exists, its email matches
// the member's, and no other member at the gym already has that customer id.
// --apply writes exactly the dry run's planned rows, and only while each row
// still has no customer id and the same subscription. Members without a
// subscription (one-off payments, old imports) are never touched.
// The plan file is local working state — don't commit it.

import fs from 'node:fs'
import Stripe from 'stripe'
import prisma from '../lib/prisma.js'

const APPLY = process.argv.includes('--apply')
const PLAN  = new URL('./.backfill-member-customer-ids.plan.json', import.meta.url)

const idOf = v => (typeof v === 'string' ? v : v?.id ?? null)

async function dryRun() {
  const members = await prisma.member.findMany({
    where:   { stripeSubscriptionId: { not: null }, OR: [{ stripeCustomerId: null }, { stripeCustomerId: '' }] },
    select:  { id: true, gymId: true, firstName: true, lastName: true, email: true, status: true, stripeSubscriptionId: true, gym: { select: { slug: true, stripeSecretKey: true } } },
    orderBy: [{ gymId: 'asc' }, { createdAt: 'asc' }],
  })

  const plan = []
  for (const m of members) {
    const row = { gym: m.gym.slug, name: `${m.firstName} ${m.lastName}`, status: m.status, memberId: m.id, subId: m.stripeSubscriptionId, customerId: null }
    try {
      if (!m.gym.stripeSecretKey) throw new Error('gym has no stripe key')
      const stripe   = new Stripe(m.gym.stripeSecretKey, { apiVersion: '2024-06-20' })
      const sub      = await stripe.subscriptions.retrieve(m.stripeSubscriptionId, { expand: ['customer'] })
      const customer = sub.customer
      row.customerId = idOf(customer)
      const custEmail = customer && typeof customer === 'object' && !customer.deleted ? customer.email?.toLowerCase() ?? null : null
      const taken = await prisma.member.findFirst({
        where:  { gymId: m.gymId, stripeCustomerId: row.customerId, id: { not: m.id } },
        select: { firstName: true, lastName: true },
      })
      const problems = [
        customer?.deleted ? 'customer deleted' : null,
        custEmail && custEmail !== m.email.toLowerCase() ? `customer email differs (${custEmail})` : null,
        taken ? `customer already on ${taken.firstName} ${taken.lastName}` : null,
      ].filter(Boolean)
      row.check  = problems.join('; ') || 'ok'
      row.action = problems.length ? 'skip' : 'write'
    } catch (err) {
      row.check  = `error: ${err.code ?? err.message}`
      row.action = 'skip'
    }
    plan.push(row)
  }

  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2))
  for (const r of plan) {
    console.log([r.gym.padEnd(18), r.name.padEnd(26), r.status.padEnd(9), r.subId.padEnd(30), String(r.customerId).padEnd(20), r.action.padEnd(6), r.check].join(' '))
  }
  const count = action => plan.filter(r => r.action === action).length
  console.log(`\nDRY RUN — ${plan.length} members: ${count('write')} to write, ${count('skip')} skipped. Nothing written. Plan: ${PLAN.pathname}`)
}

async function apply() {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8')).filter(r => r.action === 'write')
  let written = 0
  for (const r of plan) {
    const { count } = await prisma.member.updateMany({
      where: { id: r.memberId, stripeSubscriptionId: r.subId, OR: [{ stripeCustomerId: null }, { stripeCustomerId: '' }] },
      data:  { stripeCustomerId: r.customerId },
    })
    written += count
    console.log(count ? 'wrote  ' : 'SKIPPED (changed since dry run)', r.gym, r.name, r.customerId)
  }
  console.log(`\n${written}/${plan.length} written`)
}

try {
  await (APPLY ? apply() : dryRun())
} finally {
  await prisma.$disconnect()
}
