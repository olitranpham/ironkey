import prisma from '../lib/prisma.js'

function normName(s) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

async function main() {
  // Find all passes without a linked profile
  const unlinked = await prisma.guestPass.findMany({
    where:  { guestProfileId: null },
    select: { id: true, gymId: true, guestName: true, guestEmail: true, guestPhone: true },
  })

  console.log(`Found ${unlinked.length} unlinked guest pass(es)`)

  if (unlinked.length === 0) {
    console.log('Nothing to do.')
    return
  }

  // Group by gymId first, then by email or normalized name within each gym
  const byGym = new Map()
  for (const p of unlinked) {
    if (!byGym.has(p.gymId)) byGym.set(p.gymId, [])
    byGym.get(p.gymId).push(p)
  }

  let profilesCreated = 0
  let passesLinked    = 0

  for (const [gymId, passes] of byGym) {
    // Load existing name-only profiles for this gym (for dedup)
    const existingNameProfiles = await prisma.guestProfile.findMany({
      where:  { gymId, email: null },
      select: { id: true, name: true },
    })
    const nameProfileMap = new Map(
      existingNameProfiles.map(p => [normName(p.name), p.id])
    )

    // Group passes: email → group, normName → group
    const emailGroups = new Map()
    const nameGroups  = new Map()

    for (const p of passes) {
      const email = (p.guestEmail ?? '').trim().toLowerCase()
      const norm  = normName(p.guestName)

      if (email) {
        if (!emailGroups.has(email)) {
          emailGroups.set(email, { name: p.guestName, phone: p.guestPhone, ids: [] })
        }
        emailGroups.get(email).ids.push(p.id)
      } else {
        if (!nameGroups.has(norm)) {
          nameGroups.set(norm, { name: p.guestName, phone: p.guestPhone, ids: [] })
        }
        nameGroups.get(norm).ids.push(p.id)
      }
    }

    // Upsert profiles for email groups
    for (const [email, g] of emailGroups) {
      const profile = await prisma.guestProfile.upsert({
        where:  { gymId_email: { gymId, email } },
        update: {},
        create: { gymId, name: g.name, email, phone: g.phone ?? null },
      })
      await prisma.guestPass.updateMany({
        where: { id: { in: g.ids } },
        data:  { guestProfileId: profile.id },
      })
      profilesCreated++
      passesLinked += g.ids.length
      console.log(`  [email] "${email}" → profile ${profile.id} (${g.ids.length} pass(es))`)
    }

    // Create/find profiles for name-only groups
    for (const [norm, g] of nameGroups) {
      let profileId = nameProfileMap.get(norm)

      if (!profileId) {
        const profile = await prisma.guestProfile.create({
          data: { gymId, name: g.name, email: null, phone: g.phone ?? null },
        })
        profileId = profile.id
        nameProfileMap.set(norm, profileId)
        profilesCreated++
        console.log(`  [name]  "${g.name}" → new profile ${profileId} (${g.ids.length} pass(es))`)
      } else {
        console.log(`  [name]  "${g.name}" → existing profile ${profileId} (${g.ids.length} pass(es))`)
      }

      await prisma.guestPass.updateMany({
        where: { id: { in: g.ids } },
        data:  { guestProfileId: profileId },
      })
      passesLinked += g.ids.length
    }
  }

  console.log(`\nDone — ${profilesCreated} profile(s) created/upserted, ${passesLinked} pass(es) linked`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
