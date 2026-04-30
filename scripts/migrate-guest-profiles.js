/**
 * Migration: GuestProfile → global + GuestWaiver per gym
 *
 * 1. For each GuestProfile, create a GuestWaiver (gymId + guestProfileId)
 * 2. Find profiles with duplicate emails (same person at multiple gyms)
 * 3. For each duplicate set: keep the profile with the most GuestPass records,
 *    re-point all GuestPass rows to the keeper, delete duplicates
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('── Step 1: Seed GuestWaiver from GuestProfile.gymId ─────────────────')

  const profiles = await prisma.guestProfile.findMany({
    select: { id: true, gymId: true, email: true },
  })

  let waiverCreated = 0
  for (const p of profiles) {
    if (!p.gymId) continue
    try {
      await prisma.guestWaiver.upsert({
        where: { guestProfileId_gymId: { guestProfileId: p.id, gymId: p.gymId } },
        update: {},
        create: { guestProfileId: p.id, gymId: p.gymId },
      })
      waiverCreated++
    } catch (e) {
      console.error(`  Failed to create waiver for profile ${p.id}:`, e.message)
    }
  }
  console.log(`  Created/verified ${waiverCreated} GuestWaiver records`)

  console.log('\n── Step 2: Deduplicate GuestProfile by email ────────────────────────')

  // Find all emails with multiple profiles
  const dupes = await prisma.$queryRaw`
    SELECT email, array_agg(id ORDER BY (SELECT COUNT(*) FROM "GuestPass" WHERE "guestProfileId" = gp.id) DESC, "createdAt" ASC) as ids
    FROM "GuestProfile" gp
    WHERE email IS NOT NULL
    GROUP BY email
    HAVING COUNT(*) > 1
  `

  console.log(`  Found ${dupes.length} emails with duplicate profiles`)

  let merged = 0
  let deleted = 0

  for (const row of dupes) {
    const [keepId, ...removeIds] = row.ids
    console.log(`  email: ${row.email} — keep ${keepId}, remove [${removeIds.join(', ')}]`)

    // Merge waivers: assign any waiver from removed profiles to the keeper
    // (only if the keeper doesn't already have a waiver for that gym)
    for (const removeId of removeIds) {
      const waivers = await prisma.guestWaiver.findMany({
        where: { guestProfileId: removeId },
        select: { gymId: true },
      })
      for (const w of waivers) {
        await prisma.guestWaiver.upsert({
          where: { guestProfileId_gymId: { guestProfileId: keepId, gymId: w.gymId } },
          update: {},
          create: { guestProfileId: keepId, gymId: w.gymId },
        })
      }

      // Re-point GuestPass rows to keeper
      const updated = await prisma.guestPass.updateMany({
        where: { guestProfileId: removeId },
        data:  { guestProfileId: keepId },
      })
      console.log(`    moved ${updated.count} passes from ${removeId} → ${keepId}`)

      // Delete waivers for the removed profile (cascading would handle it but let's be explicit)
      await prisma.guestWaiver.deleteMany({ where: { guestProfileId: removeId } })

      // Delete removed profile
      await prisma.guestProfile.delete({ where: { id: removeId } })
      deleted++
    }
    merged++
  }

  console.log(`  Merged ${merged} duplicate email groups, deleted ${deleted} profiles`)
  console.log('\n── Done ─────────────────────────────────────────────────────────────')

  const total = await prisma.guestProfile.count()
  const waiverTotal = await prisma.guestWaiver.count()
  console.log(`  Profiles remaining: ${total}`)
  console.log(`  GuestWaiver records: ${waiverTotal}`)
}

main()
  .then(() => { console.log('\nMigration complete.'); process.exit(0) })
  .catch(e => { console.error('Migration failed:', e); process.exit(1) })
