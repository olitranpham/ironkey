#!/usr/bin/env node
/**
 * scripts/fix-seam-code.js
 * Fetches all access codes from Seam, finds the one named "Brendan Pham",
 * and updates his DB accessCode to match.
 *
 * Usage: node scripts/fix-seam-code.js
 */

require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const SEAM_API = 'https://connect.getseam.com'

async function main() {
  // ── 1. Find Brendan in the DB ────────────────────────────────────────────
  const member = await prisma.member.findFirst({
    where: {
      firstName: { equals: 'Brendan', mode: 'insensitive' },
      lastName:  { equals: 'Pham',    mode: 'insensitive' },
    },
    include: { gym: true },
  })

  if (!member) {
    console.error('❌  No member found with name "Brendan Pham"')
    process.exit(1)
  }

  console.log(`✓  Found member: ${member.firstName} ${member.lastName} (${member.id})`)
  console.log(`   Current DB accessCode: ${member.accessCode ?? '(none)'}`)
  console.log(`   Gym: ${member.gym.name} (${member.gym.slug})`)

  // ── 2. Fetch devices from Seam ───────────────────────────────────────────
  const apiKey = member.gym.seamApiKey ?? process.env.SEAM_API_KEY
  if (!apiKey) {
    console.error('❌  No Seam API key found — set SEAM_API_KEY in .env or on the gym')
    process.exit(1)
  }

  const seamHeaders = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const devicesRes = await fetch(`${SEAM_API}/devices/list`, {
    method:  'POST',
    headers: seamHeaders,
    body:    JSON.stringify(
      member.gym.seamConnectedAccountId
        ? { connected_account_id: member.gym.seamConnectedAccountId }
        : {},
    ),
  })

  if (!devicesRes.ok) {
    console.error('❌  Seam devices/list failed:', devicesRes.status, await devicesRes.text())
    process.exit(1)
  }

  const { devices = [] } = await devicesRes.json()
  console.log(`✓  Found ${devices.length} Seam device(s)`)

  // ── 3. Fetch all access codes ────────────────────────────────────────────
  const codeResults = await Promise.all(
    devices.map(d =>
      fetch(`${SEAM_API}/access_codes/list`, {
        method:  'POST',
        headers: seamHeaders,
        body:    JSON.stringify({ device_id: d.device_id }),
      })
        .then(r => r.ok ? r.json() : { access_codes: [] })
        .then(b => b.access_codes ?? [])
        .catch(() => [])
    )
  )

  const allCodes = codeResults.flat()
  console.log(`✓  Found ${allCodes.length} total access code(s) on Seam`)

  // ── 4. Find the code named "Brendan Pham" ────────────────────────────────
  const match = allCodes.find(c =>
    c.name?.toLowerCase().includes('brendan') &&
    c.name?.toLowerCase().includes('pham')
  )

  if (!match) {
    console.log('\nAll codes on Seam:')
    allCodes.forEach(c => console.log(`  - "${c.name}" → ${c.code}`))
    console.error('\n❌  No Seam code found named "Brendan Pham"')
    process.exit(1)
  }

  console.log(`✓  Found Seam code: "${match.name}" → ${match.code}`)

  if (member.accessCode === match.code) {
    console.log('✓  DB already matches Seam — nothing to update')
    process.exit(0)
  }

  // ── 5. Update DB ─────────────────────────────────────────────────────────
  await prisma.member.update({
    where: { id: member.id },
    data:  { accessCode: match.code },
  })

  console.log(`✓  Updated DB accessCode: ${member.accessCode ?? '(none)'} → ${match.code}`)
  console.log('\n✅  Done — Brendan Pham should now show as "member" on the door access page')
}

main()
  .catch(err => { console.error('❌', err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
