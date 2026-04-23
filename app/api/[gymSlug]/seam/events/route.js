import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

// Human-readable label for each Seam event type
function eventLabel(type, hasCode) {
  switch (type) {
    case 'lock.unlocked':        return hasCode ? 'entered' : 'unlocked'
    case 'lock.locked':          return 'locked'
    case 'lock.access_denied':   return 'access denied'
    case 'device.connected':     return 'device online'
    case 'device.disconnected':  return 'device offline'
    case 'device.tampered':      return 'device tampered'
    case 'access_code.created':  return 'code created'
    case 'access_code.deleted':  return 'code deleted'
    case 'access_code.failed':   return 'code failed'
    default:                     return type.replace(/[._]/g, ' ')
  }
}

function isOkEvent(type) {
  return !['lock.access_denied', 'access_code.failed', 'device.tampered', 'device.disconnected'].includes(type)
}

/**
 * GET /api/[gymSlug]/seam/events
 *
 * Returns the last 24 h of Seam door events for the gym, with member names
 * resolved from the access code name stored on each code in Seam.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug } })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
    if (!apiKey) {
      return NextResponse.json({ error: 'Seam API key not configured' }, { status: 422 })
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // ── Fetch events ────────────────────────────────────────────────────────
    // Scope by device ID if the gym has one, otherwise by connected account.
    const eventsBody = { since }
    if (deviceId) {
      eventsBody.device_id = deviceId
    } else if (gym.seamConnectedAccountId) {
      eventsBody.connected_account_id = gym.seamConnectedAccountId
    }

    const eventsRes = await fetch(`${SEAM_API}/events/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify(eventsBody),
    })

    if (!eventsRes.ok) {
      const text = await eventsRes.text()
      console.error('[seam/events] Seam events error:', eventsRes.status, text)
      return NextResponse.json({ error: 'Seam API error' }, { status: 502 })
    }

    const { events = [] } = await eventsRes.json()

    // ── Resolve member names from access code names ─────────────────────────
    // Seam access codes are created with the member's name as the code name.
    // Fetch all access codes for the connected account once, then build a
    // lookup map:  access_code_id → code name (i.e. member name).
    let codeNameById = {}

    const codeIds = [...new Set(events.map((e) => e.access_code_id).filter(Boolean))]

    if (codeIds.length > 0) {
      // Scope code lookup the same way events were scoped
      const codesBody = deviceId
        ? { device_id: deviceId }
        : gym.seamConnectedAccountId
          ? { connected_account_id: gym.seamConnectedAccountId }
          : {}

      const codesRes = await fetch(`${SEAM_API}/access_codes/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify(codesBody),
      })

      if (codesRes.ok) {
        const { access_codes = [] } = await codesRes.json()
        for (const code of access_codes) {
          if (codeIds.includes(code.access_code_id)) {
            codeNameById[code.access_code_id] = code.name ?? null
          }
        }
      } else {
        console.warn('[seam/events] Could not fetch access codes for name resolution')
      }
    }

    // ── Normalise events for the dashboard ──────────────────────────────────
    const normalized = events.slice(0, 50).map((ev) => ({
      id:        ev.event_id,
      name:      codeNameById[ev.access_code_id] || '—',
      event:     eventLabel(ev.event_type, Boolean(ev.access_code_id)),
      createdAt: ev.created_at,
      ok:        isOkEvent(ev.event_type),
    }))

    return NextResponse.json({ events: normalized })
  } catch (error) {
    console.error('[seam/events]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
