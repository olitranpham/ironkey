/**
 * scripts/seam-provision-triumph.js
 *
 * One-time script: for every ACTIVE triumph-barbell member who has an
 * accessCode, creates a permanent Seam access code on device
 * bff1c843-b6b9-4788-874d-8386441cff64 using the gym's seamApiKey.
 *
 * After all codes are provisioned, updates triumph-barbell's seamDeviceId
 * in the DB to the same device ID.
 *
 * Usage:
 *   node scripts/seam-provision-triumph.js           # live run
 *   DRY_RUN=1 node scripts/seam-provision-triumph.js # dry run — no Seam calls, no DB writes
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma   = new PrismaClient()
const SEAM_API = 'https://connect.getseam.com'
const DEVICE_ID = 'bff1c843-b6b9-4788-874d-8386441cff64'
const DRY_RUN   = process.env.DRY_RUN === '1'

async function main() {
  // ── Load gym ──────────────────────────────────────────────────────────────
  const seamApiKey = process.env.SEAM_API_KEY
  if (!seamApiKey) {
    console.error('❌  SEAM_API_KEY env var is not set')
    process.exit(1)
  }

  const gym = await prisma.gym.findUnique({
    where:  { slug: 'triumph-barbell' },
    select: { id: true, name: true },
  })

  if (!gym) {
    console.error('❌  triumph-barbell not found in DB')
    process.exit(1)
  }

  console.log(`Gym: ${gym.name} (${gym.id})`)
  if (DRY_RUN) console.log('DRY RUN — no Seam calls or DB writes will be made.\n')

  const headers = {
    Authorization:  `Bearer ${seamApiKey}`,
    'Content-Type': 'application/json',
  }

  // ── Load members ──────────────────────────────────────────────────────────
  const members = await prisma.member.findMany({
    where: {
      gymId:      gym.id,
      status:     'ACTIVE',
      accessCode: { not: null },
    },
    select: { id: true, firstName: true, lastName: true, email: true, accessCode: true },
    orderBy: { lastName: 'asc' },
  })

  console.log(`Found ${members.length} ACTIVE members with an access code.\n`)

  let succeeded = 0
  let failed    = 0
  let skipped   = 0

  for (const m of members) {
    const label = `${m.firstName} ${m.lastName} <${m.email}> [${m.accessCode}]`

    if (DRY_RUN) {
      console.log(`  (dry) would create code ${m.accessCode} for ${label}`)
      skipped++
      continue
    }

    try {
      const res  = await fetch(`${SEAM_API}/access_codes/create`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          device_id: DEVICE_ID,
          name:      `${m.firstName} ${m.lastName}`,
          code:      m.accessCode,
        }),
      })
      const body = await res.json()

      if (!res.ok) {
        const errType = body?.error?.type ?? body?.error ?? res.status
        if (errType === 'duplicate_access_code') {
          console.log(`  ✓  ${label} — already exists on device (duplicate_access_code)`)
          succeeded++
        } else {
          console.error(`  ❌  ${label} — Seam error: ${errType}`)
          failed++
        }
      } else {
        const codeId = body.access_code?.access_code_id ?? '(no id returned)'
        console.log(`  ✓  ${label} — access_code_id=${codeId}`)
        succeeded++
      }
    } catch (err) {
      console.error(`  ❌  ${label} — unexpected error: ${err.message}`)
      failed++
    }
  }

  console.log(`\nSeam provisioning done. succeeded=${succeeded}  failed=${failed}${DRY_RUN ? `  skipped(dry)=${skipped}` : ''}`)

  if (failed > 0) {
    console.warn(`\n⚠  ${failed} member(s) failed — review above before updating seamDeviceId.`)
    process.exit(1)
  }

  // ── Update seamDeviceId in DB ─────────────────────────────────────────────
  if (!DRY_RUN) {
    await prisma.gym.update({
      where: { slug: 'triumph-barbell' },
      data:  { seamDeviceId: DEVICE_ID },
    })
    console.log(`\n✅  triumph-barbell.seamDeviceId updated to ${DEVICE_ID}`)
  } else {
    console.log(`\n(dry) would set triumph-barbell.seamDeviceId to ${DEVICE_ID}`)
  }
}

main()
  .catch(err => { console.error('❌  Fatal:', err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
