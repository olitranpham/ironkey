import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { listEvents as listKisiEvents } from '@/lib/kisi'
import { requirePermission } from '@/lib/permissions'
import { redactJsonText } from '@/lib/redact'
import { seamConfig } from '@/lib/seamConfig'

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

// Only real door activity belongs on the dashboard — Seam also fires a stream
// of housekeeping events (code created/deleted/changed/scheduled/removed from
// device, etc.) that aren't things a member or guest did at the door.
// lock.locked/lock.unlocked without an access_code_id are auto-lock state
// changes with no person attached — noise, not activity — so those are only
// kept when a code (and therefore a potential name) is attached to the event.
function isRealDoorActivity(ev) {
  if (ev.event_type === 'lock.access_denied') return true
  if (ev.event_type === 'lock.unlocked' || ev.event_type === 'lock.locked') {
    return Boolean(ev.access_code_id)
  }
  return false
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
    const { errorResponse } = await requirePermission(request, gymSlug, 'door.view')
    if (errorResponse) return errorResponse

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug } })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    if (gym.accessProvider === 'KISI') {
      if (!gym.kisiApiKey || !gym.kisiPlaceId) {
        return NextResponse.json({ events: [] })
      }
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const rawEvents = await listKisiEvents(gym, since)
      // NOTE: field names below (user/actor/event_type/created_at) are a
      // best-effort guess — Kisi's /events response shape wasn't part of
      // the confirmed/tested surface (only auth, users, and
      // role_assignments were verified live). Confirm against a real
      // response before relying on this in production.
      const normalized = rawEvents.slice(0, 50).map(ev => ({
        id:        ev.id ?? ev.event_id,
        name:      ev.user?.name ?? ev.actor?.name ?? '—',
        event:     (ev.event_type ?? ev.type ?? 'unlock').replace(/[._]/g, ' '),
        createdAt: ev.created_at ?? ev.timestamp,
        ok:        true,
      }))
      return NextResponse.json({ events: normalized })
    }

    // The gym's own key + device only — otherwise no lock, no Seam call
    const seam = seamConfig(gym)
    if (!seam) return NextResponse.json({ events: [], noLock: true })
    const { apiKey, deviceId } = seam

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // ── Fetch events ────────────────────────────────────────────────────────
    // Always scoped to the gym's own device
    const eventsBody = { since, device_id: deviceId }

    const eventsRes = await fetch(`${SEAM_API}/events/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify(eventsBody),
    })

    if (!eventsRes.ok) {
      const text = await eventsRes.text()
      console.error('[seam/events] Seam events error:', eventsRes.status, redactJsonText(text))
      return NextResponse.json({ error: 'Seam API error' }, { status: 502 })
    }

    const { events = [] } = await eventsRes.json()

    // ── Resolve member names from access code names ─────────────────────────
    // Seam access codes are created with the member's name as the code name.
    // Fetch all access codes for the connected account once, then build a
    // lookup map:  access_code_id → code name (i.e. member name).
    // access_code_id → 4-digit PIN string
    let codePinById = {}

    const codeIds = [...new Set(events.map((e) => e.access_code_id).filter(Boolean))]

    if (codeIds.length > 0) {
      const codesBody = { device_id: deviceId }

      const codesRes = await fetch(`${SEAM_API}/access_codes/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify(codesBody),
      })

      if (codesRes.ok) {
        const { access_codes = [] } = await codesRes.json()
        for (const code of access_codes) {
          if (codeIds.includes(code.access_code_id) && code.code) {
            codePinById[code.access_code_id] = String(code.code).trim()
          }
        }
      } else {
        console.warn('[seam/events] Could not fetch access codes for name resolution')
      }
    }

    // ── Look up member AND guest names by PIN against DB ────────────────────
    // Access codes are issued to both members (Member.accessCode) and guests
    // (Guest.accessCode) — previously only members were checked, so any event
    // triggered by a guest's code fell through to "unknown".
    const pins = [...new Set(Object.values(codePinById))]
    let nameByPin = {}

    if (pins.length > 0) {
      const [matchedMembers, matchedGuests] = await Promise.all([
        prisma.member.findMany({
          where:  { gymId: gym.id, accessCode: { in: pins } },
          select: { accessCode: true, firstName: true, lastName: true },
        }),
        prisma.guest.findMany({
          where:  { accessCode: { in: pins }, waivers: { some: { gymId: gym.id } } },
          select: { accessCode: true, name: true },
        }),
      ])
      for (const m of matchedMembers) {
        // Normalize key so it matches the pin strings built from Seam codes
        const key = String(m.accessCode ?? '').trim()
        if (key) nameByPin[key] = `${m.firstName} ${m.lastName}`.trim()
      }
      for (const g of matchedGuests) {
        const key = String(g.accessCode ?? '').trim()
        if (key && !nameByPin[key]) nameByPin[key] = g.name
      }
    }

    // ── Normalise events for the dashboard ──────────────────────────────────
    // Filter to real door activity first, then slice — otherwise a burst of
    // Seam housekeeping events (code created/changed/scheduled/removed, etc.)
    // could crowd out actual entries/locks/unlocks within the last 50 events.
    const normalized = events
      .filter(isRealDoorActivity)
      .slice(0, 50)
      .map((ev) => {
        const pin  = codePinById[ev.access_code_id]   // already trimmed string
        const name = (pin && nameByPin[pin]) || (ev.access_code_id ? 'unknown' : null)
        return {
          id:        ev.event_id,
          name:      name || '—',
          event:     eventLabel(ev.event_type, Boolean(ev.access_code_id)),
          createdAt: ev.created_at,
          ok:        isOkEvent(ev.event_type),
        }
      })

    return NextResponse.json({ events: normalized })
  } catch (error) {
    console.error('[seam/events]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
