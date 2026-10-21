import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'
import { ensureKisiMembership, revokeAccess as revokeKisiAccess, grantAccess as grantKisiAccess, groupIdForMembershipType } from '@/lib/kisi'
import { normalizeGradSemester } from '@/lib/gradSemester'
import { requirePermission, can, forbidden, trainerMemberScope, trainerMemberView } from '@/lib/permissions'
import { maskPin, redactJsonText } from '@/lib/redact'
import { writeAudit } from '@/lib/audit'

const SEAM_API = 'https://connect.getseam.com'
const VALID_STUDENT_CATEGORIES = ['Student', 'Military', 'EMT']

const MEMBER_SELECT = {
  id: true, firstName: true, lastName: true, email: true, phone: true,
  status: true, membershipType: true, accessCode: true, priceId: true,
  dateOfBirth: true, address: true,
  emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelationship: true,
  isMinor: true, guardianName: true, guardianEmail: true, guardianPhone: true, guardianRelationship: true,
  dateFrozen: true, dateCanceled: true, createdAt: true,
  cancelScheduled: true, cancelEffectiveDate: true,
  stripeCustomerId: true, stripeSubscriptionId: true,
  hearAboutUs: true,
  gradSemester: true, gradYear: true, studentCategory: true,
  studentIdImage: true, studentIdStatus: true, studentIdReviewedAt: true, studentIdReviewedBy: true,
  kisiUserId: true, kisiRoleAssignmentId: true,
}

/**
 * GET /api/[gymSlug]/members/[memberId]
 * Returns a single member record.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug, memberId } = params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.view')
    if (errorResponse) return errorResponse
    // TRAINER is always limited to members from their own PT sessions
    const scope = await trainerMemberScope(ctx)
    if (scope && !scope.has(memberId)) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

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

    return NextResponse.json({ member: scope ? trainerMemberView(member) : member })
  } catch (error) {
    console.error('[members/get]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/[gymSlug]/members/[memberId]
 * Updates a member's profile fields and/or accessCode.
 * When accessCode changes, programs the new code onto the gym's Seam lock.
 * Status changes are rejected — they must go through /freeze, /resume,
 * /cancel or /reverse-cancel, which also handle Stripe and door access.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, memberId } = params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.edit')
    if (errorResponse) return errorResponse
    // TRAINER is always limited to members from their own PT sessions
    const scope = await trainerMemberScope(ctx)
    if (scope && !scope.has(memberId)) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    const body                  = await request.json()

    if (body.status !== undefined) {
      return NextResponse.json({ error: 'use /freeze, /resume, /cancel' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, accessProvider: true, kisiApiKey: true, kisiPlaceId: true, kisiMemberGroupId: true, kisiWeekendGroupId: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const gymId = gym.id
    const { accessCode, firstName, lastName, email, phone,
            dateOfBirth, address, emergencyContactName, emergencyContactPhone,
            emergencyContactRelationship, membershipType,
            stripeCustomerId, stripeSubscriptionId,
            gradSemester, gradYear, studentCategory,
            resendKisiInvite,
            guardianName, guardianEmail, guardianPhone, guardianRelationship } = body

    console.log('[members/patch] memberId=%s gymId=%s fields=%j', memberId, gymId, Object.keys(body))

    const existing = await prisma.member.findFirst({
      where: { id: memberId, gymId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // ── Field-level permissions ───────────────────────────────────────────────
    // Door codes reprogram the lock.
    if ((accessCode !== undefined || resendKisiInvite === true) && !can(ctx.user, 'door.manage')) {
      return forbidden()
    }
    // Re-pointing a member at a different Stripe customer/subscription is a billing action.
    if ((stripeCustomerId !== undefined || stripeSubscriptionId !== undefined) && !can(ctx.user, 'billing.act')) {
      return forbidden()
    }

    const now  = new Date()
    const data = { updatedAt: now }

    if (firstName !== undefined && firstName.trim()) data.firstName = firstName.trim()
    if (lastName  !== undefined && lastName.trim())  data.lastName  = lastName.trim()
    if (email     !== undefined && email.trim())     data.email     = email.trim().toLowerCase()
    if (phone     !== undefined)                     data.phone     = phone.trim() || null

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

    if (emergencyContactRelationship !== undefined) {
      data.emergencyContactRelationship = emergencyContactRelationship === '' ? null : String(emergencyContactRelationship).trim()
    }

    if (guardianName !== undefined) {
      data.guardianName = guardianName === '' ? null : String(guardianName).trim()
    }

    if (guardianEmail !== undefined) {
      data.guardianEmail = guardianEmail === '' ? null : String(guardianEmail).trim()
    }

    if (guardianPhone !== undefined) {
      data.guardianPhone = guardianPhone === '' ? null : String(guardianPhone).trim()
    }

    if (guardianRelationship !== undefined) {
      data.guardianRelationship = guardianRelationship === '' ? null : String(guardianRelationship).trim()
    }

    if (membershipType       !== undefined) data.membershipType       = membershipType === ''       ? null : String(membershipType).trim()
    if (stripeCustomerId     !== undefined) data.stripeCustomerId     = stripeCustomerId === ''     ? null : String(stripeCustomerId).trim()
    if (stripeSubscriptionId !== undefined) data.stripeSubscriptionId = stripeSubscriptionId === '' ? null : String(stripeSubscriptionId).trim()

    // ── Kisi: staff changed membershipType → follow the tier into the right
    // group (revoke old assignment, grant new) before the write below.
    if (gym.accessProvider === 'KISI' && membershipType !== undefined && data.membershipType !== existing.membershipType) {
      try {
        const result = await ensureKisiMembership(gym, {
          existingMember: existing,
          email:          existing.email,
          name:           `${existing.firstName} ${existing.lastName}`.trim(),
          membershipType: data.membershipType,
        })
        if (result) {
          data.kisiUserId           = result.kisiUserId
          data.kisiRoleAssignmentId = result.kisiRoleAssignmentId
        }
      } catch (err) {
        console.error('[members/patch] Kisi tier-change error:', err.message)
      }
    }

    // ── Kisi: explicit "resend invite" action from the drawer — revoke and
    // re-grant with notify:true so Kisi fires a fresh notification
    // regardless of whether this person is brand new to Kisi.
    if (gym.accessProvider === 'KISI' && resendKisiInvite === true) {
      try {
        const targetGroupId = groupIdForMembershipType(gym, data.membershipType ?? existing.membershipType)
        if (targetGroupId && existing.kisiUserId) {
          if (existing.kisiRoleAssignmentId) await revokeKisiAccess(gym, existing.kisiRoleAssignmentId)
          data.kisiRoleAssignmentId = await grantKisiAccess(gym, existing.kisiUserId, targetGroupId, { notify: true })
        } else {
          console.warn('[members/patch] resendKisiInvite: no kisiUserId or target group for member %s — skipping', memberId)
        }
      } catch (err) {
        console.error('[members/patch] resendKisiInvite error:', err.message)
      }
    }

    if (gradSemester !== undefined) {
      if (gradSemester === '' || gradSemester === null) {
        data.gradSemester = null
      } else {
        const canonical = normalizeGradSemester(gradSemester)
        if (!canonical) {
          return NextResponse.json({ error: 'Invalid gradSemester' }, { status: 400 })
        }
        data.gradSemester = canonical
      }
    }

    if (gradYear !== undefined) {
      if (gradYear === '' || gradYear === null) {
        data.gradYear = null
      } else {
        const yearNum = parseInt(gradYear, 10)
        if (isNaN(yearNum)) return NextResponse.json({ error: 'Invalid gradYear' }, { status: 400 })
        data.gradYear = yearNum
      }
    }

    if (studentCategory !== undefined) {
      if (studentCategory !== '' && studentCategory !== null && !VALID_STUDENT_CATEGORIES.includes(studentCategory)) {
        return NextResponse.json({ error: 'Invalid studentCategory' }, { status: 400 })
      }
      data.studentCategory = studentCategory === '' ? null : studentCategory
    }

    const member = await prisma.member.update({
      where:  { id: memberId },
      data,
      select: MEMBER_SELECT,
    })

    console.log('[members/patch] DB updated — accessCode=%s', maskPin(member.accessCode))

    // ── Audit ────────────────────────────────────────────────────────────────
    if (accessCode !== undefined && data.accessCode !== existing.accessCode) {
      writeAudit(ctx, 'member.access_code_change', 'Member', memberId, { via: 'member_patch', cleared: data.accessCode === null })
    }

    // ── Program Seam lock if access code changed ─────────────────────────────
    if (gym.accessProvider !== 'KISI' && accessCode !== undefined && data.accessCode !== existing.accessCode) {
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
              console.log('[members/patch] seam update — code_id=%s newCode=%s', existingSeamCode.access_code_id, maskPin(data.accessCode))
              const updateRes = await fetch(`${SEAM_API}/access_codes/update`, {
                method:  'POST',
                headers: seamHeaders,
                body:    JSON.stringify({ access_code_id: existingSeamCode.access_code_id, code: data.accessCode }),
              })
              if (!updateRes.ok) {
                const text = await updateRes.text()
                console.error('[members/patch] seam update failed:', updateRes.status, redactJsonText(text))
              } else {
                console.log('[members/patch] seam update OK')
              }
            } else if (data.accessCode) {
              console.log('[members/patch] seam create — device=%s code=%s name="%s"', deviceId, maskPin(data.accessCode), existing.firstName + ' ' + existing.lastName)
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
                console.error('[members/patch] seam create failed:', createRes.status, redactJsonText(text))
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
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.delete')
    if (errorResponse) return errorResponse
    // TRAINER is always limited to members from their own PT sessions
    const scope = await trainerMemberScope(ctx)
    if (scope && !scope.has(memberId)) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true, accessProvider: true, kisiApiKey: true, kisiPlaceId: true, kisiMemberGroupId: true, kisiWeekendGroupId: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findFirst({
      where:  { id: memberId, gymId: gym.id },
      select: { id: true, accessCode: true, firstName: true, lastName: true, kisiRoleAssignmentId: true },
    })
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    if (gym.accessProvider === 'KISI') {
      // ── Revoke Kisi role assignment — never delete the Kisi user ──────────
      const { ok } = await revokeKisiAccess(gym, member.kisiRoleAssignmentId)
      console.log('[members DELETE] Kisi revoke — roleAssignmentId=%s ok=%s memberId=%s', member.kisiRoleAssignmentId, ok, memberId)
    } else {
      // ── Remove Seam access code ─────────────────────────────────────────
      const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
      const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

      if (member.accessCode && apiKey && deviceId) {
        const { ok } = await deleteSeamCodeByPin(apiKey, member.accessCode, deviceId, '[members DELETE]')
        console.log('[members DELETE] Seam delete — pin=%s ok=%s memberId=%s', maskPin(member.accessCode), ok, memberId)
      } else {
        console.log('[members DELETE] skipping Seam — accessCode=%s apiKey=%s deviceId=%s',
          member.accessCode ? maskPin(member.accessCode) : 'none',
          apiKey   ? '(set)' : 'MISSING',
          deviceId ? '(set)' : 'MISSING',
        )
      }
    }

    // ── Delete member from DB ─────────────────────────────────────────────────
    await prisma.member.delete({ where: { id: memberId } })

    console.log('[members DELETE] deleted memberId=%s gymId=%s', memberId, gym.id)
    writeAudit(ctx, 'member.delete', 'Member', memberId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[members DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
