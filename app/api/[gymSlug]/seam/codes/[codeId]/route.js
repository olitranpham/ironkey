import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeById } from '@/lib/seam'
import { requirePermission } from '@/lib/permissions'
import { writeAudit } from '@/lib/audit'

// Roles that may remove a code matching no member or guest at the gym
const UNKNOWN_CODE_ROLES = new Set(['OWNER', 'ADMIN'])

/**
 * DELETE /api/[gymSlug]/seam/codes/[codeId]
 * Removes an access code from Seam and clears it from the member/guest record.
 * ?code=<pin> — PIN used to clear the accessCode field in the DB.
 *
 * A code whose PIN matches no member or guest at this gym (an "unknown
 * code" on the door access page) can only be removed by OWNER / ADMIN.
 */
export async function DELETE(request, { params }) {
  try {
    const { gymSlug, codeId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'door.manage')
    if (errorResponse) return errorResponse
    const pin = new URL(request.url).searchParams.get('code')

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const apiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })

    if (!UNKNOWN_CODE_ROLES.has(ctx.user.role)) {
      const [memberHolder, guestHolder] = pin ? await Promise.all([
        prisma.member.findFirst({ where: { gymId: gym.id, accessCode: pin }, select: { id: true } }),
        prisma.guest.findFirst({
          where:  { accessCode: pin, OR: [{ waivers: { some: { gymId: gym.id } } }, { passes: { some: { gymId: gym.id } } }] },
          select: { id: true },
        }),
      ]) : [null, null]
      if (!memberHolder && !guestHolder) {
        return NextResponse.json({ error: 'only an owner or admin can remove an unknown code' }, { status: 403 })
      }
    }

    const { ok } = await deleteSeamCodeById(apiKey, codeId, '[seam/codes DELETE]')
    if (!ok) {
      console.error('[seam/codes DELETE] Seam error for codeId=%s gymSlug=%s', codeId, gymSlug)
      return NextResponse.json({ error: 'Seam API error' }, { status: 502 })
    }

    // ── Clear accessCode from DB ──────────────────────────────────────────────
    if (pin) {
      // Guests are global (by email) with one PIN across gyms. Only a guest
      // tied to THIS gym alone loses the PIN; one who also has a pass or
      // waiver at another gym keeps it (only this gym's lock code is gone).
      const atThisGym    = { OR: [{ passes: { some: { gymId: gym.id } } }, { waivers: { some: { gymId: gym.id } } }] }
      const atOtherGym   = { OR: [{ passes: { some: { gymId: { not: gym.id } } } }, { waivers: { some: { gymId: { not: gym.id } } } }] }
      const [memberResult, guestResult, guestsKept] = await Promise.all([
        prisma.member.updateMany({
          where: { gymId: gym.id, accessCode: pin },
          data:  { accessCode: null },
        }),
        prisma.guest.updateMany({
          where: { accessCode: pin, AND: [atThisGym, { NOT: atOtherGym }] },
          data:  { accessCode: null },
        }),
        prisma.guest.count({ where: { accessCode: pin, AND: [atThisGym, atOtherGym] } }),
      ])
      console.log('[seam/codes DELETE] DB cleared — members=%d guests=%d (kept on %d guest(s) with another gym) codeId=%s', memberResult.count, guestResult.count, guestsKept, codeId)
    }

    writeAudit(ctx, 'door.code.delete', 'SeamAccessCode', codeId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[seam/codes DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
