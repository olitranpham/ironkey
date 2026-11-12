// Set GuestVisit.stripeSessionId on the paid guest passes from Oct 17 – Nov 6
// that were saved without it (webhook versions before session ids were
// stored, and the Nov 2 / Nov 6 redeploys of an older commit). Only
// stripeSessionId is written — nothing else on the pass changes.
//
//   node scripts/backfill-guest-pass-session-ids.js            # dry run → writes the plan file
//   node scripts/backfill-guest-pass-session-ids.js --apply    # write the planned rows
//
// Match: a completed, paid guest_pass Checkout session not linked to any
// pass, same buyer email, created from 3 h before to 10 min after the pass,
// same pass type and — when the pass has one — the same amount. Refunded
// sessions are never used. Passes are taken oldest first and each gets the
// earliest remaining candidate, so back-to-back purchases pair in order.
// --apply writes exactly the dry run's planned rows, only while the pass
// still has no session id. The plan file is local working state — don't commit it.

import fs from 'node:fs'
import Stripe from 'stripe'
import prisma from '../lib/prisma.js'

const APPLY  = process.argv.includes('--apply')
const PLAN   = new URL('./.backfill-guest-pass-session-ids.plan.json', import.meta.url)
const FROM   = new Date('2026-10-17T00:00:00Z')
const TO     = new Date('2026-11-07T00:00:00Z')
const BEFORE = 3 * 60 * 60   // session may precede the pass by up to 3 h
const AFTER  = 10 * 60       // …or follow it by up to 10 min

const maskEmail = e => (e ? `${e.slice(0, 3)}…@${e.split('@')[1] ?? ''}` : '(no email)')
const at = d => d.toISOString().slice(0, 16).replace('T', ' ')

async function dryRun() {
  const passes = await prisma.guestVisit.findMany({
    where:   { createdAt: { gte: FROM, lt: TO }, stripeSessionId: null },
    select:  { id: true, gymId: true, createdAt: true, guestEmail: true, passType: true, amountPaid: true },
    orderBy: { createdAt: 'asc' },
  })
  const gyms = await prisma.gym.findMany({ where: { id: { in: [...new Set(passes.map(p => p.gymId))] } }, select: { id: true, slug: true, stripeSecretKey: true } })

  const plan = []
  const unusedSessions = []
  for (const gym of gyms) {
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const sessions = []
    for await (const s of stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: Math.floor(FROM / 1000) - BEFORE, lt: Math.floor(TO / 1000) + AFTER },
      expand: ['data.payment_intent.latest_charge'],
    })) {
      if (s.status !== 'complete' || s.payment_status !== 'paid' || s.metadata?.source !== 'guest_pass') continue
      const linked = await prisma.guestVisit.findUnique({ where: { stripeSessionId: s.id }, select: { id: true } })
      if (linked) continue
      const charge = s.payment_intent?.latest_charge
      sessions.push({
        id:       s.id,
        created:  s.created,
        email:    (s.customer_details?.email ?? s.customer_email ?? '').toLowerCase(),
        passType: (s.metadata?.passType ?? '').toUpperCase(),
        amount:   s.amount_total,
        refunded: Boolean(charge && (charge.refunded || charge.amount_refunded > 0)),
      })
    }
    sessions.sort((a, b) => a.created - b.created)
    const used = new Set()

    for (const pass of passes.filter(p => p.gymId === gym.id)) {
      const t = Math.floor(pass.createdAt / 1000)
      const fits = s => s.email === (pass.guestEmail ?? '').toLowerCase()
        && s.created >= t - BEFORE && s.created <= t + AFTER
        && (!s.passType || s.passType === pass.passType)
        && (pass.amountPaid == null || s.amount === pass.amountPaid)
      const candidates = sessions.filter(s => fits(s) && !used.has(s.id))
      const usable     = candidates.filter(s => !s.refunded)
      const chosen     = usable[0] ?? null
      if (chosen) used.add(chosen.id)
      plan.push({
        gym: gym.slug, passId: pass.id, passCreated: pass.createdAt.toISOString(), email: maskEmail(pass.guestEmail),
        passType: pass.passType, amountPaid: pass.amountPaid,
        sessionId: chosen?.id ?? null, sessionCreated: chosen ? new Date(chosen.created * 1000).toISOString() : null,
        sessionAmount: chosen?.amount ?? null,
        minutesBefore: chosen ? Math.round((t - chosen.created) / 60) : null,
        candidates: candidates.length, refundedSkipped: candidates.length - usable.length,
        action: chosen ? 'write' : 'skip',
        note: !chosen ? 'no matching session' : usable.length > 1 ? `${usable.length} candidates — earliest taken` : '',
      })
    }
    for (const s of sessions) if (!used.has(s.id)) unusedSessions.push({ gym: gym.slug, ...s, created: new Date(s.created * 1000).toISOString() })
  }

  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2))
  for (const r of plan) {
    console.log([
      r.gym.padEnd(18), at(new Date(r.passCreated)), r.email.padEnd(20), r.passType.padEnd(7),
      String(r.amountPaid ?? '—').padStart(5), '→', (r.sessionId ? r.sessionId.slice(0, 18) + '…' : '—').padEnd(22),
      r.sessionId ? `${r.minutesBefore}m before, ${r.sessionAmount}` : '', r.action, r.note, r.refundedSkipped ? `(${r.refundedSkipped} refunded skipped)` : '',
    ].join(' '))
  }
  const byGym = plan.reduce((acc, r) => { acc[r.gym] = acc[r.gym] ?? { write: 0, skip: 0 }; acc[r.gym][r.action]++; return acc }, {})
  console.log('\nper gym:', JSON.stringify(byGym))
  console.log('paid guest_pass sessions in the window left unlinked:', unusedSessions.length)
  for (const s of unusedSessions) console.log(`  ${s.gym} ${s.id} ${at(new Date(s.created))} ${maskEmail(s.email)} ${s.passType} ${s.amount}${s.refunded ? ' REFUNDED' : ''}`)
  console.log(`\nDRY RUN — ${plan.length} passes: ${plan.filter(r => r.action === 'write').length} to write, ${plan.filter(r => r.action === 'skip').length} skipped. Nothing written. Plan: ${PLAN.pathname}`)
}

async function apply() {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8')).filter(r => r.action === 'write')
  let written = 0
  for (const r of plan) {
    const { count } = await prisma.guestVisit.updateMany({ where: { id: r.passId, stripeSessionId: null }, data: { stripeSessionId: r.sessionId } })
    written += count
    console.log(count ? 'wrote  ' : 'SKIPPED (changed since dry run)', r.gym, r.passId, r.sessionId)
  }
  console.log(`\n${written}/${plan.length} written`)
}

try {
  await (APPLY ? apply() : dryRun())
} finally {
  await prisma.$disconnect()
}
