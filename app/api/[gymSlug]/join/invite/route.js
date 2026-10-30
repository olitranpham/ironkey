import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyLeadInviteToken } from '@/lib/leadInvite'
import { limitRequest } from '@/lib/rateLimit'

/**
 * GET /api/[gymSlug]/join/invite?token=…
 * Public — the join page exchanges a lead invite token (signed, 30-day, for
 * this gym) for prefill fields. Invalid / expired / other-gym tokens all get
 * the same 404.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const limited = await limitRequest(request, 'join-invite', null)
    if (limited) return limited

    const NOT_FOUND = NextResponse.json({ error: 'invite not found or expired' }, { status: 404 })
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NOT_FOUND

    const verified = verifyLeadInviteToken(new URL(request.url).searchParams.get('token'), gym.id)
    if (!verified) return NOT_FOUND

    const profile = await prisma.guest.findUnique({
      where:  { id: verified.guestProfileId },
      select: { name: true, email: true, phone: true },
    })
    if (!profile?.email) return NOT_FOUND

    const [firstName, ...rest] = (profile.name ?? '').trim().split(/\s+/)
    return NextResponse.json({
      firstName: firstName ?? '',
      lastName:  rest.join(' '),
      email:     profile.email,
      phone:     profile.phone ?? '',
    })
  } catch (error) {
    console.error('[join/invite]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
