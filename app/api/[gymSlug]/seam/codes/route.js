import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

/**
 * GET /api/[gymSlug]/seam/codes
 * Lists all access codes across all Seam devices for the gym.
 * Strategy: list devices first (required by Seam API), then fetch codes per device.
 * Cross-references with DB members to add type (member vs guest) and memberId.
 */
export async function GET(request) {
  try {
    const gymId = request.headers.get('x-gym-id')

    const gym = await prisma.gym.findUnique({ where: { id: gymId } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const apiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })

    const seamHeaders = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // ── 1. List devices ───────────────────────────────────────────────────────
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
      console.error('[seam/codes GET] devices error:', devicesRes.status, text)
      return NextResponse.json({ error: 'Seam API error fetching devices' }, { status: 502 })
    }

    const { devices = [] } = await devicesRes.json()

    if (devices.length === 0) {
      return NextResponse.json({ codes: [] })
    }

    // ── 2. Fetch access codes per device ──────────────────────────────────────
    const codeResults = await Promise.all(
      devices.map(device =>
        fetch(`${SEAM_API}/access_codes/list`, {
          method: 'POST',
          headers: seamHeaders,
          body: JSON.stringify({ device_id: device.device_id }),
        })
          .then(r => r.ok ? r.json() : { access_codes: [] })
          .then(body => body.access_codes ?? [])
          .catch(() => [])
      )
    )

    // Deduplicate by access_code_id (same code can appear on multiple devices)
    const seen = new Set()
    const access_codes = codeResults.flat().filter(c => {
      if (seen.has(c.access_code_id)) return false
      seen.add(c.access_code_id)
      return true
    })

    // ── 3. Cross-reference with DB members and guest profiles ───────────────
    const [members, guestProfiles] = await Promise.all([
      prisma.member.findMany({
        where: { gymId },
        select: { id: true, firstName: true, lastName: true, accessCode: true, status: true },
      }),
      prisma.guestProfile.findMany({
        where: { gymId, accessCode: { not: null } },
        select: { id: true, accessCode: true },
      }),
    ])

    // Build guest code lookup — PIN takes priority over member name matching
    const guestCodeSet = new Set(guestProfiles.map(g => String(g.accessCode).trim()))

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
      const isGuest = c.code && guestCodeSet.has(String(c.code).trim())
      if (isGuest) {
        return {
          id:           c.access_code_id,
          name:         c.name ?? '—',
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

      return {
        id:           c.access_code_id,
        name:         c.name ?? '—',
        code:         c.code,
        status:       c.status,       // 'set' | 'unset' | 'unknown'
        type:         (member || isOverride) ? 'member' : 'guest',
        codeType:     c.type,         // 'ongoing' | 'time_bound'
        endsAt:       c.ends_at ?? null,
        memberStatus: member?.status ?? null,
        memberId:     member?.id     ?? null,
      }
    })

    const memberCodeCount = codes.filter(c => c.type === 'member').length
    const guestCodeCount  = codes.filter(c => c.type === 'guest').length
    console.log(`[seam/codes GET] ${devices.length} device(s), ${codes.length} total code(s) — ${memberCodeCount} member, ${guestCodeCount} guest (${members.length} members with codes in DB)`)
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
 *
 * Requires SEAM_API_KEY in env.
 */
export async function POST(request) {
  try {
    const gymId = request.headers.get('x-gym-id')
    const { memberId, codeId, code } = await request.json()

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

    const [member, gym] = await Promise.all([
      prisma.member.findFirst({ where: { id: memberId, gymId } }),
      prisma.gym.findUnique({ where: { id: gymId } }),
    ])

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Access codes can only be issued to active members' },
        { status: 400 },
      )
    }

    const apiKey = gym?.seamApiKey ?? process.env.SEAM_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })
    }

    // Generate a 4-digit code if none provided
    const accessCode = code || String(Math.floor(1000 + Math.random() * 9000))

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
        console.error('[seam/codes POST] update error:', seamRes.status, text)
        return NextResponse.json({ error: 'Failed to update code on lock' }, { status: 502 })
      }
    } else {
      // ── Create new code on all devices ────────────────────────────────────
      const devicesRes = await fetch(`${SEAM_API}/devices/list`, {
        method:  'POST',
        headers: seamHeaders,
        body:    JSON.stringify(
          gym?.seamConnectedAccountId
            ? { connected_account_id: gym.seamConnectedAccountId }
            : {},
        ),
      })
      if (devicesRes.ok) {
        const { devices = [] } = await devicesRes.json()
        await Promise.all(
          devices.map(device =>
            fetch(`${SEAM_API}/access_codes/create`, {
              method:  'POST',
              headers: seamHeaders,
              body:    JSON.stringify({
                device_id: device.device_id,
                name:      `${member.firstName} ${member.lastName}`,
                code:      accessCode,
              }),
            }).catch(() => null)
          )
        )
      }
    }

    const updated = await prisma.member.update({
      where: { id: memberId },
      data:  { accessCode },
    })

    return NextResponse.json({ memberId: updated.id, accessCode: updated.accessCode })
  } catch (error) {
    console.error('[seam/codes POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
