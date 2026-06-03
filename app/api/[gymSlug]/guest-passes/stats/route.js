import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/guest-passes/stats
 * Returns monthly guest pass counts from the first purchase date to now.
 * Only counts passes where usedAt is not null.
 * Requires JWT (staff portal endpoint).
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const passes = await prisma.guestVisit.findMany({
      where:  { gymId: gym.id, usedAt: { not: null } },
      select: { usedAt: true },
    })

    if (!passes.length) {
      return NextResponse.json({ data: [] })
    }

    // Group by YYYY-MM using usedAt
    const counts = {}
    for (const p of passes) {
      const d   = new Date(p.usedAt)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      counts[key] = (counts[key] ?? 0) + 1
    }

    // Fill every month from earliest to now so the chart has no gaps
    const keys   = Object.keys(counts).sort()
    const first  = keys[0].split('-').map(Number)
    const now    = new Date()
    const endKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

    const data = []
    let y = first[0], m = first[1]
    while (true) {
      const key    = `${y}-${String(m).padStart(2, '0')}`
      const label  = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }).toLowerCase()
      data.push({ month: label, passes: counts[key] ?? 0 })
      if (key === endKey) break
      m++
      if (m > 12) { m = 1; y++ }
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[guest-passes/stats GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
