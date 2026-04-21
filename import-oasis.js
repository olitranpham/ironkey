'use strict'

/**
 * import-oasis.js
 *
 * Imports OASIS members from four CSV files into the IronKey database.
 *
 * Usage (from project root):
 *   node import-oasis.js
 *
 * Required env vars:
 *   GYM_SLUG   — target gym (default: oasis-powerlifting-club)
 *   STRIPE_KEY — Stripe secret key, used to look up missing subscription IDs
 *   API_URL    — not used directly; DB connection comes from DATABASE_URL in .env
 *
 * Expected CSV files in the same directory as this script:
 *   triumph-active.csv
 *   triumph-frozen.csv
 *   triumph-canceled.csv
 *   subscriptions.csv
 */

require('dotenv').config()

const fs   = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

// ── Config ────────────────────────────────────────────────────────────────────

const GYM_SLUG   = process.env.GYM_SLUG
if (!GYM_SLUG) {
  console.error('GYM_SLUG env var is required (e.g. GYM_SLUG=triumph-barbell node import-oasis.js)')
  process.exit(1)
}
const STRIPE_KEY = process.env.STRIPE_KEY || process.env.STRIPE_SECRET_KEY

// ── CSV parser ────────────────────────────────────────────────────────────────
// Handles quoted fields (RFC 4180) — phone/name fields are clean, but be safe.

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

// ── Stripe helper ─────────────────────────────────────────────────────────────
// Fetches the most recent subscription for a Stripe customer.

async function fetchStripeSubscription(customerId) {
  if (!STRIPE_KEY) return null
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${customerId}&limit=1`,
      { headers: { Authorization: `Bearer ${STRIPE_KEY}` } },
    )
    if (!res.ok) return null
    const body = await res.json()
    return body.data?.[0]?.id ?? null
  } catch {
    return null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseName(full) {
  const parts = (full ?? '').trim().split(/\s+/)
  return {
    firstName: parts[0] || 'Unknown',
    lastName:  parts.slice(1).join(' ') || '',
  }
}

function parseDate(str) {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function col(row, ...keys) {
  for (const k of keys) {
    const v = (row[k] ?? '').trim()
    if (v) return v
  }
  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient()

  // ── 1. Find gym ─────────────────────────────────────────────────────────────
  const gym = await prisma.gym.findUnique({ where: { slug: GYM_SLUG } })
  if (!gym) {
    console.error(`Gym "${GYM_SLUG}" not found in database`)
    process.exit(1)
  }
  console.log(`Importing into gym: ${gym.name} (${gym.id})\n`)

  // ── 2. Load CSVs ────────────────────────────────────────────────────────────
  const dir = __dirname

  function loadCSV(filename) {
    const filepath = path.join(dir, filename)
    if (!fs.existsSync(filepath)) {
      // Also check data/ subdirectory
      const alt = path.join(dir, 'data', filename)
      if (fs.existsSync(alt)) return parseCSV(alt)
      console.error(`Missing file: ${filename} (looked in ${dir} and ${dir}/data/)`)
      process.exit(1)
    }
    return parseCSV(filepath)
  }

  const activeRows   = loadCSV('[OASIS] Codes - Active.csv')
  const frozenRows   = loadCSV('[OASIS] Codes - Frozen.csv')
  const canceledRows = loadCSV('[OASIS] Codes - Canceled.csv')
  const flexRows     = loadCSV('[OASIS] Codes - Flex Members.csv')

  console.log(`Loaded: ${activeRows.length} active, ${frozenRows.length} frozen, ${canceledRows.length} cancelled, ${flexRows.length} flex\n`)

  // ── 3. Merge all members with their status ──────────────────────────────────
  const memberRows = [
    ...activeRows.map(r   => ({ ...r, _status: 'ACTIVE'    })),
    ...flexRows.map(r     => ({ ...r, _status: 'ACTIVE'    })),
    ...frozenRows.map(r   => ({ ...r, _status: 'FROZEN'    })),
    ...canceledRows.map(r => ({ ...r, _status: 'CANCELLED' })),
  ]

  // ── 5. Upsert each member ───────────────────────────────────────────────────
  let created = 0, updated = 0, skipped = 0

  for (const row of memberRows) {
    const email = (col(row, 'Email') ?? '').toLowerCase()
    if (!email) {
      console.warn('  [skip] No email:', row['Full Name'] ?? '(no name)')
      skipped++
      continue
    }

    const { firstName, lastName } = parseName(col(row, 'Full Name'))
    const phone       = col(row, 'Phone Number')      || null
    const accessCode  = col(row, 'Access Code')       || null
    const customerId  = col(row, 'Cus ID', 'Cud ID')  || null
    const status      = row._status

    // Sub ID is directly in the CSV
    let subId = col(row, 'Sub ID') || null
    if (!subId && customerId && STRIPE_KEY) {
      subId = await fetchStripeSubscription(customerId)
      if (subId) console.log(`  [stripe] Fetched subId for ${email}: ${subId}`)
    }

    // Resolve membership type from price ID
    const priceId = col(row, 'Price ID') || null
    const PRICE_MAP = {
      'price_1QcD6DGdx1SSAW42K0WQEjAM': 'GENERAL',   // General Membership
      'price_1QcD6WGdx1SSAW42IcPuC2uW': 'STUDENT',   // Student Membership
      'price_1QcD6qGdx1SSAW42bWZ34OLi': 'WEEKEND',   // Weekend Membership
      'price_1QcD7RGdx1SSAW42a9tDif0c': 'STUDENT',   // Student Weekend Membership
      'price_1QcD87Gdx1SSAW42dmbiAPxU': 'STUDENT',   // Limited Collegiate Membership
      'price_1QnWAxGdx1SSAW42oqGXJvw0': 'STUDENT',   // Student Membership
      'price_1QnWBcGdx1SSAW42JEQwgX4Q': 'GENERAL',   // General Membership
      'price_1RkYgbGdx1SSAW42zkvm9AF9': 'STUDENT',   // Student Membership
      'price_1RkYgwGdx1SSAW42sisLkXaT': 'STUDENT',   // Student Membership
      'price_1RkYi6Gdx1SSAW42fU0FKv0f': 'GENERAL',   // General Membership
      'price_1RkYiHGdx1SSAW42a3XvQWD6': 'GENERAL',   // General Membership
      'price_1S8mK5Gdx1SSAW42y6EUUxQC': 'FLEX',      // Flex Membership
      'price_1SEiV8Gdx1SSAW42pQpOCqVt': 'GENERAL',   // General Membership
      'price_1T4lDaGdx1SSAW421A65FHEQ': 'GENERAL',   // General - Monthly
      'price_1T4mBFGdx1SSAW42sE1GjYMH': 'GENERAL',   // General - Monthly
      'price_1T6eLSGdx1SSAW42aFUphCTV': 'GENERAL',   // General - Contract
      'price_1T73O5Gdx1SSAW42hLCre0ST': 'GENERAL',   // General - 6 Months
      'price_1T7HEEGdx1SSAW428boLIB4G': 'FLEX',      // Flex
      'price_1T8pK1Gdx1SSAW42nJrFWV6O': 'GENERAL',   // General - Monthly
      'price_1TCTQZGdx1SSAW427gR08A6z': 'STUDENT',   // Student - Monthly
      'price_1TFI7mGdx1SSAW42u3XbAXf8': 'STUDENT',   // Student - Monthly
      'price_1TFhzJGdx1SSAW42QYW6rjYm': 'GENERAL',   // General - Monthly
      'price_1THsx3Gdx1SSAW42tEGDbbvj': 'GENERAL',   // General - 6 Months
      'price_1TJGpSGdx1SSAW42PgxsJ9pa': 'STUDENT',   // Student - Monthly
      'price_1TMWvnGdx1SSAW42qcmjyyOc': 'FLEX',      // Flex
    }
    const membershipType = (priceId && PRICE_MAP[priceId]) || 'GENERAL'

    const dateAccessed = parseDate(col(row, 'Date Purchased'))
    const dateFrozen   = parseDate(col(row, 'Date Frozen'))
    const dateCanceled = parseDate(col(row, 'Date Canceled'))
    const freezeEndDate = null

    try {
      const existing = await prisma.member.findUnique({
        where: { gymId_email: { gymId: gym.id, email } },
        select: { id: true },
      })

      await prisma.member.upsert({
        where:  { gymId_email: { gymId: gym.id, email } },
        create: {
          gymId: gym.id,
          firstName, lastName, email, phone,
          membershipType, status, accessCode,
          stripeCustomerId:     customerId,
          stripeSubscriptionId: subId,
          priceId,
          dateAccessed, dateFrozen, dateCanceled,
          freezeEndDate,
        },
        update: {
          firstName, lastName,
          ...(phone        ? { phone }                              : {}),
          membershipType, status,
          ...(accessCode   ? { accessCode }                         : {}),
          ...(customerId   ? { stripeCustomerId:     customerId }   : {}),
          ...(subId        ? { stripeSubscriptionId: subId }        : {}),
          ...(priceId      ? { priceId }                            : {}),
          ...(dateFrozen   ? { dateFrozen }                         : {}),
          ...(dateCanceled ? { dateCanceled }                       : {}),
          ...(dateAccessed ? { dateAccessed }                       : {}),
          ...(freezeEndDate ? { freezeEndDate }                     : {}),
        },
      })

      const label = existing ? 'update' : 'create'
      if (existing) updated++; else created++
      console.log(`  [${status.toLowerCase().padEnd(9)} ${label}] ${firstName} ${lastName} <${email}>`)
    } catch (err) {
      console.error(`  [ERROR] ${email}: ${err.message}`)
      skipped++
    }
  }

  await prisma.$disconnect()

  console.log(`\nDone — ${created} created, ${updated} updated, ${skipped} skipped`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})