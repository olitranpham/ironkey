import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/members/[memberId]/events
 * Returns membership history events for a single member, newest first.
 */
export async function GET(request, { params }) {
  try {
    const gymId        = request.headers.get('x-gym-id')
    const { memberId } = params

    const events = await prisma.membershipEvent.findMany({
      where:   { memberId, gymId },
      orderBy: { date: 'desc' },
      select:  { id: true, type: true, date: true },
    })

    return NextResponse.json({ events })
  } catch (error) {
    console.error('[members/events GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
