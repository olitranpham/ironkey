import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { generateUniqueAccessCode, createLockCode } from '@/lib/seam'
import { isPinTaken, PIN_IN_USE_ERROR } from '@/lib/pins'
import { requirePermission } from '@/lib/permissions'
import { maskPin, redactJsonText } from '@/lib/redact'
import { writeAudit } from '@/lib/audit'

const SEAM_API = 'https://connect.getseam.com'

/**
 * GET /api/[gymSlug]/seam/codes
 * Lists all access codes across all Seam devices for the gym.
 * Strategy: list devices first (required by Seam API), then fetch codes per device.
 * Cross-references with DB members to add type and memberId:
 *   member  — PIN or name matches a member at this gym
 *   guest   — PIN matches a guest profile with a waiver or a pass at this gym
 *   unknown — matches nothing (code name if any, full PIN, created date)
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { errorResponse } = await requirePermission(request, gymSlug, 'door.view')
    if (errorResponse) return errorResponse

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const apiKey   = gym.seamApiKey ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

    console.log(
      '[seam/codes GET] slug=%s gymId=%s seamDeviceId(db)=%j seamApiKey(db)=%s deviceId(resolved)=%j apiKey(resolved)=%s',
      gymSlug, gym.id,
      gym.seamDeviceId,
      gym.seamApiKey ? '(set)' : 'null',
      deviceId,
      apiKey ? '(set)' : 'null',
    )

    if (!apiKey) return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })

    const seamHeaders = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // ── 1. List devices ───────────────────────────────────────────────────────
    // If the gym has a specific device ID configured, scope to that device only.
    // Otherwise list all devices for the connected account.
    let devices = []

    if (deviceId) {
      devices = [{ device_id: deviceId }]
    } else {
      const devicesRes = await fetch(`${SEAM_API}/devices/list`, {
        method: 'POST',
        headers: seamHeaders,
        body: JSON.stringify(
          gym.seamConnectedAccountId
            ? { connected_account_id: gym.seamConnectedAccountId }
            : {},
        ),
      })

      if (!devicesRes.ok) {
        const text = await devicesRes.text()
        console.error('[seam/codes GET] devices error:', devicesRes.status, redactJsonText(text))
        return NextResponse.json({ error: 'Seam API error fetching devices' }, { status: 502 })
      }

      const body = await devicesRes.json()
      devices = body.devices ?? []
    }

    if (devices.length === 0) {
      return NextResponse.json({ codes: [] })
    }

    // ── 2. Fetch access codes per device ──────────────────────────────────────
    const codeResults = await Promise.all(
      devices.map(async device => {
        const r = await fetch(`${SEAM_API}/access_codes/list`, {
          method: 'POST',
          headers: seamHeaders,
          body: JSON.stringify({ device_id: device.device_id }),
        }).catch(e => { console.error('[seam/codes GET] fetch error for device', device.device_id, e.message); return null })

        if (!r) return []
        if (!r.ok) {
          const text = await r.text().catch(() => '')
          console.error('[seam/codes GET] access_codes/list failed for device', device.device_id, r.status, redactJsonText(text))
          return []
        }
        const body = await r.json().catch(() => ({}))
        console.log('[seam/codes GET] device %s returned %d code(s)', device.device_id, (body.access_codes ?? []).length)
        return body.access_codes ?? []
      })
    )

    // Deduplicate by access_code_id (same code can appear on multiple devices)
    const seen = new Set()
    const access_codes = codeResults.flat().filter(c => {
      if (seen.has(c.access_code_id)) return false
      seen.add(c.access_code_id)
      return true
    })

    // ── 3. Cross-reference with DB members and guest profiles ───────────────
    const gymId = gym.id
    const [members, guestProfiles] = await Promise.all([
      prisma.member.findMany({
        where: { gymId },
        select: { id: true, firstName: true, lastName: true, accessCode: true, status: true },
      }),
      prisma.guest.findMany({
        where: {
          accessCode: { not: null },
          OR: [{ waivers: { some: { gymId } } }, { passes: { some: { gymId } } }],
        },
        select: { id: true, name: true, accessCode: true },
      }),
    ])

    // Build guest code lookup — PIN takes priority over member name matching
    const guestByCode = new Map(guestProfiles.map(g => [String(g.accessCode).trim(), g]))

    // Normalize a name: lowercase, collapse whitespace, drop middle initials
    function normalizeName(name) {
      const words = (name ?? '').toLowerCase().trim().split(/\s+/)
      return words
        .filter((w, i) => {
          if (i === 0 || i === words.length - 1) return true   // always keep first & last
          return !/^[a-z]\.?$/.test(w)                         // drop single-letter middle initials
        })
        .join(' ')
    }

    // Manual overrides — names whose Seam code name doesn't match the DB spelling
    const MEMBER_NAME_OVERRIDES = new Set([
      'jingy bingy',
      'heidi siegler',
      'logan sras',
      'richman chea',
      'sean verrier',
      'megan duong',
    ])

    // Build lookup maps
    const memberByCode      = {}
    const memberByFullName  = {}
    const memberByFirstName = {}  // only populated when first name is unambiguous
    const memberByLastName  = {}  // only populated when last name is unambiguous

    for (const m of members) {
      if (m.accessCode) memberByCode[String(m.accessCode).trim()] = m

      const fullKey  = normalizeName(`${m.firstName} ${m.lastName}`)
      const firstKey = m.firstName.toLowerCase().trim()
      const lastKey  = m.lastName?.toLowerCase().trim()

      if (fullKey)  memberByFullName[fullKey] = m

      // First-name index: null means ambiguous (multiple members share it)
      if (firstKey) {
        memberByFirstName[firstKey] = memberByFirstName[firstKey] === undefined
          ? m
          : null   // collision — mark ambiguous
      }

      // Last-name index: same ambiguity guard
      if (lastKey) {
        memberByLastName[lastKey] = memberByLastName[lastKey] === undefined
          ? m
          : null
      }
    }

    const codes = access_codes.map(c => {
      // 0. If PIN matches a guest profile — always classify as guest
      const guest = c.code ? guestByCode.get(String(c.code).trim()) : undefined
      if (guest) {
        return {
          id:           c.access_code_id,
          name:         guest.name || c.name || '—',
          code:         c.code,
          status:       c.status,
          type:         'guest',
          codeType:     c.type,
          endsAt:       c.ends_at ?? null,
          memberStatus: null,
          memberId:     null,
        }
      }

      // 1. Match by PIN (exact)
      let member = c.code ? memberByCode[String(c.code).trim()] : undefined

      if (!member && c.name) {
        const seamName  = normalizeName(c.name)
        const seamWords = seamName.split(' ')

        // 2. Full normalized name match ("Brian Elderd" → "brian elderd")
        member = memberByFullName[seamName]

        // 3. First name only (Seam code is a single word like "Brian")
        if (!member && seamWords.length === 1) {
          member = memberByFirstName[seamWords[0]] ?? undefined
        }

        // 4. Seam has two+ words but full match failed — try first word as first name
        //    and last word as last name independently (catches reversed or partial names)
        if (!member && seamWords.length >= 2) {
          const byFirst = memberByFirstName[seamWords[0]]
          const byLast  = memberByLastName[seamWords[seamWords.length - 1]]
          // Only use if both point to the same unambiguous member
          if (byFirst && byFirst === byLast) member = byFirst
          // Or if only one side matches unambiguously
          else if (byFirst) member = byFirst
          else if (byLast)  member = byLast
        }
      }

      // 5. Manual override — force to member type even without a DB match
      const isOverride = c.name && MEMBER_NAME_OVERRIDES.has(c.name.toLowerCase().trim())

      // Log unresolved codes so we can diagnose new-member mismatches
      if (!member && !isOverride) {
        console.log(
          '[seam/codes] UNRESOLVED code — seamName=%j seamPin=%j pinInDB=%s nameInDB=%s',
          c.name ?? null,
          c.code ?? null,
          c.code ? (memberByCode[String(c.code).trim()] ? 'matched' : 'no match') : 'no pin',
          c.name ? (memberByFullName[normalizeName(c.name)] ? 'full-name matched' : 'no full-name match') : 'no name',
        )
      }

      // Matches no member or guest — staff review it, never assume a guest
      if (!member && !isOverride) {
        return {
          id:           c.access_code_id,
          name:         c.name?.trim() || 'unknown code',
          codeName:     c.name?.trim() || null,
          code:         c.code,
          createdAt:    c.created_at ?? null,
          status:       c.status,
          type:         'unknown',
          codeType:     c.type,
          endsAt:       c.ends_at ?? null,
          memberStatus: null,
          memberId:     null,
        }
      }

      const dbName = member ? `${member.firstName} ${member.lastName}`.trim() : null
      return {
        id:           c.access_code_id,
        name:         dbName || c.name || '—',
        code:         c.code,
        status:       c.status,       // 'set' | 'unset' | 'unknown'
        type:         'member',
        codeType:     c.type,         // 'ongoing' | 'time_bound'
        endsAt:       c.ends_at ?? null,
        memberStatus: member?.status ?? null,
        memberId:     member?.id     ?? null,
      }
    })

    const memberCodeCount = codes.filter(c => c.type === 'member').length
    const guestCodeCount  = codes.filter(c => c.type === 'guest').length
    const unknownCount    = codes.filter(c => c.type === 'unknown').length
    console.log(`[seam/codes GET] ${devices.length} device(s), ${codes.length} total code(s) — ${memberCodeCount} member, ${guestCodeCount} guest, ${unknownCount} unknown (${members.length} members with codes in DB)`)

    // ── Background sync: write Seam codes back to Member.accessCode ───────────
    // Collect updates for member codes whose DB accessCode is missing or stale.
    // These are always name matches (a PIN match already equals the DB code),
    // so a PIN that belongs to another member or a guest at this gym is never
    // written — logged as a conflict for staff instead.
    // Fire-and-forget so the response is never delayed.
    const syncUpdates = codes
      .filter(c => c.memberId && c.code)
      .map(c => {
        const m = members.find(m => m.id === c.memberId)
        const pin = String(c.code).trim()
        if (!m || m.accessCode === pin) return null
        const pinOwner = memberByCode[pin]
        if ((pinOwner && pinOwner.id !== m.id) || guestByCode.has(pin)) {
          console.warn('[seam/codes sync] conflict — lock code "%s" %s matched member %s by name, but that PIN belongs to %s %s; not written',
            c.name, maskPin(pin), m.id, pinOwner ? 'member' : 'guest', pinOwner ? pinOwner.id : guestByCode.get(pin).id)
          return null
        }
        return { id: c.memberId, code: pin, name: c.name }
      })
      .filter(Boolean)

    // HOTFIX: writes disabled — name matching was overwriting members' PINs
    // with other people's codes. Log what would have been written instead.
    for (const u of syncUpdates) {
      console.warn('[seam/codes sync] would write (disabled) %s → member %s (lock code "%s")', maskPin(u.code), u.id, u.name)
    }

    return NextResponse.json({ codes })
  } catch (error) {
    console.error('[seam/codes GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/[gymSlug]/seam/codes
 * Body: { memberId, code? }
 *
 * Sets or generates a Seam access code for a member.
 * Calls the Seam API to program the code onto the gym's smart lock(s).
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'door.manage')
    if (errorResponse) return errorResponse
    const { memberId, codeId, code } = await request.json()

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findFirst({ where: { id: memberId, gymId: gym.id } })
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Access codes can only be issued to active members' },
        { status: 400 },
      )
    }

    const apiKey   = gym.seamApiKey ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
    if (!apiKey) {
      return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })
    }

    // A code explicitly supplied by the caller must not collide with any
    // member, guest or partner code, or any code on the lock, at this gym
    // (this member's own is fine).
    if (code && String(code).trim() !== member.accessCode && await isPinTaken(gym.id, code, { memberId })) {
      return NextResponse.json({ error: PIN_IN_USE_ERROR }, { status: 409 })
    }

    // Generate a 4-digit code if none provided — checked for collisions
    // against this gym's member/guest/partner codes and whatever's currently
    // active on Seam.
    let accessCode = code || await generateUniqueAccessCode({
      prisma, gymId: gym.id, apiKey, deviceId, logPrefix: '[seam/codes POST]',
    })

    const seamHeaders = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // ── Update existing Seam code ─────────────────────────────────────────────
    if (codeId) {
      const seamRes = await fetch(`${SEAM_API}/access_codes/update`, {
        method:  'POST',
        headers: seamHeaders,
        body:    JSON.stringify({ access_code_id: codeId, code: accessCode }),
      })
      if (!seamRes.ok) {
        const text = await seamRes.text()
        console.error('[seam/codes POST] update error:', seamRes.status, redactJsonText(text))
        return NextResponse.json({ error: 'Failed to update code on lock' }, { status: 502 })
      }
    } else {
      // ── Create new code on device(s) ──────────────────────────────────────
      let devices = []

      if (deviceId) {
        devices = [{ device_id: deviceId }]
      } else {
        const devicesRes = await fetch(`${SEAM_API}/devices/list`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify(
            gym.seamConnectedAccountId
              ? { connected_account_id: gym.seamConnectedAccountId }
              : {},
          ),
        })
        if (devicesRes.ok) {
          const body = await devicesRes.json()
          devices = body.devices ?? []
        }
      }

      // A generated PIN that turns out to be on the lock already is retried
      // with a fresh one; a PIN staff typed in is never swapped — rejected.
      const result = await createLockCode({
        apiKey, deviceIds: devices.map(d => d.device_id), gymId: gym.id,
        pin: accessCode, name: `${member.firstName} ${member.lastName}`,
        allowNewPin: !code, logPrefix: '[seam/codes POST]',
      })
      if (result.duplicate) return NextResponse.json({ error: PIN_IN_USE_ERROR }, { status: 409 })
      accessCode = result.pin
    }

    const updated = await prisma.member.update({
      where: { id: memberId },
      data:  { accessCode },
    })

    writeAudit(ctx, 'door.code.create', 'Member', updated.id, { seamCodeId: codeId ?? null })
    return NextResponse.json({ memberId: updated.id, accessCode: updated.accessCode })
  } catch (error) {
    console.error('[seam/codes POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
