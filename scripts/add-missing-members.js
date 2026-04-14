/**
 * scripts/add-missing-members.js
 * One-time: insert 4 missing triumph-barbell members and fix Heidi Siegler's name.
 */

require('dotenv').config()
const { Client } = require('pg')

const MEMBERS = [
  {
    firstName:    'Brian',
    lastName:     'Elderd',
    email:        'brianelderd23@gmail.com',
    membershipType: 'FOUNDING',
    status:       'ACTIVE',
    accessCode:   '978',
    phone:        '(978) 770-8094',
    dateAccessed: '2025-08-27',
  },
  {
    firstName:    'Sean',
    lastName:     'Verrier',
    email:        'seanverrier13@gmail.com',
    membershipType: 'FOUNDING',
    status:       'ACTIVE',
    accessCode:   '1703',
    phone:        '(978) 314-2382',
    dateAccessed: '2025-08-27',
  },
  {
    firstName:    'Richman',
    lastName:     'Chea',
    email:        'richmanchea@gmail.com',
    membershipType: 'FOUNDING',
    status:       'ACTIVE',
    accessCode:   '3881',
    phone:        null,
    dateAccessed: '2025-09-05',
  },
  {
    firstName:    'Logan',
    lastName:     'Sras',
    email:        'lrsras11@gmail.com',
    membershipType: 'GENERAL',
    status:       'ACTIVE',
    accessCode:   '3198',
    phone:        null,
    dateAccessed: '2025-11-13',
  },
]

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()

  const gymRes = await db.query(`SELECT id FROM "Gym" WHERE slug = $1`, ['triumph-barbell'])
  if (!gymRes.rows.length) { console.error('gym not found'); process.exit(1) }
  const gymId = gymRes.rows[0].id

  // ── Insert missing members ──────────────────────────────────────────────────
  for (const m of MEMBERS) {
    const res = await db.query(
      `INSERT INTO "Member"
         ("id", "gymId", "firstName", "lastName", "email", "phone",
          "status", "membershipType", "accessCode",
          "dateAccessed", "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NOW())
       ON CONFLICT ("gymId", "email") DO UPDATE SET
         "firstName"      = EXCLUDED."firstName",
         "lastName"       = EXCLUDED."lastName",
         "phone"          = COALESCE(EXCLUDED."phone", "Member"."phone"),
         "status"         = EXCLUDED."status",
         "membershipType" = EXCLUDED."membershipType",
         "accessCode"     = EXCLUDED."accessCode",
         "dateAccessed"   = EXCLUDED."dateAccessed",
         "updatedAt"      = NOW()
       RETURNING "firstName", "lastName", email, "accessCode", "membershipType"`,
      [gymId, m.firstName, m.lastName, m.email, m.phone,
       m.status, m.membershipType, m.accessCode, m.dateAccessed],
    )
    console.log('✓', res.rows[0].firstName, res.rows[0].lastName, `<${res.rows[0].email}>`,
      `code=${res.rows[0].accessCode}`, res.rows[0].membershipType)
  }

  // ── Fix Heidi Siegler's name ────────────────────────────────────────────────
  const heidi = await db.query(
    `UPDATE "Member"
     SET "firstName" = 'Heidi', "lastName" = 'Siegler', "updatedAt" = NOW()
     WHERE LOWER(email) = 'hsiegler129@gmail.com'
     RETURNING "firstName", "lastName", email`,
  )
  if (heidi.rowCount) {
    console.log('✓ fixed name:', heidi.rows[0].firstName, heidi.rows[0].lastName, `<${heidi.rows[0].email}>`)
  } else {
    console.warn('⚠  hsiegler129@gmail.com not found')
  }

  await db.end()
}

main().catch(err => { console.error(err); process.exit(1) })
