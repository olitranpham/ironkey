import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeById } from '@/lib/seam'

/**
 * DELETE /api/[gymSlug]/seam/codes/[codeId]
 * Removes an access code from Seam and clears it from the member/guest record.
 * ?code=<pin> — PIN used to clear the accessCode field in the DB.
 */
export async function DELETE(request, { params }) {
  try {
    const { gymSlug, codeId } = await params
    const pin = new URL(request.url).searchParams.get('code')

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const apiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })

    const { ok } = await deleteSeamCodeById(apiKey, codeId, '[seam/codes DELETE]')
    if (!ok) {
      console.error('[seam/codes DELETE] Seam error for codeId=%s gymSlug=%s', codeId, gymSlug)
      return NextResponse.json({ error: 'Seam API error' }, { status: 502 })
    }

    // ── Clear accessCode from DB ──────────────────────────────────────────────
    if (pin) {
      const [memberResult, guestResult] = await Promise.all([
        prisma.member.updateMany({
          where: { gymId: gym.id, accessCode: pin },
          data:  { accessCode: null },
        }),
        prisma.guest.updateMany({
          where: { accessCode: pin },
          data:  { accessCode: null },
        }),
      ])
      console.log('[seam/codes DELETE] DB cleared — members=%d guests=%d codeId=%s', memberResult.count, guestResult.count, codeId)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[seam/codes DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
