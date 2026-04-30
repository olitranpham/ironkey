'use strict'

/**
 * import-oasis-guests.js
 *
 * Imports Oasis guest passes from two CSV files.
 *
 * Usage (from ironkey project root):
 *   GYM_SLUG=oasis-powerlifting-club node import-oasis-guests.js
 *
 * Expected CSV files in the same directory:
 *   [OASIS] Codes - Guest Passes - Single.csv
 *   [OASIS] Codes - Guest Passes - Value Deluxe.csv
 *
 * Pass types:
 *   Single  → SINGLE  (1 pass,  $22.50)
 *   Value   → VALUE   (5 passes, $85)
 *   Deluxe  → DELUXE  (10 passes, $135)
 *
 * passesLeft is calculated as: totalPasses - checkInCount
 */

require('dotenv').config()

const fs   = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const GYM_SLUG = process.env.GYM_SLUG
if (!GYM_SLUG) {
  console.error('GYM_SLUG env var is required')
  process.exit(1)
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(filepath) {
  const text = fs.readFileSync(filepath, 'utf8')
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean)
  if (lines.length < 2) return []

  function splitLine(line) {
    const fields = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') inQuote = false
        else cur += ch
      } else {
        if (ch === '"') inQuote = true
        else if (ch === ',') { fields.push(cur); cur = '' }
        else cur += ch
      }
    }
    fields.push(cur)
    return fields
  }

  const headers = splitLine(lines[0]).map(h => h.trim())
  return lines.slice(1).map(line => {
    const vals = splitLine(line)
    const row  = {}
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim() })
    return row
  })
}

function col(row, ...keys) {
  for (const k of keys) {
    const v = (row[k] ?? '').trim()
    if (v && v !== 'NaN') return v
  }
  return null
}

function parseDate(str) {
  if (!str || str === 'NaN') return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

// ── Pass type config ──────────────────────────────────────────────────────────
const PASS_CONFIG = {
  'Single': { type: 'SINGLE',  total: 0  },
  'Value':  { type: 'VALUE',   total: 5  },
  'Deluxe': { type: 'DELUXE',  total: 10 },
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const prisma = new PrismaClient()

  const gym = await prisma.gym.findUnique({ where: { slug: GYM_SLUG } })
  if (!gym) {
    console.error(`Gym "${GYM_SLUG}" not found`)
    process.exit(1)
  }
  console.log(`Importing guest passes into: ${gym.name} (${gym.id})\n`)

  const dir = __dirname

  function loadCSV(filename) {
    const filepath = path.join(dir, filename)
    if (!fs.existsSync(filepath)) {
      console.error(`Missing file: ${filename}`)
      process.exit(1)
    }
    return parseCSV(filepath)
  }

  const singleRows      = loadCSV('[OASIS] Codes - Guest Passes - Single.csv')
  const valueDeluxeRows = loadCSV('[OASIS] Codes - Guest Passes - Value Deluxe.csv')
  const allRows         = [...singleRows, ...valueDeluxeRows]

  console.log(`Loaded: ${singleRows.length} single, ${valueDeluxeRows.length} value/deluxe\n`)

  let created = 0, skipped = 0

  for (const row of allRows) {
    const name  = col(row, 'Full Name')
    const email = col(row, 'Email')?.toLowerCase() || null
    const phone = col(row, 'Phone Number') || null
    const accessCode = col(row, 'Access Code') || null
    const passTypeRaw = col(row, 'Guest Pass Type') || 'Single'
    const checkInCount = parseFloat(col(row, 'Check-In Count') || '0') || 0
    const datePurchased = parseDate(col(row, 'Date Purchased'))

    if (!name) {
      console.warn('  [skip] No name in row:', row)
      skipped++
      continue
    }

    const config = PASS_CONFIG[passTypeRaw]
    if (!config) {
      console.warn(`  [skip] Unknown pass type "${passTypeRaw}" for ${name}`)
      skipped++
      continue
    }

    const passesLeft = config.total - checkInCount

    // Upsert GuestProfile if email exists
    let guestProfileId = null
    if (email) {
      const profile = await prisma.guest.upsert({
        where:  { gymId_email: { gymId: gym.id, email } },
        create: { gymId: gym.id, name, email, phone, accessCode },
        update: { name, ...(phone ? { phone } : {}), ...(accessCode ? { accessCode } : {}) },
      })
      guestProfileId = profile.id
    }

    // Create the guest pass
    // expiresAt: if no purchase date, default to 1 year from now
    const expiresAt = datePurchased
      ? new Date(new Date(datePurchased).setFullYear(new Date(datePurchased).getFullYear() + 1))
      : new Date(new Date().setFullYear(new Date().getFullYear() + 1))

    try {
      await prisma.guestVisit.create({
        data: {
          gymId: gym.id,
          guestProfileId,
          guestName:  name,
          guestEmail: email,
          guestPhone: phone,
          passType:   config.type,
          passesLeft: Math.max(0, passesLeft),
          expiresAt,
          ...(datePurchased ? { usedAt: null, createdAt: datePurchased } : {}),
        },
      })
      console.log(`  [${config.type.padEnd(6)}] ${name}${email ? ` <${email}>` : ''} — ${Math.max(0, passesLeft)} passes left`)
      created++
    } catch (err) {
      console.error(`  [ERROR] ${name}: ${err.message}`)
      skipped++
    }
  }

  await prisma.$disconnect()
  console.log(`\nDone — ${created} created, ${skipped} skipped`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})