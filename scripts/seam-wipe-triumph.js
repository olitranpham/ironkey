/**
 * scripts/seam-wipe-triumph.js
 *
 * One-time script: deletes ALL access codes (managed + unmanaged) from device
 * bff1c843-b6b9-4788-874d-8386441cff64 using SEAM_API_KEY.
 *
 * Managed codes   → access_codes/delete
 * Unmanaged codes → access_codes/unmanaged/delete with force: true
 *
 * Usage:
 *   node scripts/seam-wipe-triumph.js           # live run
 *   DRY_RUN=1 node scripts/seam-wipe-triumph.js # dry run — lists codes without deleting
 */

require('dotenv').config()

const SEAM_API  = 'https://connect.getseam.com'
const DEVICE_ID = 'bff1c843-b6b9-4788-874d-8386441cff64'
const DRY_RUN   = process.env.DRY_RUN === '1'

async function main() {
  const apiKey = process.env.SEAM_API_KEY
  if (!apiKey) {
    console.error('❌  SEAM_API_KEY env var is not set')
    process.exit(1)
  }

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  console.log(`Device: ${DEVICE_ID}`)
  if (DRY_RUN) console.log('DRY RUN — codes will be listed but not deleted.')
  console.log()

  // ── Fetch managed + unmanaged codes ────────────────────────────────────────
  const [managedRes, unmanagedRes] = await Promise.all([
    fetch(`${SEAM_API}/access_codes/list`, {
      method: 'POST', headers,
      body:   JSON.stringify({ device_id: DEVICE_ID }),
    }),
    fetch(`${SEAM_API}/access_codes/unmanaged/list`, {
      method: 'POST', headers,
      body:   JSON.stringify({ device_id: DEVICE_ID }),
    }),
  ])

  const managed   = managedRes.ok   ? (await managedRes.json()).access_codes   ?? [] : []
  const unmanaged = unmanagedRes.ok  ? (await unmanagedRes.json()).access_codes ?? [] : []

  if (!managedRes.ok)   console.warn('⚠  access_codes/list failed:', managedRes.status)
  if (!unmanagedRes.ok) console.warn('⚠  access_codes/unmanaged/list failed:', unmanagedRes.status)

  console.log(`Found ${managed.length} managed + ${unmanaged.length} unmanaged codes (${managed.length + unmanaged.length} total)\n`)

  let deleted = 0
  let failed  = 0

  // ── Delete managed codes ───────────────────────────────────────────────────
  for (const c of managed) {
    const label = `[managed]   "${c.name ?? '—'}" PIN=${c.code} id=${c.access_code_id}`
    if (DRY_RUN) { console.log(`  (dry) ${label}`); continue }

    const res = await fetch(`${SEAM_API}/access_codes/delete`, {
      method: 'POST', headers,
      body:   JSON.stringify({ access_code_id: c.access_code_id }),
    })
    if (res.ok) {
      console.log(`  🗑  ${label}`)
      deleted++
    } else {
      const text = await res.text()
      console.error(`  ❌  ${label} — ${res.status} ${text}`)
      failed++
    }
  }

  // ── Delete unmanaged codes (force: true) ───────────────────────────────────
  for (const c of unmanaged) {
    const label = `[unmanaged] "${c.name ?? '—'}" PIN=${c.code} id=${c.access_code_id}`
    if (DRY_RUN) { console.log(`  (dry) ${label}`); continue }

    const res = await fetch(`${SEAM_API}/access_codes/unmanaged/delete`, {
      method: 'POST', headers,
      body:   JSON.stringify({ access_code_id: c.access_code_id, force: true }),
    })
    if (res.ok) {
      console.log(`  🗑  ${label}`)
      deleted++
    } else {
      const text = await res.text()
      console.error(`  ❌  ${label} — ${res.status} ${text}`)
      failed++
    }
  }

  console.log(`\nDone. deleted=${deleted}  failed=${failed}${DRY_RUN ? '  (dry run)' : ''}`)
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error('❌  Fatal:', err.message); process.exit(1) })
