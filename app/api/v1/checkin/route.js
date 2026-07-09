import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'

const SEAM_API = 'https://connect.getseam.com'

export async function POST(request) {
  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const authHeader = request.headers.get('authorization') ?? ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token || token !== process.env.REP_GYM_PASS_API_KEY) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    // ── 2. Parse & validate body ──────────────────────────────────────────────
    const body = await request.json()
    const { gym_slug, user_name, user_email } = body ?? {}
    if (!gym_slug || !user_name || !user_email) {
      return NextResponse.json(
        { error: 'missing_fields', required: ['gym_slug', 'user_name', 'user_email'] },
        { status: 400 }
      )
    }

    // ── 3. Look up gym ────────────────────────────────────────────────────────
    const gym = await prisma.gym.findUnique({
      where:  { slug: gym_slug },
      select: { id: true, slug: true, repGymPassEnabled: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'gym_not_found' }, { status: 404 })
    }

    // ── 4. Check feature flag ─────────────────────────────────────────────────
    if (!gym.repGymPassEnabled) {
      return NextResponse.json({ error: 'gym_not_enabled' }, { status: 403 })
    }

    // ── 5. Idempotency check ──────────────────────────────────────────────────
    const idempotencyKeyHeader = request.headers.get('idempotency-key') ?? null
    if (idempotencyKeyHeader) {
      const existing = await prisma.repGymPassCheckin.findUnique({
        where: { idempotencyKey: idempotencyKeyHeader },
      })
      if (existing) {
        return NextResponse.json({
          checkin_id:  existing.id,
          access_code: existing.accessCode,
          starts_at:   existing.startsAt,
          expires_at:  existing.expiresAt,
          status:      'approved',
        })
      }
    }

    // ── 6. Upsert GuestProfile ────────────────────────────────────────────────
    let guestProfile = await prisma.guest.upsert({
      where:  { email: user_email },
      update: {},
      create: { name: user_name, email: user_email },
    })

    let accessCode = guestProfile.accessCode
    if (!accessCode) {
      accessCode = String(Math.floor(1000 + Math.random() * 9000))
      await prisma.guest.update({ where: { id: guestProfile.id }, data: { accessCode } })
    }

    // ── 7. Seam integration ───────────────────────────────────────────────────
    const startsAt  = new Date()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    if (gym.seamApiKey && gym.seamDeviceId) {
      try {
        // Delete any existing code with this PIN, then create a fresh timed one
        await deleteSeamCodeByPin(gym.seamApiKey, accessCode, gym.seamDeviceId, '[rep-gym-pass/checkin]')

        const seamHeaders = {
          Authorization:  `Bearer ${gym.seamApiKey}`,
          'Content-Type': 'application/json',
        }
        const createRes = await fetch(`${SEAM_API}/access_codes/create`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify({
            device_id:  gym.seamDeviceId,
            code:       accessCode,
            name:       `REP: ${user_name}`,
            starts_at:  startsAt.toISOString(),
            ends_at:    expiresAt.toISOString(),
          }),
        })
        const createJson = await createRes.json()
        if (!createRes.ok) {
          console.error('[rep-gym-pass/checkin] Seam create failed:', JSON.stringify(createJson))
          return NextResponse.json({ error: 'provisioning_failed', detail: createJson.error?.message ?? 'seam error' }, { status: 500 })
        }
        console.log('[rep-gym-pass/checkin] Seam code created: access_code_id=%s', createJson.access_code?.access_code_id)
      } catch (err) {
        console.error('[rep-gym-pass/checkin] Seam error:', err.message)
        return NextResponse.json({ error: 'provisioning_failed', detail: err.message }, { status: 500 })
      }
    }

    // ── 8. Create RepGymPassCheckin record ────────────────────────────────────
    const checkin = await prisma.repGymPassCheckin.create({
      data: {
        gymId:          gym.id,
        userName:       user_name,
        userEmail:      user_email,
        accessCode,
        startsAt,
        expiresAt,
        idempotencyKey: idempotencyKeyHeader ?? null,
      },
    })

    // ── 9. Return success ─────────────────────────────────────────────────────
    return NextResponse.json({
      checkin_id:  checkin.id,
      access_code: accessCode,
      starts_at:   startsAt,
      expires_at:  expiresAt,
      status:      'approved',
    })
  } catch (error) {
    console.error('[rep-gym-pass/checkin]', error)
    return NextResponse.json({ error: 'internal_server_error' }, { status: 500 })
  }
}
