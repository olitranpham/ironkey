/**
 * scripts/import-stripe-csv.js
 *
 * Imports Stripe subscription CSV export into the Ironkey DB
 * under the triumph-barbell gym. Wipes existing members first.
 *
 * Usage:
 *   node scripts/import-stripe-csv.js ./data/subscriptions.csv
 */

require('dotenv').config()
const fs      = require('fs')
const path    = require('path')
const { parse } = require('csv-parse/sync')
const { Client } = require('pg')

// ── Price ID → membership type ────────────────────────────────────────────────

const PRICE_MAP = {
  price_1SCg4HIubCn5bIn0ewtCZa5C: 'FOUNDING',
  price_1TBioEIubCn5bIn0EbDWZdrV: 'GENERAL',
  price_1T4h1XIubCn5bIn07fMKo6zi: 'STUDENT',
}

// ── Status map ────────────────────────────────────────────────────────────────

const STATUS_MAP = {
  active:           'ACTIVE',
  canceled:         'CANCELLED',
  cancelled:        'CANCELLED',
  past_due:         'OVERDUE',
  unpaid:           'OVERDUE',
  trialing:         'ACTIVE',
  incomplete:       'ACTIVE',
  incomplete_expired: 'CANCELLED',
  paused:           'FROZEN',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitName(fullName) {
  const parts     = (fullName ?? '').trim().split(/\s+/)
  const firstName = parts[0] || 'Unknown'
  const lastName  = parts.slice(1).join(' ') || ''
  return { firstName, lastName }
}

function toDate(val) {
  if (!val || val.trim() === '') return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: node scripts/import-stripe-csv.js <path-to-csv>')
    process.exit(1)
  }

  const resolved = path.resolve(csvPath)
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`)
    process.exit(1)
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  // ── Parse CSV ──────────────────────────────────────────────────────────────

  const raw     = fs.readFileSync(resolved, 'utf8')
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
  console.log(`\n✓ Parsed ${records.length} rows from ${path.basename(resolved)}`)

  if (records.length > 0) {
    console.log('  columns:', Object.keys(records[0]).join(', '))
  }

  // ── Connect to DB ──────────────────────────────────────────────────────────

  const db = new Client({ connectionString: dbUrl })
  await db.connect()
  console.log('✓ Connected to Ironkey database')

  // ── Find triumph-barbell gym ───────────────────────────────────────────────

  const gymRes = await db.query(
    `SELECT id FROM "Gym" WHERE slug = $1 LIMIT 1`,
    ['triumph-barbell'],
  )
  if (gymRes.rows.length === 0) {
    console.error('Gym "triumph-barbell" not found in DB.')
    process.exit(1)
  }
  const gymId = gymRes.rows[0].id
  console.log(`✓ Found gym  id=${gymId}`)

  // ── Wipe existing members ─────────────────────────────────────────────────

  console.log('\n  wiping existing members…')
  await db.query(`DELETE FROM "GuestPass" WHERE "gymId" = $1`, [gymId])
  await db.query(`DELETE FROM "Member"    WHERE "gymId" = $1`, [gymId])
  console.log('  ✓ wiped\n')

  // ── Import ────────────────────────────────────────────────────────────────

  let created  = 0
  let skipped  = 0
  let warnings = 0

  for (const row of records) {
    const email = (row['Customer Email'] ?? '').toLowerCase().trim()
    if (!email) {
      console.warn(`  SKIP  no email — id=${row['id']}`)
      skipped++
      continue
    }

    const { firstName, lastName } = splitName(row['Customer Name'])

    const rawStatus    = (row['Status'] ?? '').toLowerCase().trim()
    const status       = STATUS_MAP[rawStatus] ?? 'ACTIVE'
    if (!STATUS_MAP[rawStatus]) {
      console.warn(`  WARN  unknown status "${row['Status']}" for ${email} — defaulting to ACTIVE`)
      warnings++
    }

    const priceId      = (row['Plan price ID'] ?? '').trim()
    const membershipType = PRICE_MAP[priceId] ?? 'GENERAL'
    if (!PRICE_MAP[priceId]) {
      console.warn(`  WARN  unknown price ID "${priceId}" for ${email} — defaulting to GENERAL`)
      warnings++
    }

    const dateAccessed = toDate(row['Start Date (UTC)'])
    const dateCanceled = status === 'CANCELLED' ? (toDate(row['Canceled At (UTC)']) ?? toDate(row['Ended At (UTC)'])) : null
    const createdAt    = dateAccessed ?? new Date()

    const customerId = (row['Customer ID'] ?? '').trim() || null
    const subId      = (row['id'] ?? '').trim() || null

    try {
      await db.query(
        `INSERT INTO "Member"
           ("id", "gymId", "firstName", "lastName", "email",
            "status", "membershipType",
            "stripeCustomerId", "stripeSubscriptionId",
            "dateAccessed", "dateCanceled",
            "createdAt", "updatedAt")
         VALUES
           (gen_random_uuid()::text, $1, $2, $3, $4,
            $5, $6,
            $7, $8,
            $9, $10,
            $11, $11)
         ON CONFLICT ("gymId", "email") DO UPDATE SET
           "stripeCustomerId"     = EXCLUDED."stripeCustomerId",
           "stripeSubscriptionId" = EXCLUDED."stripeSubscriptionId",
           "status"               = EXCLUDED."status",
           "membershipType"       = EXCLUDED."membershipType",
           "dateAccessed"         = EXCLUDED."dateAccessed",
           "dateCanceled"         = EXCLUDED."dateCanceled",
           "updatedAt"            = EXCLUDED."updatedAt"`,
        [
          gymId, firstName, lastName, email,
          status, membershipType,
          customerId, subId,
          dateAccessed, dateCanceled,
          createdAt,
        ],
      )
      created++
    } catch (err) {
      console.warn(`  SKIP  ${email} — ${err.message}`)
      skipped++
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  // Count by status in DB for final report
  const countRes = await db.query(
    `SELECT status, COUNT(*) AS n FROM "Member" WHERE "gymId" = $1 GROUP BY status`,
    [gymId],
  )
  const counts = {}
  for (const r of countRes.rows) counts[r.status] = Number(r.n)

  console.log(`
─────────────────────────────────────────
import complete
  rows in CSV  : ${records.length}
  created/upserted : ${created}
  skipped      : ${skipped}
  warnings     : ${warnings}

  DB counts for triumph-barbell:
    ACTIVE    : ${counts.ACTIVE    ?? 0}
    FROZEN    : ${counts.FROZEN    ?? 0}
    OVERDUE   : ${counts.OVERDUE   ?? 0}
    CANCELLED : ${counts.CANCELLED ?? 0}
    total     : ${Object.values(counts).reduce((s, n) => s + n, 0)}
─────────────────────────────────────────`)

  await db.end()
}

main().catch(err => {
  console.error('Import failed:', err)
  process.exit(1)
})
