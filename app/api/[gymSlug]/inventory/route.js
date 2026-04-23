import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

function itemStatus(quantity, lowStockAt) {
  if (quantity === 0)           return 'out'
  if (quantity <= lowStockAt)   return 'low'
  return 'ok'
}

export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const items = await prisma.inventoryItem.findMany({
      where:   { gymId: gym.id },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      items: items.map(i => ({ ...i, status: itemStatus(i.quantity, i.lowStockAt) })),
    })
  } catch (error) {
    console.error('[inventory GET] message:', error?.message)
    console.error('[inventory GET] stack:',   error?.stack)
    console.error('[inventory GET] full:',    error)
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()
    const { name, category, quantity, lowStockAt, unitCost, notes } = body

    if (!name?.trim() || !category) {
      return NextResponse.json({ error: 'name and category are required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const item = await prisma.inventoryItem.create({
      data: {
        gymId:      gym.id,
        name:       name.trim(),
        category,
        quantity:   Math.max(0, parseInt(quantity ?? 0)),
        lowStockAt: Math.max(0, parseInt(lowStockAt ?? 5)),
        unitCost:   unitCost ? parseFloat(unitCost) : null,
        notes:      notes?.trim() || null,
      },
    })

    return NextResponse.json({ item: { ...item, status: itemStatus(item.quantity, item.lowStockAt) } }, { status: 201 })
  } catch (error) {
    console.error('[inventory POST] message:', error?.message)
    console.error('[inventory POST] stack:',   error?.stack)
    console.error('[inventory POST] full:',    error)
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 })
  }
}
