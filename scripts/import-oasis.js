/**
 * scripts/import-oasis.js
 *
 * Imports Oasis Powerlifting Club data from 6 CSV files into the DB.
 *
 * Member CSVs (Active, Canceled, Frozen, Flex):
 *   Upserts Member on email+gymId.
 *   Active/Canceled/Frozen → membershipType=general
 *   Flex → membershipType=flex, status=ACTIVE
 *
 * Guest CSVs (Single, Value_Deluxe):
 *   Upserts GuestProfile on email.
 *   Creates GuestPass (GuestVisit) linked to the profile + gym.
 *
 * Usage:
 *   node scripts/import-oasis.js           # live run
 *   DRY_RUN=1 node scripts/import-oasis.js # dry run — no DB writes
 */

require('dotenv').config()
const fs      = require('fs')
const path    = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma  = new PrismaClient()
const DRY_RUN = process.env.DRY_RUN === '1'

const DOWNLOADS = '/Users/olitranpham/Downloads'

const MEMBER_FILES = [
  { file: '[OASIS] Codes - Active.csv',       status: 'ACTIVE',    membershipType: 'general', dateCol: 'Date Purchased', statusDateField: null },
  { file: '[OASIS] Codes - Canceled.csv',     status: 'CANCELLED', membershipType: 'general', dateCol: 'Date Canceled',  statusDateField: 'dateCanceled' },
  { file: '[OASIS] Codes - Frozen.csv',       status: 'FROZEN',    membershipType: 'general', dateCol: 'Date Frozen',    statusDateField: 'dateFrozen' },
  { file: '[OASIS] Codes - Flex Members.csv', status: 'ACTIVE',    membershipType: 'flex',    dateCol: 'Date Purchased', statusDateField: null },
]

const GUEST_FILES = [
  { file: '[OASIS] Codes - Guest Passes - Single.csv' },
  { file: '[OASIS] Codes - Guest Passes - Value_Deluxe.csv' },
]

// ── CSV parser (handles quoted fields) ───────────────────────────────────────

function parseCSV(filePath) {
  const text  = fs.readFileSync(filePath, 'utf8')
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  function splitLine(line) {
    const fields = []
    let cur = '', inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    fields.push(cur.trim())
    return fields
  }

  const headers = splitLine(lines[0])
  return lines.slice(1).map(line => {
    const vals = splitLine(line)
    const row  = {}
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? '').trim() })
    return row
  })
}

// ── Name splitter ─────────────────────────────────────────────────────────────

function splitName(fullName) {
  const s         = (fullName ?? '').trim()
  const idx       = s.indexOf(' ')
  const firstName = idx === -1 ? s         : s.slice(0, idx)
  const lastName  = idx === -1 ? ''        : s.slice(idx + 1)
  return { firstName, lastName }
}

// ── Date parser (M/D/YYYY or MM/DD/YYYY) ─────────────────────────────────────

function parseDate(val) {
  if (!val || !val.trim()) return null
  const parts = val.trim().split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts.map(Number)
  if (!m || !d || !y) return null
  return new Date(y, m - 1, d)  // local midnight — avoids UTC off-by-one
}

// ── PassType mapper ───────────────────────────────────────────────────────────

const PASS_TYPE_MAP = {
  single: 'SINGLE',
  value:  'VALUE',
  deluxe: 'DELUXE',
}

function toPassType(raw) {
  return PASS_TYPE_MAP[(raw ?? '').toLowerCase().trim()] ?? 'SINGLE'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) console.log('DRY RUN — no DB writes will be made.\n')

  // ── Resolve gym ─────────────────────────────────────────────────────────────
  const gym = await prisma.gym.findUnique({
    where:  { slug: 'oasis-boston' },
    select: { id: true, name: true },
  })
  if (!gym) {
    console.error('❌  oasis-boston not found in DB')
    process.exit(1)
  }
  console.log(`Gym: ${gym.name} (${gym.id})\n`)

  let totalUpserted  = 0
  let totalSkipped   = 0
  let totalGuests    = 0
  let totalPasses    = 0

  // ── Member files ─────────────────────────────────────────────────────────────
  for (const { file, status, membershipType, dateCol, statusDateField } of MEMBER_FILES) {
    const filePath = path.join(DOWNLOADS, file)
    const rows     = parseCSV(filePath)

    let upserted = 0
    let skipped  = 0

    for (const row of rows) {
      const email = (row['Email'] ?? '').trim().toLowerCase()
      if (!email) { skipped++; continue }

      const { firstName, lastName } = splitName(row['Full Name'])
      if (!firstName) { skipped++; continue }

      const accessCode   = (row['Access Code'] ?? '').trim() || null
      const cusId        = (row['Cus ID']      ?? '').trim() || null
      const subId        = (row['Sub ID']      ?? '').trim() || null
      const priceId      = (row['Price ID']    ?? '').trim() || null
      const phone        = (row['Phone Number'] ?? '').trim() || null
      const dateParsed   = parseDate(row[dateCol])

      if (DRY_RUN) {
        console.log(`  (dry) ${status} | ${firstName} ${lastName} <${email}> date=${dateParsed?.toISOString().split('T')[0] ?? '—'}`)
        upserted++
        continue
      }

      await prisma.member.upsert({
        where:  { gymId_email: { gymId: gym.id, email } },
        update: {
          firstName,
          lastName,
          phone,
          status,
          membershipType,
          ...(accessCode  && { accessCode }),
          ...(cusId       && { stripeCustomerId:     cusId }),
          ...(subId       && { stripeSubscriptionId: subId }),
          ...(priceId     && { priceId }),
          ...(dateParsed  && { dateAccessed: dateParsed }),
          ...(dateParsed && statusDateField && { [statusDateField]: dateParsed }),
        },
        create: {
          gymId: gym.id,
          firstName,
          lastName,
          email,
          phone,
          status,
          membershipType,
          accessCode,
          stripeCustomerId:     cusId,
          stripeSubscriptionId: subId,
          priceId,
          ...(dateParsed && {
            createdAt:    dateParsed,
            dateAccessed: dateParsed,
            ...(statusDateField && { [statusDateField]: dateParsed }),
          }),
        },
      })
      upserted++
    }

    console.log(`${file}: ${upserted} upserted, ${skipped} skipped`)
    totalUpserted += upserted
    totalSkipped  += skipped
  }

  console.log()

  // ── Guest files ───────────────────────────────────────────────────────────────
  for (const { file } of GUEST_FILES) {
    const filePath = path.join(DOWNLOADS, file)
    const rows     = parseCSV(filePath)

    let guests = 0
    let passes = 0
    let skipped = 0

    // GuestVisit.expiresAt is required — use a far-future date for imported passes
    const FAR_FUTURE = new Date('2099-12-31')

    const FALLBACK_DATE = new Date('2025-01-03')

    for (const row of rows) {
      const email    = (row['Email']     ?? '').trim().toLowerCase() || null
      const fullName = (row['Full Name'] ?? '').trim()
      const phone    = (row['Phone Number'] ?? '').trim() || null
      const passType = toPassType(row['Guest Pass Type'])
      const code     = (row['Access Code'] ?? '').trim() || null
      const datePurchased = parseDate(row['Date Purchased']) ?? FALLBACK_DATE

      if (!fullName) { skipped++; continue }

      if (DRY_RUN) {
        console.log(`  (dry) guest | ${fullName} <${email ?? '—'}> [${passType}] date=${datePurchased.toISOString().split('T')[0]}`)
        guests++; passes++
        continue
      }

      // Upsert GuestProfile
      let profile
      if (email) {
        profile = await prisma.guest.upsert({
          where:  { email },
          update: { name: fullName, ...(phone && { phone }), ...(code && { accessCode: code }) },
          create: { name: fullName, email, phone, accessCode: code },
        })
      } else {
        // No email — create new profile every time (can't deduplicate)
        profile = await prisma.guest.create({
          data: { name: fullName, phone, accessCode: code },
        })
      }
      guests++

      // Create GuestPass (GuestVisit)
      await prisma.guestVisit.create({
        data: {
          gymId:          gym.id,
          guestProfileId: profile.id,
          guestName:      fullName,
          guestEmail:     email,
          guestPhone:     phone,
          passType,
          createdAt:      datePurchased,
          expiresAt:      FAR_FUTURE,
        },
      })
      passes++
    }

    console.log(`${file}: ${guests} profiles upserted, ${passes} passes created, ${skipped} skipped`)
    totalGuests += guests
    totalPasses += passes
  }

  console.log(`
── Totals ──────────────────────────────────────────
  Members upserted : ${totalUpserted}
  Members skipped  : ${totalSkipped}
  Guest profiles   : ${totalGuests}
  Guest passes     : ${totalPasses}
${DRY_RUN ? '\n(dry run — nothing was written)' : ''}`)
}

main()
  .catch(err => { console.error('❌  Fatal:', err.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
