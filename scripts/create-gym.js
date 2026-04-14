#!/usr/bin/env node
/**
 * scripts/create-gym.js
 * Interactively creates a new gym and owner account in the Ironkey database.
 *
 * Usage:
 *   node scripts/create-gym.js
 *   npx dotenv-cli -e .env -- node scripts/create-gym.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const readline = require('readline')
const bcrypt   = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
})

function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())))
}

function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let input = ''
    stdin.on('data', function handler(ch) {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.removeListener('data', handler)
        process.stdout.write('\n')
        resolve(input)
      } else if (ch === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n')
        process.exit(0)
      } else if (ch === '\u007f' || ch === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        input += ch
        process.stdout.write('*')
      }
    })
  })
}

function toSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

async function main() {
  console.log('\n── create gym ──────────────────────────────────────\n')

  const gymName = await ask('gym name:        ')
  if (!gymName) { console.error('gym name is required'); process.exit(1) }

  const slug = toSlug(gymName)
  console.log(`slug (auto):     ${slug}`)

  const email = await ask('owner email:     ')
  if (!email || !email.includes('@')) { console.error('valid email is required'); process.exit(1) }

  const password = await askHidden('owner password:  ')
  if (!password || password.length < 8) {
    console.error('password must be at least 8 characters')
    process.exit(1)
  }

  console.log('\ncreating…')

  const hashed = await bcrypt.hash(password, 12)

  try {
    const { gym, user } = await prisma.$transaction(async tx => {
      const gym = await tx.gym.create({
        data: { name: gymName, slug },
      })
      const user = await tx.gymUser.create({
        data: { gymId: gym.id, email, password: hashed, role: 'OWNER' },
      })
      return { gym, user }
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    console.log('\n── success ─────────────────────────────────────────')
    console.log(`gym name:   ${gym.name}`)
    console.log(`slug:       ${gym.slug}`)
    console.log(`gym id:     ${gym.id}`)
    console.log(`owner:      ${user.email}  (role: ${user.role})`)
    console.log(`login url:  ${appUrl}/${gym.slug}/dashboard`)
    console.log('────────────────────────────────────────────────────\n')
  } catch (err) {
    if (err.code === 'P2002') {
      console.error('\nerror: a gym with that slug or an owner with that email already exists.')
    } else {
      console.error('\nerror:', err.message)
    }
    process.exit(1)
  }
}

main()
  .finally(() => {
    rl.close()
    prisma.$disconnect()
  })
