/**
 * scripts/import-active.js
 *
 * Wipes all ACTIVE members for triumph-barbell and re-imports from
 * ./data/triumph-active.csv
 *
 * Usage:
 *   node scripts/import-active.js
 */

require('dotenv').config()
const fs      = require('fs')
const path    = require('path')
const { parse } = require('csv-parse/sync')
const { Client } = require('pg')

const FILE = path.resolve('./data/triumph-active.csv')

const MEMBERSHIP_TYPE_MAP = {
  founding: 'FOUNDING',
  general:  'GENERAL',
  student:  'STUDENT',
}

function toDate(val) {
  if (!val || String(val).trim() === '') return null
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d
}

function splitName(full) {
  const parts     = (full ?? '').trim().split(/\s+/)
  const firstName = parts[0] || 'Unknown'
  const lastName  = parts.slice(1).join(' ') || ''
  return { firstName, lastName }
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`File not found: ${FILE}`)
    process.exit(1)
  }

  const raw  = fs.readFileSync(FILE, 'utf8')
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true })

  console.log(`\n✓ Parsed ${rows.length} rows from triumph-active.csv`)
  if (rows.length > 0) console.log('  columns:', Object.keys(rows[0]).join(', '))

  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  console.log('✓ Connected to Ironkey database')

  const gymRes = await db.query(`SELECT id FROM "Gym" WHERE slug = $1`, ['triumph-barbell'])
  if (!gymRes.rows.length) { console.error('Gym triumph-barbell not found'); process.exit(1) }
  const gymId = gymRes.rows[0].id
  console.log(`✓ Found gym id=${gymId}\n`)

  // Wipe existing ACTIVE members only
  const del = await db.query(`DELETE FROM "Member" WHERE "gymId" = $1 AND status = 'ACTIVE'`, [gymId])
  console.log(`  wiped ${del.rowCount} active members\n`)

  let created = 0
  let skipped = 0

  for (const row of rows) {
    const email = (row['EMAIL'] ?? '').toLowerCase().trim()
    if (!email) {
      console.warn(`  SKIP  no email — name="${row['NAME']}"`)
      skipped++
      continue
    }

    const { firstName, lastName } = splitName(row['NAME'])
    const phone          = String(row['PHONE NUMBER']    ?? '').trim() || null
    const accessCode     = String(row['ACCESS ID']       ?? '').trim() || null
    const customerId     = String(row['CUSTOMER ID']     ?? '').trim() || null
    const subId          = String(row['SUBSCRIPTION ID'] ?? '').trim() || null
    const rawType        = (row['MEMBERSHIP TYPE'] ?? '').toLowerCase().trim()
    const membershipType = MEMBERSHIP_TYPE_MAP[rawType] ?? 'GENERAL'
    const dateAccessed   = toDate(row['DATE ACCESSED'])
    const createdAt      = dateAccessed ?? new Date()

    if (!MEMBERSHIP_TYPE_MAP[rawType]) {
      console.warn(`  WARN  unknown membership type "${row['MEMBERSHIP TYPE']}" for ${email} — defaulting to GENERAL`)
    }

    try {
      await db.query(
        `INSERT INTO "Member"
           ("id", "gymId", "firstName", "lastName", "email", "phone",
            "status", "membershipType",
            "stripeCustomerId", "stripeSubscriptionId",
            "accessCode", "dateAccessed",
            "createdAt", "updatedAt")
         VALUES
           (gen_random_uuid()::text, $1, $2, $3, $4, $5,
            'ACTIVE', $6,
            $7, $8,
            $9, $10,
            $11, NOW())`,
        [gymId, firstName, lastName, email, phone,
         membershipType,
         customerId, subId,
         accessCode, dateAccessed,
         createdAt],
      )
      console.log(`  created  ${firstName} ${lastName} <${email}>  ${membershipType}  code=${accessCode}`)
      created++
    } catch (err) {
      console.warn(`  SKIP  ${email} — ${err.message}`)
      skipped++
    }
  }

  console.log(`
─────────────────────────────────────────
summary
  wiped   : ${del.rowCount} active members
  created : ${created}
  skipped : ${skipped}
─────────────────────────────────────────`)

  await db.end()
}

main().catch(err => { console.error('Failed:', err); process.exit(1) })
