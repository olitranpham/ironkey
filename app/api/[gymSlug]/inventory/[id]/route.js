import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

function itemStatus(quantity, lowStockAt) {
  if (quantity === 0)         return 'out'
  if (quantity <= lowStockAt) return 'low'
  return 'ok'
}

async function getItem(gymSlug, id) {
  const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
  if (!gym) return { gym: null, item: null }
  const item = await prisma.inventoryItem.findUnique({ where: { id } })
  if (!item || item.gymId !== gym.id) return { gym, item: null }
  return { gym, item }
}

/**
 * PATCH /api/[gymSlug]/inventory/[id]
 *
 * Two modes:
 *  - Quantity adjustment: body = { adjust: number, reason: string }
 *    Logs the change to InventoryLog.
 *  - Full update:         body = { name, category, quantity, lowStockAt, unitCost, notes }
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, id } = await params
    const { gym, item } = await getItem(gymSlug, id)
    if (!gym)  return NextResponse.json({ error: 'Gym not found' },  { status: 404 })
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    const body = await request.json()

    // ── Quantity adjustment (sell / restock) ──────────────────────────────────
    if ('adjust' in body) {
      const change      = parseInt(body.adjust)
      const newQuantity = Math.max(0, item.quantity + change)

      const [updated] = await prisma.$transaction([
        prisma.inventoryItem.update({
          where: { id },
          data:  { quantity: newQuantity },
        }),
        prisma.inventoryLog.create({
          data: {
            gymId:  gym.id,
            itemId: id,
            change,
            reason: body.reason ?? 'manual',
          },
        }),
      ])

      return NextResponse.json({ item: { ...updated, status: itemStatus(updated.quantity, updated.lowStockAt) } })
    }

    // ── Full item update ──────────────────────────────────────────────────────
    const { name, category, quantity, lowStockAt, unitCost, notes } = body
    const updated = await prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(name       !== undefined ? { name: name.trim() }                     : {}),
        ...(category   !== undefined ? { category }                              : {}),
        ...(quantity   !== undefined ? { quantity:   Math.max(0, parseInt(quantity)) }   : {}),
        ...(lowStockAt !== undefined ? { lowStockAt: Math.max(0, parseInt(lowStockAt)) } : {}),
        ...(unitCost   !== undefined ? { unitCost: unitCost ? parseFloat(unitCost) : null } : {}),
        ...(notes      !== undefined ? { notes: notes?.trim() || null }          : {}),
      },
    })

    return NextResponse.json({ item: { ...updated, status: itemStatus(updated.quantity, updated.lowStockAt) } })
  } catch (error) {
    console.error('[inventory PATCH] message:', error?.message)
    console.error('[inventory PATCH] stack:',   error?.stack)
    console.error('[inventory PATCH] full:',    error)
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { gymSlug, id } = await params
    const { gym, item } = await getItem(gymSlug, id)
    if (!gym)  return NextResponse.json({ error: 'Gym not found' },  { status: 404 })
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    await prisma.inventoryItem.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[inventory DELETE] message:', error?.message)
    console.error('[inventory DELETE] stack:',   error?.stack)
    console.error('[inventory DELETE] full:',    error)
    return NextResponse.json({ error: error?.message ?? 'Internal server error' }, { status: 500 })
  }
}
