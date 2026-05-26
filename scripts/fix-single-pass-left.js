import prisma from '../lib/prisma.js'

async function main() {
  // Dry-run: count affected records first
  const count = await prisma.guestVisit.count({
    where: {
      passType:   'SINGLE',
      usedAt:     { not: null },
      passesLeft: { not: 0 },
    },
  })

  console.log(`Found ${count} SINGLE pass(es) with usedAt set and passesLeft != 0`)

  if (count === 0) {
    console.log('Nothing to update.')
    return
  }

  const result = await prisma.guestVisit.updateMany({
    where: {
      passType:   'SINGLE',
      usedAt:     { not: null },
      passesLeft: { not: 0 },
    },
    data: { passesLeft: 0 },
  })

  console.log(`Updated ${result.count} record(s) — passesLeft set to 0`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
