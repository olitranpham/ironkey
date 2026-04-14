/**
 * scripts/fix-members.js
 * One-time fixes:
 *   1. Set Kyle McLeod's joined date to 2025-09-05
 *   2. Rename hsiegler129@gmail.com from "Unknown" to Heidi Siegler
 */

require('dotenv').config()
const { Client } = require('pg')

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()

  // 1. Kyle McLeod — update createdAt and dateAccessed to 2025-09-05
  const kyle = await db.query(
    `UPDATE "Member"
     SET "createdAt"    = '2025-09-05',
         "dateAccessed" = '2025-09-05',
         "updatedAt"    = NOW()
     WHERE LOWER("firstName") = 'kyle' AND LOWER("lastName") = 'mcleod'
     RETURNING id, "firstName", "lastName", "createdAt"`,
  )
  if (kyle.rowCount === 0) {
    console.warn('⚠  Kyle McLeod not found')
  } else {
    console.log('✓ Kyle McLeod updated:', kyle.rows[0])
  }

  // 2. hsiegler129@gmail.com — fix name
  const heidi = await db.query(
    `UPDATE "Member"
     SET "firstName" = 'Heidi',
         "lastName"  = 'Siegler',
         "updatedAt" = NOW()
     WHERE LOWER(email) = 'hsiegler129@gmail.com'
     RETURNING id, "firstName", "lastName", email`,
  )
  if (heidi.rowCount === 0) {
    console.warn('⚠  hsiegler129@gmail.com not found')
  } else {
    console.log('✓ Heidi Siegler updated:', heidi.rows[0])
  }

  await db.end()
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
