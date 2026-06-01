/**
 * scripts/seam-provision-triumph.js
 *
 * One-time script: for every ACTIVE triumph-barbell member who has an
 * accessCode:
 *   1. Finds and deletes the existing unmanaged code with the same PIN from
 *      Triumph's old Seam account (using TRIUMPH_SEAM_API_KEY) so it no
 *      longer appears as unmanaged on the Ironkey account.
 *   2. Creates a fresh managed code on device bff1c843-b6b9-4788-874d-8386441cff64
 *      under the Ironkey account (using SEAM_API_KEY).
 *
 * After all members are processed, updates triumph-barbell's seamDeviceId in
 * the DB to bff1c843-b6b9-4788-874d-8386441cff64.
 *
 * Usage:
 *   node scripts/seam-provision-triumph.js           # live run
 *   DRY_RUN=1 node scripts/seam-provision-triumph.js # dry run — no Seam calls, no DB writes
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma             = new PrismaClient()
const SEAM_API           = 'https://connect.getseam.com'
const DEVICE_ID          = 'bff1c843-b6b9-4788-874d-8386441cff64'
const TRIUMPH_SEAM_KEY   = 'seam_2WnJuYa8_As7QfTZ3BS6E1tB8f7bxtcuR'
const DRY_RUN            = process.env.DRY_RUN === '1'

// ── Helpers ───────────────────────────────────────────────────────────────────

function headers(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

/**
 * Finds the access_code_id for a given PIN on a given device, checking both
 * the managed and unmanaged lists.
 */
async function findCodeIdByPin(apiKey, deviceId, pin) {
  for (const endpoint of ['access_codes/list', 'access_codes/unmanaged/list']) {
    const res = await fetch(`${SEAM_API}/${endpoint}`, {
      method: 'POST',
      headers: headers(apiKey),
      body:    JSON.stringify({ device_id: deviceId }),
    })
    if (!res.ok) continue
    const body  = await res.json()
    const match = (body.access_codes ?? []).find(
      c => String(c.code).trim() === String(pin).trim()
    )
    if (match) return match.access_code_id
  }
  return null
}

/**
 * Deletes an access code by ID, trying unmanaged/delete with force as needed.
 */
async function deleteCode(apiKey, codeId, label) {
  for (const endpoint of ['access_codes/delete', 'access_codes/unmanaged/delete']) {
    const res = await fetch(`${SEAM_API}/${endpoint}`, {
      method: 'POST',
      headers: headers(apiKey),
      body:    JSON.stringify({ access_code_id: codeId }),
    })
    if (res.ok) return true

    const text    = await res.text()
    const errType = (() => { try { return JSON.parse(text)?.error?.type } catch { return null } })()

    if (endpoint === 'access_codes/unmanaged/delete' && errType === 'managed_by_other_workspace') {
      const forceRes = await fetch(`${SEAM_API}/access_codes/unmanaged/delete`, {
        method: 'POST',
        headers: headers(apiKey),
        body:    JSON.stringify({ access_code_id: codeId, force: true }),
      })
      if (forceRes.ok) return true
      const forceText = await forceRes.text()
      console.error(`      delete force failed: ${forceText}`)
      return false
    }

    // managed endpoint failed — fall through to unmanaged
    if (endpoint === 'access_codes/delete') continue

    console.error(`      delete failed: ${text}`)
    return false
  }
  return false
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const ironkeyApiKey = process.env.SEAM_API_KEY
  if (!ironkeyApiKey) {
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

  // ── Load members ───────────────────────────────────────────────────────────
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
      console.log(`  (dry) would delete old unmanaged code then create managed code for ${label}`)
      skipped++
      continue
    }

    try {
      // ── Step 1: delete existing code from Triumph's old account ─────────────
      // Search on the Ironkey device using the old key so we find any unmanaged
      // code Seam inherited from the Triumph workspace.
      const oldCodeId = await findCodeIdByPin(TRIUMPH_SEAM_KEY, DEVICE_ID, m.accessCode)
      if (oldCodeId) {
        const deleted = await deleteCode(TRIUMPH_SEAM_KEY, oldCodeId, label)
        if (deleted) {
          console.log(`  🗑  ${label} — old code deleted (${oldCodeId})`)
        } else {
          console.warn(`  ⚠  ${label} — could not delete old code ${oldCodeId}, proceeding anyway`)
        }
      } else {
        console.log(`  –  ${label} — no existing code found on old account`)
      }

      // ── Step 2: create managed code on the Ironkey account ──────────────────
      const createRes  = await fetch(`${SEAM_API}/access_codes/create`, {
        method:  'POST',
        headers: headers(ironkeyApiKey),
        body:    JSON.stringify({
          device_id: DEVICE_ID,
          name:      `${m.firstName} ${m.lastName}`,
          code:      m.accessCode,
        }),
      })
      const createBody = await createRes.json()

      if (!createRes.ok) {
        const errType = createBody?.error?.type ?? createBody?.error ?? createRes.status
        if (errType === 'duplicate_access_code') {
          console.log(`  ✓  ${label} — already managed on device`)
          succeeded++
        } else {
          console.error(`  ❌  ${label} — create failed: ${errType}`)
          failed++
        }
      } else {
        const codeId = createBody.access_code?.access_code_id ?? '(no id)'
        console.log(`  ✓  ${label} — managed code created (${codeId})`)
        succeeded++
      }
    } catch (err) {
      console.error(`  ❌  ${label} — unexpected error: ${err.message}`)
      failed++
    }
  }

  console.log(`\nProvisioning done. succeeded=${succeeded}  failed=${failed}${DRY_RUN ? `  skipped(dry)=${skipped}` : ''}`)

  if (failed > 0) {
    console.warn(`\n⚠  ${failed} member(s) failed — review above before updating seamDeviceId.`)
    process.exit(1)
  }

  // ── Update seamDeviceId in DB ──────────────────────────────────────────────
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
