import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin, waitForAccessCodeGone, generateUniqueAccessCode } from '@/lib/seam'

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
        // Delete any existing code with this PIN, then create a fresh timed
        // one. Seam reports the delete as successful as soon as it's
        // accepted, not once it's actually applied — recreating the same
        // PIN immediately can lose that race and get rejected as
        // duplicate_access_code (confirmed via Railway logs: this happened
        // 5x in a row for the same guest/PIN on 2026-08-20). Wait for the
        // deletion to actually be gone before recreating.
        const { ok: deleted } = await deleteSeamCodeByPin(gym.seamApiKey, accessCode, gym.seamDeviceId, '[rep-gym-pass/checkin]')
        if (deleted) {
          const gone = await waitForAccessCodeGone(gym.seamApiKey, gym.seamDeviceId, accessCode, { maxAttempts: 8, intervalMs: 1000 })
          if (!gone) {
            console.warn('[rep-gym-pass/checkin] delete did not propagate within timeout — pin=%s — will attempt create and fall back to a new code if still blocked', accessCode)
          }
        }

        const seamHeaders = {
          Authorization:  `Bearer ${gym.seamApiKey}`,
          'Content-Type': 'application/json',
        }

        const createSeamCode = code => fetch(`${SEAM_API}/access_codes/create`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify({
            device_id:  gym.seamDeviceId,
            code,
            name:       `REP: ${user_name}`,
            starts_at:  startsAt.toISOString(),
            ends_at:    expiresAt.toISOString(),
          }),
        }).then(async res => ({ res, json: await res.json() }))

        let { res: createRes, json: createJson } = await createSeamCode(accessCode)

        // Defensive fallback — if it's still a duplicate even after
        // confirming the delete propagated (or the wait itself timed out),
        // don't fail the checkin outright: generate a genuinely different,
        // collision-checked code and retry once, persisting it so this
        // guest's stored PIN (and future checkins) move to the new value.
        if (!createRes.ok && createJson?.error?.type === 'duplicate_access_code') {
          console.warn('[rep-gym-pass/checkin] still duplicate_access_code after wait — falling back to a new code for guest=%s', user_email)
          accessCode = await generateUniqueAccessCode({
            prisma, gymId: gym.id, apiKey: gym.seamApiKey, deviceId: gym.seamDeviceId, logPrefix: '[rep-gym-pass/checkin]',
          })
          await prisma.guest.update({ where: { id: guestProfile.id }, data: { accessCode } })
          ;({ res: createRes, json: createJson } = await createSeamCode(accessCode))
        }

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
