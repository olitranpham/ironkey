const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  const password = await bcrypt.hash('triumph123', 12)

  // ── Gym ────────────────────────────────────────────────────────────────────
  const gym = await prisma.gym.upsert({
    where: { slug: 'triumph-barbell' },
    update: {},
    create: { name: 'Triumph Barbell', slug: 'triumph-barbell' },
  })

  // ── Owner user ─────────────────────────────────────────────────────────────
  const user = await prisma.gymUser.upsert({
    where: { gymId_email: { gymId: gym.id, email: 'admin@triumphbarbell.com' } },
    update: {},
    create: {
      gymId: gym.id,
      email: 'admin@triumphbarbell.com',
      password,
      role: 'OWNER',
    },
  })

  // ── Sample members ─────────────────────────────────────────────────────────
  const members = [
    { firstName: 'Marcus',   lastName: 'Webb',     email: 'marcus@example.com',   phone: '555-0101', status: 'ACTIVE' },
    { firstName: 'Priya',    lastName: 'Nair',     email: 'priya@example.com',    phone: '555-0102', status: 'ACTIVE' },
    { firstName: 'Jordan',   lastName: 'Lee',      email: 'jordan@example.com',   phone: '555-0103', status: 'ACTIVE' },
    { firstName: 'Sofia',    lastName: 'Chen',     email: 'sofia@example.com',    phone: '555-0104', status: 'ACTIVE' },
    { firstName: 'Daniel',   lastName: 'Kim',      email: 'daniel@example.com',   phone: '555-0105', status: 'ACTIVE' },
    { firstName: 'Aisha',    lastName: 'Patel',    email: 'aisha@example.com',    phone: '555-0106', status: 'ACTIVE' },
    { firstName: 'Ryan',     lastName: 'Torres',   email: 'ryan@example.com',     phone: '555-0107', status: 'ACTIVE' },
    { firstName: 'Camille',  lastName: 'Dubois',   email: 'camille@example.com',  phone: '555-0108', status: 'ACTIVE' },
    { firstName: 'Lena',     lastName: 'Hartmann', email: 'lena@example.com',     phone: '555-0109', status: 'FROZEN' },
    { firstName: 'Omar',     lastName: 'Shaikh',   email: 'omar@example.com',     phone: '555-0110', status: 'FROZEN' },
    { firstName: 'Brianna',  lastName: 'Wallace',  email: 'brianna@example.com',  phone: '555-0111', status: 'CANCELLED' },
    { firstName: 'Tyler',    lastName: 'Brooks',   email: 'tyler@example.com',    phone: '555-0112', status: 'OVERDUE' },
  ]

  let created = 0
  let skipped = 0

  for (const m of members) {
    const existing = await prisma.member.findUnique({
      where: { gymId_email: { gymId: gym.id, email: m.email } },
    })
    if (existing) { skipped++; continue }

    await prisma.member.create({ data: { gymId: gym.id, ...m } })
    created++
  }

  console.log(`\nGym:     ${gym.name} (${gym.slug}) — id: ${gym.id}`)
  console.log(`Owner:   ${user.email} (${user.role})`)
  console.log(`Members: ${created} created, ${skipped} already existed`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
