import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { formatPhone } from '@/lib/phone'
import { deleteSeamCodeByPin } from '@/lib/seam'

/**
 * PATCH /api/[gymSlug]/guest-passes/profiles/[profileId]
 * Updates a guest profile's name, phone, or accessCode (DB only — no Seam calls).
 * Seam codes for guests are managed exclusively by the checkin route.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, profileId } = await params
    const body = await request.json()

    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug }, select: { id: true } })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    // Fetch the profile first, then verify gym association
    const profile = await prisma.guest.findUnique({ where: { id: profileId } })
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Auth boundary: must have passes, waivers, or a rep gym pass check-in for this gym
    const passCount = await prisma.guestVisit.count({ where: { guestProfileId: profileId, gymId: gym.id } })
    if (passCount === 0) {
      const repCheckinCount = profile.email
        ? await prisma.repGymPassCheckin.count({ where: { userEmail: profile.email, gymId: gym.id } })
        : 0
      if (repCheckinCount === 0) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }
    }

    const data = {}
    if (body.name       !== undefined) data.name       = body.name
    if (body.email      !== undefined) data.email      = body.email?.trim().toLowerCase() || null
    if (body.phone      !== undefined) data.phone      = formatPhone(body.phone)
    if (body.accessCode !== undefined) data.accessCode = body.accessCode
      ? String(body.accessCode).trim()
      : null

    if (body.dateOfBirth  !== undefined)
      data.dateOfBirth  = body.dateOfBirth  === '' ? null : String(body.dateOfBirth).trim()
    if (body.address !== undefined)
      data.address = body.address === '' ? null : String(body.address).trim()
    if (body.emergencyContactName !== undefined)
      data.emergencyContactName = body.emergencyContactName === '' ? null : String(body.emergencyContactName).trim()
    if (body.emergencyContactPhone !== undefined)
      data.emergencyContactPhone = body.emergencyContactPhone === '' ? null : String(body.emergencyContactPhone).trim()
    if (body.emergencyContactRelationship !== undefined)
      data.emergencyContactRelationship = body.emergencyContactRelationship === '' ? null : String(body.emergencyContactRelationship).trim()

    const updated = await prisma.guest.update({
      where: { id: profileId },
      data,
    })

    return NextResponse.json({ profile: updated })
  } catch (error) {
    console.error('[guest-profile PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/[gymSlug]/guest-passes/profiles/[profileId]
 * DELETE /api/[gymSlug]/guest-passes/profiles/[profileId]?full=true
 *
 * Default (no query param) — used by the partner check-ins page: removes a
 * guest's presence at this gym only. Deletes this gym's RepGymPassCheckin
 * records for them and removes their Seam access code (if any). The shared
 * Guest record itself is only deleted outright if it has no
 * GuestWaiver/GuestVisit ties anywhere — Guest is a cross-gym model (the
 * same guest can have visited multiple partner gyms), so we never want to
 * silently destroy another gym's customer history, and Postgres would
 * reject the delete anyway while a GuestWaiver still references it.
 *
 * full=true — used by the guest-passes page's "remove member" action: a hard
 * delete of the guest everywhere. Removes their Seam code, all of their
 * GuestPass (GuestVisit) records and GuestWaiver records across every gym,
 * then the GuestProfile (Guest) record itself.
 */
export async function DELETE(request, { params }) {
  try {
    const { gymSlug, profileId } = await params
    const { searchParams } = new URL(request.url)
    const full = searchParams.get('full') === 'true'

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const profile = await prisma.guest.findUnique({ where: { id: profileId } })
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    if (full) {
      // Auth boundary: profile must have a guest pass at this gym to be
      // removable from this gym's guest-passes page.
      const gymPassCount = await prisma.guestVisit.count({ where: { guestProfileId: profileId, gymId: gym.id } })
      if (gymPassCount === 0) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }

      const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
      const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
      if (profile.accessCode && apiKey) {
        const { ok } = await deleteSeamCodeByPin(apiKey, profile.accessCode, deviceId, '[guest-profile DELETE full]')
        console.log('[guest-profile DELETE full] Seam delete — pin=%s ok=%s profileId=%s', profile.accessCode, ok, profileId)
      } else {
        console.log('[guest-profile DELETE full] skipping Seam — accessCode=%s apiKey=%s', profile.accessCode ?? 'none', apiKey ? '(set)' : 'MISSING')
      }

      // GuestWaiver has no cascade on Guest — must clear it before the Guest delete.
      await prisma.guestWaiver.deleteMany({ where: { guestProfileId: profileId } })
      const { count: passesDeleted } = await prisma.guestVisit.deleteMany({ where: { guestProfileId: profileId } })
      await prisma.guest.delete({ where: { id: profileId } })

      console.log('[guest-profile DELETE full] deleted profileId=%s passesDeleted=%d', profileId, passesDeleted)
      return NextResponse.json({ ok: true, profileDeleted: true, passesDeleted })
    }

    // Auth boundary: same as PATCH — must have a rep gym pass check-in or a
    // guest visit for this gym to be acted on from here.
    const repCheckinCount = profile.email
      ? await prisma.repGymPassCheckin.count({ where: { userEmail: profile.email, gymId: gym.id } })
      : 0
    const gymPassCount = await prisma.guestVisit.count({ where: { guestProfileId: profileId, gymId: gym.id } })
    if (repCheckinCount === 0 && gymPassCount === 0) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // ── Remove Seam access code, if one was issued ──────────────────────────
    const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
    if (profile.accessCode && apiKey) {
      const { ok } = await deleteSeamCodeByPin(apiKey, profile.accessCode, deviceId, '[guest-profile DELETE]')
      console.log('[guest-profile DELETE] Seam delete — pin=%s ok=%s profileId=%s', profile.accessCode, ok, profileId)
    } else {
      console.log('[guest-profile DELETE] skipping Seam — accessCode=%s apiKey=%s', profile.accessCode ?? 'none', apiKey ? '(set)' : 'MISSING')
    }

    // ── Delete this gym's partner check-in records ──────────────────────────
    const { count: checkinsDeleted } = profile.email
      ? await prisma.repGymPassCheckin.deleteMany({ where: { userEmail: profile.email, gymId: gym.id } })
      : { count: 0 }

    // ── Only fully delete the shared Guest record if nothing else ties to it ─
    const [waiverCount, visitCount] = await Promise.all([
      prisma.guestWaiver.count({ where: { guestProfileId: profileId } }),
      prisma.guestVisit.count({ where: { guestProfileId: profileId } }),
    ])

    let profileDeleted = false
    if (waiverCount === 0 && visitCount === 0) {
      await prisma.guest.delete({ where: { id: profileId } })
      profileDeleted = true
    }

    console.log(
      '[guest-profile DELETE] profileId=%s gym=%s checkinsDeleted=%d profileDeleted=%s (waivers=%d visits=%d elsewhere)',
      profileId, gymSlug, checkinsDeleted, profileDeleted, waiverCount, visitCount,
    )

    return NextResponse.json({ ok: true, profileDeleted, checkinsDeleted })
  } catch (error) {
    console.error('[guest-profile DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
