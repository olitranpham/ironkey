/**
 * scripts/import-frozen-canceled.js
 *
 * Reads ./data/triumph-frozen.csv and ./data/triumph-canceled.csv and
 * upserts members into the Ironkey DB under triumph-barbell.
 *
 * Usage:
 *   node scripts/import-frozen-canceled.js
 */

require('dotenv').config()
const fs      = require('fs')
const path    = require('path')
const { parse } = require('csv-parse/sync')
const { Client } = require('pg')

const FROZEN_FILE   = path.resolve('./data/triumph-frozen.csv')
const CANCELED_FILE = path.resolve('./data/triumph-canceled.csv')

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

async function processFile(db, gymId, filePath, status) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠  File not found, skipping: ${filePath}`)
    return { updated: 0, created: 0, skipped: 0 }
  }

  const raw     = fs.readFileSync(filePath, 'utf8')
  const rows    = parse(raw, { columns: true, skip_empty_lines: true, trim: true })
  const isFrozen   = status === 'FROZEN'
  const isCanceled = status === 'CANCELLED'

  console.log(`\n  ${path.basename(filePath)}: ${rows.length} rows`)
  if (rows.length > 0) console.log('  columns:', Object.keys(rows[0]).join(', '))

  let updated = 0
  let created = 0
  let skipped = 0

  for (const row of rows) {
    const email = (row['EMAIL'] ?? '').toLowerCase().trim()
    if (!email) { skipped++; continue }

    const { firstName, lastName } = splitName(row['NAME'])
    const accessCode  = String(row['ACCESS ID']     ?? '').trim() || null
    const phone       = String(row['PHONE NUMBER']  ?? '').trim() || null
    const customerId  = String(row['CUSTOMER ID']   ?? '').trim() || null
    const subId       = String(row['SUBSCRIPTION ID'] ?? '').trim() || null
    const dateFrozen  = isFrozen   ? toDate(row['DATE FROZEN'])    : null
    const dateCanceled = isCanceled ? toDate(row['DATE CANCELLED']) : null
    const maxFreeze   = isFrozen   ? toDate(row['MAX FREEZE'])     : null
    const dateAccessed = toDate(row['DATE ACCESSED'])

    // Try update first
    const updateRes = await db.query(
      `UPDATE "Member"
       SET "status"               = $1,
           "accessCode"           = COALESCE($2, "accessCode"),
           "phone"                = COALESCE($3, "phone"),
           "stripeCustomerId"     = COALESCE($4, "stripeCustomerId"),
           "stripeSubscriptionId" = COALESCE($5, "stripeSubscriptionId"),
           "dateFrozen"           = COALESCE($6, "dateFrozen"),
           "dateCanceled"         = COALESCE($7, "dateCanceled"),
           "maxFreeze"            = COALESCE($8, "maxFreeze"),
           "updatedAt"            = NOW()
       WHERE LOWER(email) = $9 AND "gymId" = $10
       RETURNING id, "firstName", "lastName"`,
      [status, accessCode, phone, customerId, subId,
       dateFrozen, dateCanceled, maxFreeze,
       email, gymId],
    )

    if (updateRes.rowCount > 0) {
      const m = updateRes.rows[0]
      console.log(`  updated  ${m.firstName} ${m.lastName} <${email}>`)
      updated++
      continue
    }

    // Member not found — create them
    const joinedAt = dateAccessed ?? new Date()
    await db.query(
      `INSERT INTO "Member"
         ("id", "gymId", "firstName", "lastName", "email", "phone",
          "status", "membershipType",
          "stripeCustomerId", "stripeSubscriptionId",
          "accessCode", "dateAccessed", "dateFrozen", "dateCanceled", "maxFreeze",
          "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid()::text, $1, $2, $3, $4, $5,
          $6, 'GENERAL',
          $7, $8,
          $9, $10, $11, $12, $13,
          $14, NOW())`,
      [gymId, firstName, lastName, email, phone,
       status,
       customerId, subId,
       accessCode, dateAccessed, dateFrozen, dateCanceled, maxFreeze,
       joinedAt],
    )
    console.log(`  created  ${firstName} ${lastName} <${email}>`)
    created++
  }

  return { updated, created, skipped }
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  console.log('✓ Connected to Ironkey database')

  const gymRes = await db.query(`SELECT id FROM "Gym" WHERE slug = $1`, ['triumph-barbell'])
  if (!gymRes.rows.length) { console.error('Gym triumph-barbell not found'); process.exit(1) }
  const gymId = gymRes.rows[0].id
  console.log(`✓ Found gym id=${gymId}`)

  const frozen   = await processFile(db, gymId, FROZEN_FILE,   'FROZEN')
  const canceled = await processFile(db, gymId, CANCELED_FILE, 'CANCELLED')

  console.log(`
─────────────────────────────────────────
summary
  frozen   : ${frozen.updated} updated, ${frozen.created} created, ${frozen.skipped} skipped
  canceled : ${canceled.updated} updated, ${canceled.created} created, ${canceled.skipped} skipped
─────────────────────────────────────────`)

  await db.end()
}

main().catch(err => { console.error('Failed:', err); process.exit(1) })
