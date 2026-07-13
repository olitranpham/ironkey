import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API        = 'https://connect.getseam.com'
const MAX_FLEX_CHECKINS = 5

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function resolveCount(member) {
  const monthStart = startOfMonth(new Date())
  const needsReset = !member.flexCheckInResetDate ||
    new Date(member.flexCheckInResetDate) < monthStart
  return {
    currentCount: needsReset ? 0 : member.flexCheckInCount,
    needsReset,
    monthStart,
  }
}

// ── Seam helpers ──────────────────────────────────────────────────────────────

async function deleteSeamCodeByPin(apiKey, deviceId, pin) {
  try {
    const seamHeaders = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    const listRes  = await fetch(`${SEAM_API}/access_codes/list`, {
      method: 'POST', headers: seamHeaders,
      body:   JSON.stringify({ device_id: deviceId }),
    })
    const listJson = listRes.ok ? await listRes.json() : { access_codes: [] }
    const oldCode  = listJson.access_codes?.find(c => String(c.code).trim() === String(pin).trim())
    if (oldCode) {
      await fetch(`${SEAM_API}/access_codes/delete`, {
        method: 'POST', headers: seamHeaders,
        body:   JSON.stringify({ access_code_id: oldCode.access_code_id }),
      })
      console.log('[flex-checkin] deleted Seam code id=%s pin=%s', oldCode.access_code_id, pin)
    } else {
      console.log('[flex-checkin] no existing Seam code found for pin=%s', pin)
    }
  } catch (err) {
    console.error('[flex-checkin] Seam delete error (non-fatal):', err.message)
  }
}

async function createSeam24hrCode(apiKey, deviceId, pin, memberName) {
  try {
    const seamHeaders = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    const startsAt    = new Date().toISOString()
    const endsAt      = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const payload     = { device_id: deviceId, name: memberName, code: String(pin).trim(), starts_at: startsAt, ends_at: endsAt }
    console.log('[flex-checkin] creating 24-hr Seam code — %j', payload)
    const res  = await fetch(`${SEAM_API}/access_codes/create`, {
      method: 'POST', headers: seamHeaders,
      body:   JSON.stringify(payload),
    })
    const json = await res.json()
    console.log('[flex-checkin] Seam create response status=%d body=%j', res.status, json)
  } catch (err) {
    console.error('[flex-checkin] Seam create error (non-fatal):', err.message)
  }
}

/**
 * GET /api/[gymSlug]/flex-checkin?email=...
 * Public — looks up a flex member by email and returns their current monthly check-in count.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { searchParams } = new URL(request.url)
    const email = (searchParams.get('email') ?? '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where:  { gymId_email: { gymId: gym.id, email } },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        accessCode: true, membershipType: true, status: true,
        flexCheckInCount: true, flexCheckInResetDate: true,
      },
    })

    if (!member || !member.membershipType?.toLowerCase().includes('flex')) {
      return NextResponse.json(
        { error: 'no flex membership found for that email' },
        { status: 404 },
      )
    }
    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'your flex membership is not currently active' },
        { status: 400 },
      )
    }

    const { currentCount } = resolveCount(member)

    return NextResponse.json({
      member: {
        id:        member.id,
        firstName: member.firstName,
        lastName:  member.lastName,
        email:     member.email,
        accessCode: member.accessCode,
      },
      checkInsUsed:      currentCount,
      checkInsRemaining: Math.max(0, MAX_FLEX_CHECKINS - currentCount),
    })
  } catch (error) {
    console.error('[flex-checkin GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/[gymSlug]/flex-checkin
 * Public — records a flex check-in for a member. Resets the monthly count if needed.
 * Activates a 24-hr Seam code on check-in; removes it on the 5th (final) check-in.
 * Body: { email }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body  = await request.json()
    const email = (body.email ?? '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true, zapierGuestWebhookUrl: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const member = await prisma.member.findUnique({
      where: { gymId_email: { gymId: gym.id, email } },
    })

    if (!member || !member.membershipType?.toLowerCase().includes('flex')) {
      return NextResponse.json(
        { error: 'no flex membership found for that email' },
        { status: 404 },
      )
    }
    if (member.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'your flex membership is not currently active' },
        { status: 400 },
      )
    }

    const { currentCount, needsReset, monthStart } = resolveCount(member)

    if (currentCount >= MAX_FLEX_CHECKINS) {
      return NextResponse.json(
        { error: `you've used all ${MAX_FLEX_CHECKINS} check-ins for this month` },
        { status: 400 },
      )
    }

    const newCount        = currentCount + 1
    const checkInsRemaining = MAX_FLEX_CHECKINS - newCount

    await prisma.member.update({
      where: { id: member.id },
      data: {
        flexCheckInCount:     newCount,
        ...(needsReset && { flexCheckInResetDate: monthStart }),
      },
    })

    // ── Seam code management ──────────────────────────────────────────────────
    const pin        = member.accessCode ? String(member.accessCode).trim() : null
    const memberName = `${member.firstName} ${member.lastName}`.trim()
    const hasSeam    = gym.seamApiKey && gym.seamDeviceId && pin

    if (hasSeam) {
      // Always delete the existing code first (clears any previous 24-hr window)
      await deleteSeamCodeByPin(gym.seamApiKey, gym.seamDeviceId, pin)

      if (checkInsRemaining > 0) {
        // Check-ins remaining — create a fresh 24-hr code
        await createSeam24hrCode(gym.seamApiKey, gym.seamDeviceId, pin, memberName)
      } else {
        // 5th (final) check-in — delete only, no recreation; access expires immediately
        console.log('[flex-checkin] final check-in for month — Seam code deleted, not recreated (email=%s)', email)
      }
    }

    // ── Fire Zapier webhook (non-blocking) ────────────────────────────────────
    if (gym.zapierGuestWebhookUrl) {
      fetch(gym.zapierGuestWebhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:              'flex_checkin',
          name:              memberName,
          email:             member.email,
          accessCode:        member.accessCode ?? null,
          checkInsUsed:      newCount,
          checkInsRemaining,
        }),
      }).catch(err => console.error('[flex-checkin webhook]', err))
    }

    return NextResponse.json({ checkInsUsed: newCount, checkInsRemaining })
  } catch (error) {
    console.error('[flex-checkin POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
