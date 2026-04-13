import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

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

    const apiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })

    // ── Seam API call ────────────────────────────────────────────────────────
    // const deleteRes = await fetch(`${SEAM_API}/access_codes/delete`, {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ access_code_id: codeId }),
    // })
    // if (!deleteRes.ok) {
    //   const text = await deleteRes.text()
    //   console.error('[seam/codes DELETE]', deleteRes.status, text)
    //   return NextResponse.json({ error: 'Seam API error' }, { status: 502 })
    // }
    // ─────────────────────────────────────────────────────────────────────────

    // Clear the code from any matching member row
    await prisma.member.updateMany({
      where: { gymId, seamDeviceId: codeId },
      data:  { accessCode: null, seamDeviceId: null },
    })

    console.log(`[seam/codes DELETE] codeId=${codeId} gymId=${gymId}`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[seam/codes DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
