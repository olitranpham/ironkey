import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeById } from '@/lib/seam'

/**
 * DELETE /api/[gymSlug]/seam/codes/[codeId]
 * Removes an access code from Seam and clears it from the member record if matched.
 */
export async function DELETE(request, { params }) {
  try {
    const gymId  = request.headers.get('x-gym-id')
    const { codeId } = params

    const gym = await prisma.gym.findUnique({ where: { id: gymId } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const apiKey = process.env.SEAM_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })

    const { ok } = await deleteSeamCodeById(apiKey, codeId, '[seam/codes DELETE]')
    if (!ok) return NextResponse.json({ error: 'Seam API error' }, { status: 502 })

    // ── Clear from DB by PIN (passed as ?code=) ───────────────────────────────
    const pin = new URL(request.url).searchParams.get('code')
    if (pin) {
      await Promise.all([
        prisma.member.updateMany({
          where: { gymId, accessCode: pin },
          data:  { accessCode: null },
        }),
        prisma.guest.updateMany({
          where: { accessCode: pin },
          data:  { accessCode: null },
        }),
      ])
    }

    console.log(`[seam/codes DELETE] codeId=${codeId} gymId=${gymId}`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[seam/codes DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
