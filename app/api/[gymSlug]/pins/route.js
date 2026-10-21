import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/permissions'
import { generateUniquePin, DEFAULT_PIN_LENGTH } from '@/lib/pins'

/**
 * POST /api/[gymSlug]/pins
 * Suggests a door code no member, guest or partner check-in at this gym uses
 * (the "random" buttons in the door-access page, member drawer and guest panel).
 * Nothing is reserved — the code is only checked again when saved.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'door.manage')
    if (errorResponse) return errorResponse

    const pin = await generateUniquePin(ctx.gym.id, DEFAULT_PIN_LENGTH)
    return NextResponse.json({ pin })
  } catch (error) {
    console.error('[pins POST]', error.message)
    return NextResponse.json({ error: 'Could not generate a code' }, { status: 500 })
  }
}
