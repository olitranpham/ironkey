/**
 * scripts/backfill-membership-type.js
 *
 * One-time script: for every member that has a stripeSubscriptionId, fetches
 * the Stripe subscription using the gym's stripeSecretKey, reads
 * sub.items.data[0].price.nickname, lowercases it, and writes it back to
 * membershipType in the DB.
 *
 * Members with no nickname on the price are skipped (logged as warnings).
 * Dry-run mode prints what would change without writing anything.
 *
 * Usage:
 *   node scripts/backfill-membership-type.js           # live run
 *   DRY_RUN=1 node scripts/backfill-membership-type.js # dry run
 */

require('dotenv').config()
const { Client } = require('pg')
const Stripe     = require('stripe')

const DRY_RUN = process.env.DRY_RUN === '1'

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()

  // ── Load all members that have a subscription ID ──────────────────────────
  const { rows: members } = await db.query(`
    SELECT m.id, m.email, m."firstName", m."lastName",
           m."membershipType", m."stripeSubscriptionId",
           g."stripeSecretKey", g.slug AS "gymSlug"
    FROM   "Member" m
    JOIN   "Gym"    g ON g.id = m."gymId"
    WHERE  m."stripeSubscriptionId" IS NOT NULL
      AND  g."stripeSecretKey"      IS NOT NULL
    ORDER  BY g.slug, m.email
  `)

  console.log(`Found ${members.length} members with a subscription ID.`)
  if (DRY_RUN) console.log('DRY RUN — no changes will be written.\n')

  // Cache Stripe clients per gym slug to avoid re-instantiating on every row
  const stripeClients = {}

  let updated = 0
  let skipped = 0
  let errored = 0

  for (const member of members) {
    const { id, email, firstName, lastName, membershipType, stripeSubscriptionId, stripeSecretKey, gymSlug } = member

    if (!stripeClients[gymSlug]) {
      stripeClients[gymSlug] = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' })
    }
    const stripe = stripeClients[gymSlug]

    let sub
    try {
      sub = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ['items.data.price.product'],
      })
    } catch (err) {
      console.warn(`  ⚠  [${gymSlug}] ${email} — failed to fetch sub ${stripeSubscriptionId}: ${err.message}`)
      errored++
      continue
    }

    const price       = sub.items?.data?.[0]?.price ?? null
    const rawType     = price?.nickname || price?.product?.name || null
    if (!rawType) {
      console.warn(`  ⚠  [${gymSlug}] ${email} — no nickname or product name on sub ${stripeSubscriptionId}, skipping`)
      skipped++
      continue
    }

    const newType = rawType.toLowerCase()

    if (newType === membershipType) {
      console.log(`  =  [${gymSlug}] ${firstName} ${lastName} <${email}> — already "${newType}", no change`)
      continue
    }

    console.log(`  ✓  [${gymSlug}] ${firstName} ${lastName} <${email}> — "${membershipType}" → "${newType}"`)

    if (!DRY_RUN) {
      await db.query(
        `UPDATE "Member" SET "membershipType" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [newType, id],
      )
    }

    updated++
  }

  await db.end()

  console.log(`\nDone. updated=${updated}  skipped=${skipped}  errored=${errored}${DRY_RUN ? ' (dry run)' : ''}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
