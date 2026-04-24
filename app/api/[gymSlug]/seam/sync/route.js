import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

/**
 * POST /api/[gymSlug]/seam/sync
 * Matches Seam access codes to members by full name and writes the code
 * back to Member.accessCode for any member that doesn't already have one stored.
 *
 * Returns: { synced: N, skipped: N, errors: [...] }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym)             return NextResponse.json({ error: 'Gym not found' },          { status: 404 })
    if (!gym.seamApiKey)  return NextResponse.json({ error: 'Seam not configured' },    { status: 400 })

    const seamHeaders = {
      Authorization:  `Bearer ${gym.seamApiKey}`,
      'Content-Type': 'application/json',
    }

    // Fetch Seam codes for this device
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
    const body     = deviceId ? { device_id: deviceId } : {}
    const seamRes  = await fetch(`${SEAM_API}/access_codes/list`, {
      method: 'POST', headers: seamHeaders, body: JSON.stringify(body),
    })
    if (!seamRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch Seam codes' }, { status: 502 })
    }
    const { access_codes = [] } = await seamRes.json()

    // Only process ongoing (non-time-bound / permanent) codes — these are member codes
    const memberCodes = access_codes.filter(c => c.type !== 'time_bound' && c.code && c.name)

    // Load all members for this gym
    const members = await prisma.member.findMany({
      where:  { gymId: gym.id },
      select: { id: true, firstName: true, lastName: true, accessCode: true },
    })

    // Build two lookup maps:
    //   byFullName: "firstname lastname" → member   (primary)
    //   byFirstName: "firstname"         → member   (fallback — only used when unique)
    const byFullName  = new Map(
      members.map(m => [`${m.firstName} ${m.lastName}`.toLowerCase().trim(), m])
    )

    // Only add a first-name entry if that first name belongs to exactly one member
    const firstNameCount = new Map()
    for (const m of members) {
      const key = m.firstName.toLowerCase().trim()
      firstNameCount.set(key, (firstNameCount.get(key) ?? 0) + 1)
    }
    const byFirstName = new Map(
      members
        .filter(m => firstNameCount.get(m.firstName.toLowerCase().trim()) === 1)
        .map(m => [m.firstName.toLowerCase().trim(), m])
    )

    let synced  = 0
    let skipped = 0
    const errors    = []
    const unmatched = []

    for (const seamCode of memberCodes) {
      const seamName = seamCode.name.trim()
      const key      = seamName.toLowerCase()

      // 1. Full name match
      let member = byFullName.get(key)

      // 2. First-name-only fallback (first word of the Seam code name)
      if (!member) {
        const firstWord = key.split(/\s+/)[0]
        member = byFirstName.get(firstWord)
        if (member) {
          console.log(`[seam/sync] first-name fallback: "${seamName}" → ${member.firstName} ${member.lastName}`)
        }
      }

      if (!member) {
        unmatched.push(seamName)
        skipped++
        continue
      }

      // Already in sync
      if (member.accessCode === String(seamCode.code)) {
        skipped++
        continue
      }

      try {
        await prisma.member.update({
          where: { id: member.id },
          data:  { accessCode: String(seamCode.code) },
        })
        synced++
        console.log(`[seam/sync] wrote code ${seamCode.code} → member "${member.firstName} ${member.lastName}" (matched via "${seamName}")`)
      } catch (err) {
        errors.push(`${seamName}: ${err.message}`)
      }
    }

    if (unmatched.length) {
      console.warn(`[seam/sync] no member match for ${unmatched.length} Seam code(s):`, unmatched)
    }

    console.log(`[seam/sync] done — synced=${synced} skipped=${skipped} unmatched=${unmatched.length} errors=${errors.length} gym=${gymSlug}`)
    return NextResponse.json({ synced, skipped, unmatched, errors })
  } catch (error) {
    console.error('[seam/sync POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
