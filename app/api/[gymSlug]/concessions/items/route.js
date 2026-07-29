import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/concessions/items
 * Public — returns the gym's info + all concessions/merchandise inventory
 * items. Items without a price or stripeProductId are still returned so
 * members can see them on the menu, but the frontend marks them unavailable
 * for purchase.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, logoUrl: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const items = await prisma.inventoryItem.findMany({
      where: {
        gymId:    gym.id,
        category: { in: ['concessions', 'merchandise'], mode: 'insensitive' },
      },
      select: {
        id:              true,
        name:            true,
        category:        true,
        sectionLabel:    true,
        price:           true,
        quantity:        true,
        stripeProductId: true,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ gym: { name: gym.name, logoUrl: gym.logoUrl }, items })
  } catch (error) {
    console.error('[concessions/items GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
