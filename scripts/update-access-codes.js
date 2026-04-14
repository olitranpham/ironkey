/**
 * scripts/update-access-codes.js
 *
 * Reads ./data/triumph-members.xlsx and updates each member's accessCode
 * and phone in the Ironkey DB, matched by email.
 *
 * Usage:
 *   node scripts/update-access-codes.js
 */

require('dotenv').config()
const XLSX     = require('xlsx')
const path     = require('path')
const { Client } = require('pg')

const FILE = path.resolve('./data/triumph-members.xlsx')

async function main() {
  // ── Parse Excel ─────────────────────────────────────────────────────────────
  const workbook  = XLSX.readFile(FILE)
  const sheet     = workbook.Sheets[workbook.SheetNames[0]]
  const rows      = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  console.log(`\n✓ Parsed ${rows.length} rows from triumph-members.xlsx`)
  if (rows.length > 0) {
    console.log('  columns:', Object.keys(rows[0]).join(', '))
  }

  // ── Connect ──────────────────────────────────────────────────────────────────
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  console.log('✓ Connected to Ironkey database\n')

  let updated  = 0
  let notFound = 0
  let skipped  = 0

  for (const row of rows) {
    const email      = String(row['EMAIL']       ?? '').toLowerCase().trim()
    const accessCode = String(row['ACCESS ID']   ?? '').trim()
    const phone      = String(row['PHONE NUMBER'] ?? '').trim() || null

    if (!email) { skipped++; continue }

    const res = await db.query(
      `UPDATE "Member"
       SET "accessCode" = NULLIF($1, ''),
           "phone"      = COALESCE(NULLIF($2, ''), "phone"),
           "updatedAt"  = NOW()
       WHERE LOWER(email) = $3
       RETURNING id, "firstName", "lastName", email, "accessCode"`,
      [accessCode, phone, email],
    )

    if (res.rowCount === 0) {
      console.log(`  NOT FOUND  ${email}`)
      notFound++
    } else {
      const m = res.rows[0]
      console.log(`  updated    ${m.firstName} ${m.lastName} <${m.email}>  code=${m.accessCode}`)
      updated++
    }
  }

  console.log(`
─────────────────────────────────────────
summary
  updated   : ${updated}
  not found : ${notFound}
  skipped   : ${skipped}  (no email)
─────────────────────────────────────────`)

  await db.end()
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
