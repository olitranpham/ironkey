import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'

const SEAM_API = 'https://connect.getseam.com'
const VALID_STATUSES = ['ACTIVE', 'FROZEN', 'CANCELLED']

const MEMBER_SELECT = {
  id: true, firstName: true, lastName: true, email: true, phone: true,
  status: true, membershipType: true, accessCode: true,
  dateOfBirth: true, address: true,
  emergencyContactName: true, emergencyContactPhone: true,
  dateFrozen: true, dateCanceled: true, createdAt: true,
  stripeCustomerId: true, stripeSubscriptionId: true,
}

/**
 * GET /api/[gymSlug]/members/[memberId]
 * Returns a single member record.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = params

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const gymId = gym.id

    const member = await prisma.member.findFirst({
      where:  { id: memberId, gymId },
      select: MEMBER_SELECT,
    })

    if (!member) {
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
    const { gymSlug, memberId } = params
    const body                  = await request.json()

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const gymId = gym.id
    const { status, accessCode, dateOfBirth, address, emergencyContactName, emergencyContactPhone } = body

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

    if (dateOfBirth !== undefined) {
      data.dateOfBirth = dateOfBirth === '' ? null : String(dateOfBirth).trim()
    }

    if (address !== undefined) {
      data.address = address === '' ? null : String(address).trim()
    }

    if (emergencyContactName !== undefined) {
      data.emergencyContactName = emergencyContactName === '' ? null : String(emergencyContactName).trim()
    }

    if (emergencyContactPhone !== undefined) {
      data.emergencyContactPhone = emergencyContactPhone === '' ? null : String(emergencyContactPhone).trim()
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
        const gymSeam = await prisma.gym.findUnique({
          where:  { id: gymId },
          select: { seamApiKey: true, seamDeviceId: true },
        })

        const apiKey   = gymSeam?.seamApiKey
        const deviceId = gymSeam?.seamDeviceId

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

/**
 * DELETE /api/[gymSlug]/members/[memberId]
 * Permanently deletes a member record and removes their Seam access code.
 */
export async function DELETE(request, { params }) {
  try {
    const { gymSlug, memberId } = params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findFirst({
      where:  { id: memberId, gymId: gym.id },
      select: { id: true, accessCode: true, firstName: true, lastName: true },
    })
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    // ── Remove Seam access code ───────────────────────────────────────────────
    const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

    if (member.accessCode && apiKey && deviceId) {
      const { ok } = await deleteSeamCodeByPin(apiKey, member.accessCode, deviceId, '[members DELETE]')
      console.log('[members DELETE] Seam delete — pin=%s ok=%s memberId=%s', member.accessCode, ok, memberId)
    } else {
      console.log('[members DELETE] skipping Seam — accessCode=%s apiKey=%s deviceId=%s',
        member.accessCode ?? 'none',
        apiKey   ? '(set)' : 'MISSING',
        deviceId ? '(set)' : 'MISSING',
      )
    }

    // ── Delete member from DB ─────────────────────────────────────────────────
    await prisma.member.delete({ where: { id: memberId } })

    console.log('[members DELETE] deleted memberId=%s gymId=%s', memberId, gym.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[members DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
