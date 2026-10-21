import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'

function itemStatus(quantity, lowStockAt) {
  if (quantity === 0)         return 'out'
  if (quantity <= lowStockAt) return 'low'
  return 'ok'
}

/** Today's date (YYYY-MM-DD) in the gym's timezone, as a UTC-midnight Date like other entries. */
function gymToday(timezone) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/New_York' }).format(new Date())
  return new Date(ymd)
}

class SellError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

/**
 * POST /api/[gymSlug]/inventory/[id]/sell
 * Body: { quantity: number, unitPrice?: number }
 *
 * Decrements stock, logs the sale to InventoryLog and — when unitPrice > 0 —
 * records an income FinancialEntry, all in one transaction. Requires only
 * inventory.manage (the entry is written server-side, not via financial-entries).
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug, id } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'inventory.manage')
    if (errorResponse) return errorResponse

    const body      = await request.json().catch(() => ({}))
    const quantity  = Number(body.quantity)
    const unitPrice = body.unitPrice === undefined || body.unitPrice === null || body.unitPrice === ''
      ? 0
      : Number(body.unitPrice)

    if (!Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json({ error: 'quantity must be a whole number ≥ 1' }, { status: 400 })
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: 'unitPrice must be a number ≥ 0' }, { status: 400 })
    }

    const gym = ctx.gym

    const { item, entry } = await prisma.$transaction(async (tx) => {
      const current = await tx.inventoryItem.findFirst({ where: { id, gymId: gym.id } })
      if (!current) throw new SellError(404, 'Item not found')

      // Conditional decrement — fails instead of going negative if stock changed meanwhile
      const { count } = await tx.inventoryItem.updateMany({
        where: { id, gymId: gym.id, quantity: { gte: quantity } },
        data:  { quantity: { decrement: quantity } },
      })
      if (count === 0) throw new SellError(409, `only ${current.quantity} in stock`)

      await tx.inventoryLog.create({
        data: { gymId: gym.id, itemId: id, change: -quantity, reason: 'sale' },
      })

      const entry = unitPrice > 0
        ? await tx.financialEntry.create({
            data: {
              gymId:       gym.id,
              type:        'income',
              category:    current.category,
              amount:      unitPrice * quantity,
              description: `${current.name} × ${quantity}`,
              date:        gymToday(gym.timezone),
            },
          })
        : null

      const item = await tx.inventoryItem.findUnique({ where: { id } })
      return { item, entry }
    })

    return NextResponse.json({
      item:  { ...item, status: itemStatus(item.quantity, item.lowStockAt) },
      entry,
    })
  } catch (error) {
    if (error instanceof SellError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[inventory sell]', error?.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
