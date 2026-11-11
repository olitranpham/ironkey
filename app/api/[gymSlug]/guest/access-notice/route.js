import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { accessWindow, accessNotice } from '@/lib/accessHours'

/**
 * GET /api/[gymSlug]/guest/access-notice
 * Public — polled by the guest checkout page. { notice } is set when a pass
 * bought right now would get a later code window (outside the gym's access
 * hours or after its last entry), computed from the gym's settings and the
 * server clock; null otherwise (and always for 24/7 gyms).
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { name: true, timezone: true, accessHoursStart: true, accessHoursEnd: true, accessLastEntry: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const now = new Date()
    const { endsAt } = accessWindow(gym, now)
    return NextResponse.json({ notice: accessNotice(gym, { at: now, endsAt }) })
  } catch (error) {
    console.error('[guest/access-notice]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
