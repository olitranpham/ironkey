import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'
const VALID_STATUSES = ['ACTIVE', 'FROZEN', 'CANCELLED']

const MEMBER_SELECT = {
  id: true, firstName: true, lastName: true, email: true, phone: true,
  status: true, membershipType: true, accessCode: true,
  dateFrozen: true, dateCanceled: true, createdAt: true,
  stripeCustomerId: true, stripeSubscriptionId: true,
}

/**
 * GET /api/[gymSlug]/members/[memberId]
 * Returns a single member record.
 */
export async function GET(request, { params }) {
  try {
    const gymId        = request.headers.get('x-gym-id')
    const { memberId } = params

    console.log('[members/get] memberId=%s gymId=%s', memberId, gymId)

    const member = await prisma.member.findFirst({
      where:  { id: memberId, gymId },
      select: MEMBER_SELECT,
    })

    console.log('[members/get] found=%s', Boolean(member))

    if (!member) {
      // Try without gymId to see if ID exists at all (for debugging)
      const memberAnyGym = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, gymId: true } })
      console.log('[members/get] member_any_gym=%j', memberAnyGym)
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[members/get]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/[gymSlug]/members/[memberId]
 * Updates a member's status and/or accessCode.
 * When accessCode changes, programs the new code onto the gym's Seam lock.
 */
export async function PATCH(request, { params }) {
  try {
    const gymId        = request.headers.get('x-gym-id')
    const { memberId } = params
    const body         = await request.json()
    const { status, accessCode } = body

    console.log('[members/patch] memberId=%s gymId=%s body=%j', memberId, gymId, body)

    const existing = await prisma.member.findFirst({
      where: { id: memberId, gymId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const now  = new Date()
    const data = { updatedAt: now }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      data.status = status
      if (status === 'FROZEN'    && !existing.dateFrozen)   data.dateFrozen   = now
      if (status === 'CANCELLED' && !existing.dateCanceled) data.dateCanceled = now
      if (status === 'ACTIVE')                              data.dateFrozen   = null
    }

    if (accessCode !== undefined) {
      data.accessCode = accessCode === '' ? null : String(accessCode).trim()
    }

    const member = await prisma.member.update({
      where:  { id: memberId },
      data,
      select: MEMBER_SELECT,
    })

    console.log('[members/patch] DB updated — accessCode=%s', member.accessCode)

    // ── Log membership event if status changed ───────────────────────────────
    if (status !== undefined && status !== existing.status) {
      let eventType
      if (status === 'FROZEN')    eventType = 'frozen'
      if (status === 'CANCELLED') eventType = 'cancelled'
      if (status === 'ACTIVE')    eventType = existing.status === 'FROZEN' ? 'unfrozen' : 'reactivated'
      if (eventType) {
        await prisma.membershipEvent.create({ data: { memberId, gymId, type: eventType } })
      }
    }

    // ── Program Seam lock if access code changed ─────────────────────────────
    if (accessCode !== undefined && data.accessCode !== existing.accessCode) {
      try {
        const gym = await prisma.gym.findUnique({
          where:  { id: gymId },
          select: { seamApiKey: true, seamDeviceId: true },
        })

        const apiKey   = gym?.seamApiKey
        const deviceId = gym?.seamDeviceId

        console.log('[members/patch] seam check — hasApiKey=%s hasDeviceId=%s', Boolean(apiKey), Boolean(deviceId))

        if (apiKey && deviceId) {
          const seamHeaders = {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          }

          // Find existing Seam code by old PIN or member name
          const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
            method:  'POST',
            headers: seamHeaders,
            body:    JSON.stringify({ device_id: deviceId }),
          })

          if (listRes.ok) {
            const { access_codes } = await listRes.json()
            const oldPin      = existing.accessCode ? String(existing.accessCode).trim() : null
            const memberName  = `${existing.firstName} ${existing.lastName}`.trim().toLowerCase()

            const existingSeamCode = access_codes?.find(c =>
              (oldPin && c.code && String(c.code).trim() === oldPin) ||
              (c.name && c.name.trim().toLowerCase() === memberName)
            )

            if (existingSeamCode) {
              console.log('[members/patch] seam update — code_id=%s newCode=%s', existingSeamCode.access_code_id, data.accessCode)
              const updateRes = await fetch(`${SEAM_API}/access_codes/update`, {
                method:  'POST',
                headers: seamHeaders,
                body:    JSON.stringify({ access_code_id: existingSeamCode.access_code_id, code: data.accessCode }),
              })
              if (!updateRes.ok) {
                const text = await updateRes.text()
                console.error('[members/patch] seam update failed:', updateRes.status, text)
              } else {
                console.log('[members/patch] seam update OK')
              }
            } else if (data.accessCode) {
              console.log('[members/patch] seam create — device=%s code=%s name="%s"', deviceId, data.accessCode, existing.firstName + ' ' + existing.lastName)
              const createRes = await fetch(`${SEAM_API}/access_codes/create`, {
                method:  'POST',
                headers: seamHeaders,
                body:    JSON.stringify({
                  device_id: deviceId,
                  name:      `${existing.firstName} ${existing.lastName}`,
                  code:      data.accessCode,
                }),
              })
              if (!createRes.ok) {
                const text = await createRes.text()
                console.error('[members/patch] seam create failed:', createRes.status, text)
              } else {
                console.log('[members/patch] seam create OK')
              }
            }
          } else {
            console.error('[members/patch] seam list failed:', listRes.status)
          }
        }
      } catch (seamErr) {
        // Seam failure must not block the DB response
        console.error('[members/patch] seam error:', seamErr.message)
      }
    }

    return NextResponse.json({ member })
  } catch (error) {
    console.error('[members/patch]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
