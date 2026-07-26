import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/hydra-athletic-co/concessions/items
 * Public — returns Hydra's gym info + all sellable concession items
 * (inventory items that have a stripeProductId set).
 */
export async function GET() {
  try {
    const gym = await prisma.gym.findUnique({
      where:  { slug: 'hydra-athletic-co' },
      select: { name: true, logoUrl: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const items = await prisma.inventoryItem.findMany({
      where: {
        gym:             { slug: 'hydra-athletic-co' },
        stripeProductId: { not: null },
      },
      select: {
        id:              true,
        name:            true,
        price:           true,
        quantity:        true,
        stripeProductId: true,
      },
      orderBy: { name: 'asc' },
    })

    console.log('[concessions/items GET] gym:', JSON.stringify(gym), '| items:', JSON.stringify(items))

    return NextResponse.json({ gym, items })
  } catch (error) {
    console.error('[concessions/items GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
