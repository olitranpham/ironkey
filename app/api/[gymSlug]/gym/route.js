import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/gym
 * Returns basic gym info for the authenticated gym.
 * Never exposes raw secrets — seamApiKey is returned as a boolean flag.
 */
export async function GET(request) {
  try {
    const gymId = request.headers.get('x-gym-id')

    const gym = await prisma.gym.findUnique({
      where: { id: gymId },
      select: {
        id:                    true,
        name:                  true,
        slug:                  true,
        timezone:              true,
        seamConnectedAccountId: true,
        seamApiKey:            true,
        stripeAccountId:       true,
      },
    })

    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    return NextResponse.json({
      gym: {
        id:       gym.id,
        name:     gym.name,
        slug:     gym.slug,
        timezone: gym.timezone,
        hasSeam:   Boolean(gym.seamApiKey || gym.seamConnectedAccountId),
        hasStripe: Boolean(gym.stripeAccountId),
      },
    })
  } catch (error) {
    console.error('[gym]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
