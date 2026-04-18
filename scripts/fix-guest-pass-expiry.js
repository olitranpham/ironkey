import prisma from '../lib/prisma.js'

async function main() {
  const passes = await prisma.guestPass.findMany({
    select: { id: true, usedAt: true, createdAt: true },
  })

  console.log(`Found ${passes.length} guest pass(es) to update`)

  let updated = 0
  for (const pass of passes) {
    const base      = pass.usedAt ?? pass.createdAt
    const expiresAt = new Date(new Date(base).getTime() + 24 * 60 * 60 * 1000)

    await prisma.guestPass.update({
      where: { id: pass.id },
      data:  { expiresAt },
    })
    updated++
  }

  console.log(`Updated ${updated} guest pass(es) — expiresAt = usedAt + 24h`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
