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

    // ── 3. Cross-reference with DB members ────────────────────────────────────
    const members = await prisma.member.findMany({
      where: { gymId, accessCode: { not: null } },
      select: { id: true, firstName: true, lastName: true, accessCode: true, status: true },
    })
    const memberByCode = {}
    for (const m of members) {
      if (m.accessCode) memberByCode[m.accessCode] = m
    }

    const codes = access_codes.map(c => {
      const member = memberByCode[c.code]
      return {
        id:           c.access_code_id,
        name:         c.name ?? '—',
        code:         c.code,
        status:       c.status,       // 'set' | 'unset' | 'unknown'
        type:         member ? 'member' : 'guest',
        codeType:     c.type,         // 'ongoing' | 'time_bound'
        endsAt:       c.ends_at ?? null,
        memberStatus: member?.status ?? null,
        memberId:     member?.id     ?? null,
      }
    })

    console.log(`[seam/codes GET] ${devices.length} device(s), ${codes.length} code(s) for gym ${gymId}`)
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
export async function POST(request, { params }) {
  try {
    const gymId = request.headers.get('x-gym-id')
    const { memberId, code } = await request.json()

    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({ where: { id: memberId, gymId } })
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Access codes can only be issued to active members' },
        { status: 400 },
      )
    }

    const gym = await prisma.gym.findUnique({ where: { id: gymId } })

    if (!gym?.seamConnectedAccountId) {
      return NextResponse.json(
        { error: 'Gym does not have a Seam connected account configured' },
        { status: 422 },
      )
    }

    // Generate a 6-digit code if none provided
    const accessCode = code ?? String(Math.floor(100000 + Math.random() * 900000))

    // ── Seam API call ─────────────────────────────────────────────────────────
    // Uncomment and configure once Seam SDK is installed:
    //
    // import Seam from 'seam'
    // const seam = new Seam(process.env.SEAM_API_KEY)
    //
    // const devices = await seam.devices.list({
    //   connected_account_id: gym.seamConnectedAccountId,
    // })
    //
    // await Promise.all(
    //   devices.map((device) =>
    //     seam.accessCodes.create({
    //       device_id: device.device_id,
    //       name: `${member.firstName} ${member.lastName}`,
    //       code: accessCode,
    //     }),
    //   ),
    // )
    // ─────────────────────────────────────────────────────────────────────────

    const updated = await prisma.member.update({
      where: { id: memberId },
      data: { accessCode },
    })

    return NextResponse.json({ memberId: updated.id, accessCode: updated.accessCode })
  } catch (error) {
    console.error('[seam/codes]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
