import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

/**
 * Deletes the guest's Seam access code from the lock.
 * Looks up the code by its value in the device's code list, then deletes by ID.
 */
async function deactivateSeamCode(accessCode, seamApiKey, seamDeviceId) {
  try {
    const seamHeaders = {
      Authorization:  `Bearer ${seamApiKey}`,
      'Content-Type': 'application/json',
    }
    const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
      method:  'POST',
      headers: seamHeaders,
      body:    JSON.stringify({ device_id: seamDeviceId }),
    })
    const { access_codes = [] } = await listRes.json()
    const match = access_codes.find(
      c => String(c.code).trim() === String(accessCode).trim()
    )
    if (match) {
      await fetch(`${SEAM_API}/access_codes/delete`, {
        method:  'POST',
        headers: seamHeaders,
        body:    JSON.stringify({ access_code_id: match.access_code_id }),
      })
    }
  } catch (err) {
    console.error('[checkin] Seam deactivate error:', err.message)
  }
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const email = (body.email ?? '').trim().toLowerCase()
    const name  = (body.name  ?? '').trim()

    if (!email && !name) {
      return NextResponse.json({ error: 'email or name is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    // ── Upsert guest profile ─────────────────────────────────────────────────
    let profile = null
    if (email) {
      profile = await prisma.guestProfile.upsert({
        where:  { gymId_email: { gymId: gym.id, email } },
        update: { name: name || undefined },
        create: { gymId: gym.id, name: name || email, email },
      })
    }

    // ── Look up most recent pack with passes remaining ────────────────────────
    const existing = email
      ? await prisma.guestPass.findFirst({
          where: {
            gymId:      gym.id,
            guestEmail: { equals: email, mode: 'insensitive' },
            passesLeft: { gt: 0 },
          },
          orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
        })
      : null

    if (existing) {
      const newCount = existing.passesLeft - 1
      const updated  = await prisma.guestPass.update({
        where: { id: existing.id },
        data:  {
          passesLeft:     newCount,
          usedAt:         new Date(),
          guestProfileId: profile?.id ?? existing.guestProfileId,
        },
      })

      // ── Deactivate Seam code if pack is now exhausted ────────────────────
      if (newCount === 0 && profile?.accessCode && gym.seamApiKey && gym.seamDeviceId) {
        await deactivateSeamCode(profile.accessCode, gym.seamApiKey, gym.seamDeviceId)
      }

      return NextResponse.json({ ok: true, passesLeft: updated.passesLeft, passType: updated.passType, accessCode: profile?.accessCode ?? null })
    }

    // ── No pack found — create a single-use record and deactivate immediately
    await prisma.guestPass.create({
      data: {
        gymId:          gym.id,
        guestProfileId: profile?.id ?? null,
        guestName:      name || email,
        guestEmail:     email || null,
        passType:       'SINGLE',
        passesLeft:     null,
        usedAt:         new Date(),
        expiresAt:      new Date(Date.now() + 30 * 86400 * 1000),
      },
    })

    // Single pass — deactivate immediately after use
    if (profile?.accessCode && gym.seamApiKey && gym.seamDeviceId) {
      await deactivateSeamCode(profile.accessCode, gym.seamApiKey, gym.seamDeviceId)
    }

    return NextResponse.json({ ok: true, passesLeft: null, passType: 'SINGLE', accessCode: profile?.accessCode ?? null })
  } catch (error) {
    console.error('[guest-passes/checkin]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
