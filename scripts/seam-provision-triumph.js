/**
 * scripts/seam-provision-triumph.js
 *
 * Full re-provision of Triumph Barbell access codes from the old Seam device
 * to the new Ironkey-managed device.
 *
 * Default mode — per ACTIVE member with an accessCode:
 *   1. Find and delete the PIN from the OLD device (56cbabfd) using TRIUMPH_SEAM_KEY.
 *   2. Check if the PIN already exists as a managed code on the NEW device (bff1c843)
 *      using SEAM_API_KEY — skip create if so.
 *   3. Create a fresh managed code on the NEW device using SEAM_API_KEY.
 *   On full success, updates triumph-barbell.seamDeviceId + seamApiKey in the DB.
 *
 * --restore mode — for members whose old code was deleted but whose new code was
 *   never successfully created: re-creates the code on the OLD device (56cbabfd)
 *   using TRIUMPH_SEAM_KEY so access is restored while the issue is investigated.
 *   Specifically: members with an accessCode in the DB that is absent from BOTH
 *   the old AND new device are restored to the old device.
 *
 * Usage:
 *   node scripts/seam-provision-triumph.js             # provision
 *   node scripts/seam-provision-triumph.js --restore   # restore to old device
 *   DRY_RUN=1 node scripts/seam-provision-triumph.js   # dry run either mode
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma           = new PrismaClient()
const SEAM_API         = 'https://connect.getseam.com'
const OLD_DEVICE_ID    = '56cbabfd-d469-4ca7-ac67-574b991ed1e0'
const NEW_DEVICE_ID    = 'bff1c843-b6b9-4788-874d-8386441cff64'
const TRIUMPH_SEAM_KEY = process.env.TRIUMPH_SEAM_KEY
const DRY_RUN          = process.env.DRY_RUN === '1'
const RESTORE          = process.argv.includes('--restore')

// ── Helpers ───────────────────────────────────────────────────────────────────

function hdrs(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

/** Returns the access_code_id for a PIN on a device, or null if not found. */
async function findManagedCodeId(apiKey, deviceId, pin) {
  const res = await fetch(`${SEAM_API}/access_codes/list`, {
    method:  'POST',
    headers: hdrs(apiKey),
    body:    JSON.stringify({ device_id: deviceId }),
  })
  if (!res.ok) return null
  const { access_codes = [] } = await res.json()
  return access_codes.find(c => String(c.code).trim() === String(pin).trim())?.access_code_id ?? null
}

/** Deletes a code by ID. Returns true on success. */
async function deleteCodeById(apiKey, codeId) {
  const res = await fetch(`${SEAM_API}/access_codes/delete`, {
    method:  'POST',
    headers: hdrs(apiKey),
    body:    JSON.stringify({ access_code_id: codeId }),
  })
  return res.ok
}

/** Creates a code on a device. Returns { ok, codeId, errType }. */
async function createCode(apiKey, deviceId, name, pin) {
  const res  = await fetch(`${SEAM_API}/access_codes/create`, {
    method:  'POST',
    headers: hdrs(apiKey),
    body:    JSON.stringify({ device_id: deviceId, name, code: pin }),
  })
  const body = await res.json()
  if (res.ok) return { ok: true,  codeId: body.access_code?.access_code_id ?? '(no id)' }
  return      { ok: false, errType: body?.error?.type ?? body?.error ?? res.status }
}

// ── Restore mode ──────────────────────────────────────────────────────────────

async function restore(members) {
  console.log('Mode: RESTORE — re-creating missing codes on old device\n')

  let restored = 0
  let skipped  = 0
  let failed   = 0

  for (const m of members) {
    const label = `${m.firstName} ${m.lastName} <${m.email}> [${m.accessCode}]`

    if (DRY_RUN) {
      console.log(`  (dry) would check and restore ${label}`)
      skipped++
      continue
    }

    try {
      // Member needs restoring only if the PIN is absent from BOTH devices
      const onOld = await findManagedCodeId(TRIUMPH_SEAM_KEY, OLD_DEVICE_ID, m.accessCode)
      const onNew = await findManagedCodeId(process.env.SEAM_API_KEY, NEW_DEVICE_ID, m.accessCode)

      if (onOld) {
        console.log(`  =  ${label} — already on old device, no action needed`)
        skipped++
        continue
      }
      if (onNew) {
        console.log(`  =  ${label} — present on new device, no restore needed`)
        skipped++
        continue
      }

      // PIN missing from both — restore to old device
      const { ok, codeId, errType } = await createCode(
        TRIUMPH_SEAM_KEY, OLD_DEVICE_ID,
        `${m.firstName} ${m.lastName}`, m.accessCode,
      )
      if (ok) {
        console.log(`  ✓  ${label} — restored to old device (${codeId})`)
        restored++
      } else if (errType === 'duplicate_access_code') {
        console.log(`  ✓  ${label} — already on old device (duplicate)`)
        restored++
      } else {
        console.error(`  ❌  ${label} — restore failed: ${errType}`)
        failed++
      }
    } catch (err) {
      console.error(`  ❌  ${label} — unexpected error: ${err.message}`)
      failed++
    }
  }

  console.log(`\nRestore done. restored=${restored}  skipped=${skipped}  failed=${failed}${DRY_RUN ? ' (dry run)' : ''}`)
}

// ── Provision mode ────────────────────────────────────────────────────────────

async function provision(members, ironkeyApiKey) {
  console.log('Mode: PROVISION — migrating codes from old device to new device\n')

  let succeeded = 0
  let failed    = 0
  let skipped   = 0

  for (const m of members) {
    const label = `${m.firstName} ${m.lastName} <${m.email}> [${m.accessCode}]`

    if (DRY_RUN) {
      console.log(`  (dry) ${label}`)
      skipped++
      continue
    }

    try {
      // ── Step 1: delete from old device ──────────────────────────────────────
      const oldCodeId = await findManagedCodeId(TRIUMPH_SEAM_KEY, OLD_DEVICE_ID, m.accessCode)
      if (oldCodeId) {
        const deleted = await deleteCodeById(TRIUMPH_SEAM_KEY, oldCodeId)
        if (deleted) {
          console.log(`  🗑  ${label} — deleted from old device (${oldCodeId})`)
        } else {
          console.warn(`  ⚠  ${label} — could not delete old code ${oldCodeId}, continuing`)
        }
      } else {
        console.log(`  –  ${label} — not found on old device, skipping delete`)
      }

      // ── Step 2: check if already on new device ───────────────────────────────
      const existingCodeId = await findManagedCodeId(ironkeyApiKey, NEW_DEVICE_ID, m.accessCode)
      if (existingCodeId) {
        console.log(`  ✓  ${label} — already managed on new device, skipping create`)
        succeeded++
        continue
      }

      // ── Step 3: create on new device ────────────────────────────────────────
      const { ok, codeId, errType } = await createCode(
        ironkeyApiKey, NEW_DEVICE_ID,
        `${m.firstName} ${m.lastName}`, m.accessCode,
      )
      if (ok) {
        console.log(`  ✓  ${label} — created on new device (${codeId})`)
        succeeded++
      } else if (errType === 'duplicate_access_code') {
        console.log(`  ✓  ${label} — already managed on new device`)
        succeeded++
      } else {
        console.error(`  ❌  ${label} — create failed: ${errType}`)
        failed++
      }
    } catch (err) {
      console.error(`  ❌  ${label} — unexpected error: ${err.message}`)
      failed++
    }
  }

  console.log(`\nProvisioning done. succeeded=${succeeded}  failed=${failed}${DRY_RUN ? `  skipped(dry)=${skipped}` : ''}`)
  return failed
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const ironkeyApiKey = process.env.SEAM_API_KEY
  if (!ironkeyApiKey) {
    console.error('❌  SEAM_API_KEY env var is not set')
    process.exit(1)
  }
  if (!TRIUMPH_SEAM_KEY) {
    console.error('❌  TRIUMPH_SEAM_KEY env var is not set')
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
  console.log(`Old device: ${OLD_DEVICE_ID}`)
  console.log(`New device: ${NEW_DEVICE_ID}`)
  if (DRY_RUN) console.log('DRY RUN — no Seam calls or DB writes will be made.')
  console.log()

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

  if (RESTORE) {
    await restore(members)
    return
  }

  const failed = await provision(members, ironkeyApiKey)

  if (failed > 0) {
    console.warn(`\n⚠  ${failed} member(s) failed — run with --restore to re-create their codes on the old device.`)
    process.exit(1)
  }

  // ── Update DB ────────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    await prisma.gym.update({
      where: { slug: 'triumph-barbell' },
      data:  { seamDeviceId: NEW_DEVICE_ID, seamApiKey: TRIUMPH_SEAM_KEY },
    })
    console.log(`\n✅  triumph-barbell.seamDeviceId updated to ${NEW_DEVICE_ID}`)
    console.log(`✅  triumph-barbell.seamApiKey updated to Triumph workspace key`)
  } else {
    console.log(`\n(dry) would set triumph-barbell.seamDeviceId to ${NEW_DEVICE_ID}`)
    console.log(`(dry) would set triumph-barbell.seamApiKey to Triumph workspace key`)
  }
}

main()
  .catch(err => { console.error('❌  Fatal:', err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
