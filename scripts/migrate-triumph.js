/**
 * scripts/migrate-triumph.js
 *
 * One-time migration from the old Triumph DB (OLD_DATABASE_URL) into the
 * Ironkey DB (DATABASE_URL).
 *
 * Usage:
 *   OLD_DATABASE_URL="postgres://..." node scripts/migrate-triumph.js
 *
 * What it does:
 *   1. Connects to both databases via pg (raw SQL — old DB has a different schema)
 *   2. Finds the "triumph-barbell" gym in Ironkey to get its gymId
 *   3. Migrates members, skipping any already present (matched by gymId + email)
 *   4. Migrates guest_passes, skipping duplicates (matched by gymId + guestEmail + expiresAt)
 *   5. Prints a summary
 */

require('dotenv').config()
const { Client } = require('pg')

// ── Date helper ───────────────────────────────────────────────────────────────
// Old DB stores dates as Unix timestamps in milliseconds (bigint).
// pg returns bigint columns as strings, so new Date("1791674367956") → Invalid Date.
// This helper handles: null, already-a-Date, numeric strings (ms timestamps),
// and regular ISO strings.
function toDate(val) {
  if (val == null) return null
  if (val instanceof Date) return val
  const n = Number(val)
  if (!isNaN(n)) return new Date(n)   // numeric string → ms timestamp
  const d = new Date(val)             // ISO string fallback
  return isNaN(d.getTime()) ? null : d
}

// ── Field mapping: old members → new Member ───────────────────────────────────

function mapMember(gymId, row) {
  // Infer first/last name from a single "name" column
  const parts     = (row.name ?? '').trim().split(/\s+/)
  const firstName = parts[0] ?? 'Unknown'
  const lastName  = parts.slice(1).join(' ') || ''

  // Normalise status to enum values
  const STATUS_MAP = {
    active:    'ACTIVE',
    frozen:    'FROZEN',
    cancelled: 'CANCELLED',
    canceled:  'CANCELLED',
    overdue:   'OVERDUE',
  }
  const status = STATUS_MAP[(row.status ?? '').toLowerCase()] ?? 'ACTIVE'

  return {
    gymId,
    firstName,
    lastName,
    email:                (row.email ?? '').toLowerCase().trim(),
    phone:                row.phone       ?? null,
    status,
    stripeCustomerId:     row.customer_id ?? null,
    stripeSubscriptionId: row.sub_id      ?? null,
    accessCode:           row.access_id   ?? null,
    // Legacy date fields — old DB stores these as ms-epoch bigints
    dateAccessed: toDate(row.date_accessed),
    dateFrozen:   toDate(row.date_frozen),
    dateCanceled: toDate(row.date_canceled),
    maxFreeze:    toDate(row.max_freeze),
  }
}

// ── Field mapping: old guest_passes → new GuestPass ───────────────────────────

const PASS_TYPE_MAP = {
  'single':  'SINGLE',
  '3-pack':  'THREE_PACK',
  '5-pack':  'FIVE_PACK',
  '10-pack': 'TEN_PACK',
}

function mapGuestPass(gymId, row) {
  const passType = PASS_TYPE_MAP[(row.pass_type ?? '').toLowerCase().trim()] ?? 'SINGLE'

  return {
    gymId,
    guestName:  (row.name  ?? 'Guest').trim(),
    guestEmail: (row.email ?? null),
    guestPhone: (row.phone ?? null),
    passType,
    passesLeft: row.passes_left ?? null,
    usedAt:    toDate(row.date_accessed),
    expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
    createdAt: toDate(row.created_at) ?? new Date(),
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const oldUrl = process.env.OLD_DATABASE_URL
  const newUrl = process.env.DATABASE_URL

  if (!oldUrl) {
    console.error('OLD_DATABASE_URL is not set')
    process.exit(1)
  }
  if (!newUrl) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const oldDb = new Client({ connectionString: oldUrl })
  const newDb = new Client({ connectionString: newUrl })

  await oldDb.connect()
  console.log('✓ Connected to old Triumph database')

  await newDb.connect()
  console.log('✓ Connected to Ironkey database')

  // ── Find the Triumph Barbell gym in Ironkey ─────────────────────────────

  const gymRes = await newDb.query(
    `SELECT id FROM "Gym" WHERE slug = $1 LIMIT 1`,
    ['triumph-barbell'],
  )

  if (gymRes.rows.length === 0) {
    console.error('Gym "triumph-barbell" not found in Ironkey DB. Run the seed first.')
    process.exit(1)
  }

  const gymId = gymRes.rows[0].id
  console.log(`✓ Found gym  id=${gymId}\n`)

  // ── Migrate members ─────────────────────────────────────────────────────

  let membersCreated = 0
  let membersSkipped = 0

  const { rows: oldMembers } = await oldDb.query('SELECT * FROM members ORDER BY id')
  console.log(`  old members found: ${oldMembers.length}`)

  // ── Print 3 sample rows so we can verify raw date values ─────────────────
  console.log('\n  sample raw rows (first 3):')
  for (const row of oldMembers.slice(0, 3)) {
    console.log({
      name:          row.name,
      date_accessed: row.date_accessed,
      date_frozen:   row.date_frozen,
      date_canceled: row.date_canceled,
      max_freeze:    row.max_freeze,
      // Show what toDate() resolves each to
      _dateAccessed_parsed: String(toDate(row.date_accessed)),
      _dateFrozen_parsed:   String(toDate(row.date_frozen)),
    })
  }
  console.log()

  for (const row of oldMembers) {
    const m = mapMember(gymId, row)

    if (!m.email) { membersSkipped++; continue }

    // Check for existing member by gymId + email
    const exists = await newDb.query(
      `SELECT id FROM "Member" WHERE "gymId" = $1 AND email = $2 LIMIT 1`,
      [gymId, m.email],
    )

    if (exists.rows.length > 0) { membersSkipped++; continue }

    // Use dateAccessed as the canonical join date (createdAt).
    // Fall back to NOW() only if the old row had no date_accessed.
    const joinedAt = m.dateAccessed ?? new Date()

    await newDb.query(
      `INSERT INTO "Member"
         ("id", "gymId", "firstName", "lastName", "email", "phone",
          "status", "stripeCustomerId", "stripeSubscriptionId",
          "accessCode",
          "dateAccessed", "dateFrozen", "dateCanceled", "maxFreeze",
          "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid()::text, $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9,
          $10, $11, $12, $13,
          $14, $14)`,
      [
        m.gymId, m.firstName, m.lastName, m.email, m.phone,
        m.status, m.stripeCustomerId, m.stripeSubscriptionId,
        m.accessCode,
        m.dateAccessed, m.dateFrozen, m.dateCanceled, m.maxFreeze,
        joinedAt,
      ],
    )

    membersCreated++
  }

  console.log(`  members migrated : ${membersCreated}`)
  console.log(`  members skipped  : ${membersSkipped}`)

  // ── Migrate guest passes ────────────────────────────────────────────────

  let passesCreated = 0
  let passesSkipped = 0

  // guest_passes may not exist in the old DB — handle gracefully
  let oldPasses = []
  try {
    const res = await oldDb.query('SELECT * FROM guest_passes ORDER BY id')
    oldPasses = res.rows
  } catch {
    console.log('\n  guest_passes table not found in old DB — skipping')
  }

  console.log(`\n  old guest passes found: ${oldPasses.length}`)

  for (const row of oldPasses) {
    const p = mapGuestPass(gymId, row)

    // No dedup — caller is expected to delete all passes before re-running.
    // Every source row is a distinct check-in event and must be preserved.
    // (Previous email+usedAt dedup was incorrectly dropping legitimate rows
    //  where two people share an email, or the same person checks in twice
    //  on the same day.)

    try {
      await newDb.query(
        `INSERT INTO "GuestPass"
           ("id", "gymId", "guestName", "guestEmail", "guestPhone",
            "passType", "passesLeft",
            "usedAt", "expiresAt", "createdAt")
         VALUES
           (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          p.gymId, p.guestName, p.guestEmail, p.guestPhone,
          p.passType, p.passesLeft,
          p.usedAt, p.expiresAt, p.createdAt,
        ],
      )
      passesCreated++
    } catch (err) {
      passesSkipped++
      console.warn(`  SKIPPED row id=${row.id} name="${row.name}" email="${row.email}" — ${err.message}`)
    }
  }

  console.log(`  guest passes migrated : ${passesCreated}`)
  if (passesSkipped > 0) {
    console.log(`  guest passes skipped  : ${passesSkipped}  ← see SKIPPED lines above`)
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`
─────────────────────────────────────────
migration complete
  members      : ${membersCreated} migrated, ${membersSkipped} skipped
  guest passes : ${passesCreated} migrated, ${passesSkipped} skipped
─────────────────────────────────────────`)

  await oldDb.end()
  await newDb.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
