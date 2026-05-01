import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

// ── Pass type mapping ─────────────────────────────────────────────────────────

const PASS_TYPE_MAP = {
  'single':    { type: 'SINGLE',     passesLeft: null },
  'day pass':  { type: 'SINGLE',     passesLeft: null },
  '3-pack':    { type: 'THREE_PACK', passesLeft: 3 },
  '3 pack':    { type: 'THREE_PACK', passesLeft: 3 },
  'three pack':{ type: 'THREE_PACK', passesLeft: 3 },
  '5-pack':    { type: 'FIVE_PACK',  passesLeft: 5 },
  '5 pack':    { type: 'FIVE_PACK',  passesLeft: 5 },
  'five pack': { type: 'FIVE_PACK',  passesLeft: 5 },
  '10-pack':   { type: 'TEN_PACK',   passesLeft: 10 },
  '10 pack':   { type: 'TEN_PACK',   passesLeft: 10 },
  'ten pack':  { type: 'TEN_PACK',   passesLeft: 10 },
}

function resolvePassType(raw) {
  const key = (raw ?? '').toLowerCase().trim()
  return PASS_TYPE_MAP[key] ?? { type: 'SINGLE', passesLeft: null }
}

// ── Jotform field extractor ───────────────────────────────────────────────────
// Jotform POSTs as application/x-www-form-urlencoded with keys like:
//   q3_fullName[first], q3_fullName[last], q5_email, q7_phone[full], etc.
// We extract by matching the fieldname portion (case-insensitive).

function buildFieldMap(params) {
  const map = {}
  for (const [k, v] of params) {
    // Match q<id>_<name> or q<id>_<name>[<sub>]
    const m = k.match(/^q\d+_([^[]+)(?:\[([^\]]*)\])?$/)
    if (!m) continue
    const name = m[1].toLowerCase()
    const sub  = m[2] ?? ''
    if (!map[name]) map[name] = {}
    map[name][sub] = v
  }
  return map
}

function getScalar(fieldMap, ...names) {
  for (const name of names) {
    const entry = fieldMap[name.toLowerCase()]
    if (!entry) continue
    // Prefer '' (un-subkeyed) value, then 'full', then first value found
    if (entry[''])     return entry[''].trim()
    if (entry['full']) return entry['full'].trim()
    const vals = Object.values(entry).filter(Boolean)
    if (vals.length) return vals.join(' ').trim()
  }
  return ''
}

function getFullName(fieldMap) {
  // Try name / fullName fields with [first]/[last] sub-keys
  for (const candidate of ['name', 'fullname', 'fullName']) {
    const entry = fieldMap[candidate.toLowerCase()]
    if (!entry) continue
    if (entry['']) return entry[''].trim()
    const first = entry['first'] ?? entry['First'] ?? ''
    const last  = entry['last']  ?? entry['Last']  ?? ''
    const joined = [first, last].filter(Boolean).join(' ').trim()
    if (joined) return joined
  }
  return ''
}

function getDOB(fieldMap) {
  for (const candidate of ['dob', 'birthdate', 'dateofbirth', 'birthday']) {
    const entry = fieldMap[candidate]
    if (!entry) continue
    if (entry['']) return entry[''].trim()
    const month = entry['month'] ?? entry['Month'] ?? ''
    const day   = entry['day']   ?? entry['Day']   ?? ''
    const year  = entry['year']  ?? entry['Year']  ?? ''
    if (month && day && year) return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  return ''
}

function getAddress(fieldMap) {
  for (const candidate of ['address', 'homeaddress', 'streetaddress']) {
    const entry = fieldMap[candidate]
    if (!entry) continue
    if (entry['']) return entry[''].trim()
    // Assemble sub-parts: addr1, addr2, city, state, zip
    const parts = [
      entry['addr_line1'] ?? entry['street'] ?? '',
      entry['addr_line2'] ?? '',
      entry['city'] ?? '',
      entry['state'] ?? '',
      entry['postal'] ?? entry['zip'] ?? '',
    ].filter(Boolean)
    if (parts.length) return parts.join(', ').trim()
  }
  return ''
}

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/[gymSlug]/jotform/guest-pass
 * Public — receives Jotform webhook submission for guest pass purchases and check-ins.
 *
 * Jotform sends application/x-www-form-urlencoded with fields like:
 *   q3_fullName[first]=Jane&q3_fullName[last]=Smith&q5_email=jane@...
 *
 * Expected field names (q<id>_ prefix, case-insensitive):
 *   name / fullName          — guest full name
 *   email                    — email address
 *   phone / phoneNumber      — phone number
 *   dob / birthDate          — date of birth
 *   address                  — home address
 *   ecName / emergencyName   — emergency contact name
 *   ecPhone / emergencyPhone — emergency contact phone
 *   ecRelationship           — emergency contact relationship
 *   passType                 — Single, 3-Pack, 5-Pack, 10-Pack
 *   firstTime / firstVisit   — Yes / No
 *   intent                   — Purchase / Check In
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params

    // ── Parse form body ───────────────────────────────────────────────────────
    const rawBody   = await request.text()
    const urlParams = new URLSearchParams(rawBody)
    const fieldMap  = buildFieldMap(urlParams)

    // ── Extract fields ────────────────────────────────────────────────────────
    const name                = getFullName(fieldMap)
    const email               = getScalar(fieldMap, 'email').toLowerCase() || null
    const phone               = getScalar(fieldMap, 'phone', 'phoneNumber', 'phonenumber') || null
    const dob                 = getDOB(fieldMap)
    const address             = getAddress(fieldMap)
    const ecName              = getScalar(fieldMap, 'ecName', 'emergencyName', 'emergencyContactName', 'ecname', 'emergencyname') || null
    const ecPhone             = getScalar(fieldMap, 'ecPhone', 'emergencyPhone', 'emergencyContactPhone', 'ecphone', 'emergencyphone') || null
    const ecRelationship      = getScalar(fieldMap, 'ecRelationship', 'emergencyRelationship', 'ecrelationship', 'emergencyrelationship') || null
    const passTypeRaw         = getScalar(fieldMap, 'passType', 'passtype', 'pass', 'passtype')
    const firstTimeRaw        = getScalar(fieldMap, 'firstTime', 'firstVisit', 'firsttime', 'firstvisit')
    const intentRaw           = getScalar(fieldMap, 'intent', 'formType', 'formtype')

    const isFirstTime = /yes|first/i.test(firstTimeRaw)
    const isCheckin   = /check.?in/i.test(intentRaw)

    const { type: passType, passesLeft } = resolvePassType(passTypeRaw)

    console.log('[jotform/guest-pass] slug=%s name=%s email=%s passType=%s intent=%s firstTime=%s',
      gymSlug, name, email, passType, intentRaw, firstTimeRaw)

    if (!name && !email) {
      return NextResponse.json({ error: 'name or email is required' }, { status: 400 })
    }

    // ── Load gym ──────────────────────────────────────────────────────────────
    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: {
        id:                    true,
        seamApiKey:            true,
        seamDeviceId:          true,
        zapierGuestWebhookUrl: true,
      },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    // ── Upsert Guest (global by email) ────────────────────────────────────────
    let guest = null
    if (email) {
      guest = await prisma.guest.upsert({
        where:  { email },
        update: {
          name:  name || undefined,
          phone: phone || undefined,
        },
        create: { name: name || email, email, phone },
      })
    }

    // ── Access code: reuse existing or generate new ───────────────────────────
    let accessCode = guest?.accessCode ?? null
    if (!accessCode) {
      accessCode = String(Math.floor(1000 + Math.random() * 9000))
      if (guest) {
        await prisma.guest.update({
          where: { id: guest.id },
          data:  { accessCode },
        })
      }
      console.log('[jotform/guest-pass] new accessCode %s for %s', accessCode, email)
    } else {
      console.log('[jotform/guest-pass] reusing accessCode %s for %s', accessCode, email)
    }

    // ── Create GuestWaiver (first time at this gym) ───────────────────────────
    if (isFirstTime && guest) {
      await prisma.guestWaiver.upsert({
        where:  { guestProfileId_gymId: { guestProfileId: guest.id, gymId: gym.id } },
        update: {},
        create: { guestProfileId: guest.id, gymId: gym.id },
      })
    }

    // ── GuestVisit: create (purchase) or decrement (check-in) ────────────────
    if (isCheckin && guest) {
      const existing = await prisma.guestVisit.findFirst({
        where: {
          gymId:         gym.id,
          guestProfileId: guest.id,
          passesLeft:    { gt: 0 },
        },
        orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
      })
      if (existing) {
        await prisma.guestVisit.update({
          where: { id: existing.id },
          data:  { passesLeft: existing.passesLeft - 1, usedAt: new Date() },
        })
        console.log('[jotform/guest-pass] decremented pack %s passesLeft=%d', existing.id, existing.passesLeft - 1)
      } else {
        console.warn('[jotform/guest-pass] check-in but no active pack for', email)
      }
    } else {
      // Purchase: create new GuestVisit record
      await prisma.guestVisit.create({
        data: {
          gymId:          gym.id,
          guestProfileId: guest?.id  ?? null,
          guestName:      name       || email || 'Guest',
          guestEmail:     email,
          guestPhone:     phone,
          passType,
          passesLeft,
          usedAt:         new Date(),
          expiresAt:      new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      console.log('[jotform/guest-pass] created GuestVisit passType=%s passesLeft=%s', passType, passesLeft)
    }

    // ── Program time-bound Seam code (24 hr) ─────────────────────────────────
    if (gym.seamApiKey && gym.seamDeviceId && accessCode) {
      const seamHeaders = {
        Authorization:  `Bearer ${gym.seamApiKey}`,
        'Content-Type': 'application/json',
      }
      const startsAt = new Date()
      const endsAt   = new Date(Date.now() + 24 * 60 * 60 * 1000)

      // Check if an ongoing code with this value already exists — if so, skip
      let skipCreate = false
      try {
        const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify({ device_id: gym.seamDeviceId }),
        })
        if (listRes.ok) {
          const { access_codes = [] } = await listRes.json()
          const match = access_codes.find(c => String(c.code).trim() === accessCode)
          if (match && match.type === 'ongoing') skipCreate = true
          if (match && match.type === 'time_bound') {
            // Update to extend the window
            await fetch(`${SEAM_API}/access_codes/update`, {
              method:  'POST',
              headers: seamHeaders,
              body:    JSON.stringify({ access_code_id: match.access_code_id, ends_at: endsAt.toISOString() }),
            })
            skipCreate = true
            console.log('[jotform/guest-pass] extended existing Seam time-bound code for', email)
          }
        }
      } catch (e) {
        console.error('[jotform/guest-pass] Seam list error:', e.message)
      }

      if (!skipCreate) {
        try {
          const seamRes = await fetch(`${SEAM_API}/access_codes/create`, {
            method:  'POST',
            headers: seamHeaders,
            body:    JSON.stringify({
              device_id:  gym.seamDeviceId,
              name:       name || email || 'Guest',
              code:       accessCode,
              type:       'time_bound',
              starts_at:  startsAt.toISOString(),
              ends_at:    endsAt.toISOString(),
            }),
          })
          if (!seamRes.ok) {
            const txt = await seamRes.text()
            console.error('[jotform/guest-pass] Seam create error:', seamRes.status, txt)
          } else {
            console.log('[jotform/guest-pass] Seam time-bound code created for', email, '| code:', accessCode)
          }
        } catch (e) {
          console.error('[jotform/guest-pass] Seam create error:', e.message)
        }
      }
    }

    // ── Notify Zapier (fire-and-forget) ───────────────────────────────────────
    if (gym.zapierGuestWebhookUrl) {
      fetch(gym.zapierGuestWebhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, accessCode, passType }),
      }).catch(e => console.error('[jotform/guest-pass] Zapier error:', e.message))
    }

    return NextResponse.json({ ok: true, accessCode, passType })
  } catch (error) {
    console.error('[jotform/guest-pass POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
