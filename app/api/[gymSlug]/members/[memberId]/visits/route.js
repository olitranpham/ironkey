import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

/**
 * GET /api/[gymSlug]/members/[memberId]/visits
 *
 * Returns every door-entry event tied to a member's access code PIN, most
 * recent first, no limit. An "entry" is a `lock.unlocked` event carrying an
 * `access_code_id` — confirmed against live Seam data that this integration
 * has no `lock.access_granted` event type; successful code-based unlocks
 * come through as `lock.unlocked` with `method: "keycode"`.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = await params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where:  { id: memberId },
      select: { id: true, gymId: true, accessCode: true },
    })
    if (!member || member.gymId !== gym.id) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (!member.accessCode) {
      return NextResponse.json({ visits: [] })
    }

    const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? null   // no env fallback — must be gym-specific
    if (!apiKey || (!deviceId && !gym.seamConnectedAccountId)) {
      return NextResponse.json({ visits: [] })
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }
    // Scope by device ID if the gym has one, otherwise by connected account —
    // same convention as /api/[gymSlug]/seam/events.
    const scopeBody = deviceId
      ? { device_id: deviceId }
      : { connected_account_id: gym.seamConnectedAccountId }

    // ── Find the access_code_id matching this member's PIN ──────────────────
    const codesRes = await fetch(`${SEAM_API}/access_codes/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify(scopeBody),
    })
    if (!codesRes.ok) {
      console.error('[members/visits] access_codes/list failed:', codesRes.status, await codesRes.text())
      return NextResponse.json({ visits: [] })
    }
    const { access_codes = [] } = await codesRes.json()
    const pin = String(member.accessCode).trim()
    const matchedCode = access_codes.find((c) => String(c.code ?? '').trim() === pin)
    if (!matchedCode) {
      return NextResponse.json({ visits: [] })
    }

    // ── Fetch every entry event for that access code ─────────────────────────
    // Seam requires `since` (or `between`) on every /events/list call — go back
    // far enough that this effectively returns full history within whatever
    // retention window Seam itself keeps, satisfying "no limit on entries".
    const since = new Date('2020-01-01T00:00:00Z').toISOString()
    const eventsRes = await fetch(`${SEAM_API}/events/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...scopeBody,
        since,
        access_code_id: matchedCode.access_code_id,
        event_type: 'lock.unlocked',
      }),
    })
    if (!eventsRes.ok) {
      console.error('[members/visits] events/list failed:', eventsRes.status, await eventsRes.text())
      return NextResponse.json({ visits: [] })
    }
    const { events = [] } = await eventsRes.json()

    const visits = events
      .map((ev) => ({ id: ev.event_id, createdAt: ev.created_at }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    return NextResponse.json({ visits })
  } catch (error) {
    console.error('[members/visits GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
