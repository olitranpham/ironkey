import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'

const SEAM_API = 'https://connect.getseam.com'

const PASS_TYPE_LABEL = {
  SINGLE:     'Day Pass',
  THREE_PACK: '3-Pack',
  FIVE_PACK:  '5-Pack',
  TEN_PACK:   '10-Pack',
}


/**
 * Looks up an existing Seam access code for the given PIN and returns it if
 * it's still within its active window (no ends_at, or ends_at in the
 * future). Used to detect a repeat check-in within the same 24-hour window
 * so the delete/recreate cycle can be skipped entirely — their access is
 * already live, touching it would just reset the window for no reason.
 */
async function findValidSeamCode(seamHeaders, deviceId, pin) {
  try {
    const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
      method: 'POST', headers: seamHeaders,
      body:   JSON.stringify({ device_id: deviceId }),
    })
    if (!listRes.ok) return null
    const listJson = await listRes.json()
    const code = listJson.access_codes?.find(c => String(c.code).trim() === String(pin).trim())
    if (!code) return null
    const stillValid = !code.ends_at || new Date(code.ends_at) > new Date()
    return stillValid ? code : null
  } catch (err) {
    console.error('[checkin] findValidSeamCode error:', err.message)
    return null
  }
}

function notifyZapier(request, gymSlug, { name, email, phone, accessCode }) {
  const host   = request.headers.get('host') ?? ''
  const scheme = host.startsWith('localhost') ? 'http' : 'https'
  fetch(`${scheme}://${host}/api/${gymSlug}/guest-passes`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name,
      email,
      phone:      phone ?? null,
      passType:   'single',
      passesLeft: null,
      accessCode,
    }),
  }).catch(e => console.error('[checkin] Zapier notify error:', e.message))
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const email = (body.email ?? '').trim().toLowerCase()
    const name  = (body.name  ?? '').trim()

    console.log('[checkin] POST gymSlug=%s email=%s', gymSlug, email)

    if (!email && !name) {
      return NextResponse.json({ error: 'email or name is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true, zapierGuestWebhookUrl: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    // ── Upsert guest profile (global — keyed by email) ──────────────────────
    let profile = null
    if (email) {
      profile = await prisma.guest.upsert({
        where:  { email },
        update: { name: name || undefined },
        create: { name: name || email, email },
      })
    }

    // ── Look up most recent pack with passes remaining ────────────────────────
    const existing = email
      ? await prisma.guestVisit.findFirst({
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
      const updated  = await prisma.guestVisit.update({
        where: { id: existing.id },
        data:  {
          passesLeft:     newCount,
          usedAt:         new Date(),
          guestProfileId: profile?.id ?? existing.guestProfileId,
        },
      })

      // ── Refresh 24-hr Seam code on every checkin ────────────────────────
      let alreadyActive = false
      console.log('[checkin] Seam gate check — newCount=%s profile=%s seamApiKey=%s seamDeviceId=%s',
        newCount, profile?.id ?? 'null', gym.seamApiKey ? '(set)' : 'null', gym.seamDeviceId ?? 'null')
      if (newCount > 0 && profile && gym.seamApiKey && gym.seamDeviceId) {
        console.log('[checkin] entering Seam refresh block')
        // Use existing code or generate a new one
        const hadExistingAccessCode = Boolean(profile.accessCode)
        let accessCode = profile.accessCode
        if (!accessCode) {
          accessCode = String(Math.floor(1000 + Math.random() * 9000))
          console.log('[checkin] generated missing accessCode=%s for guest=%s', accessCode, email)
        }

        const seamHeaders = { Authorization: `Bearer ${gym.seamApiKey}`, 'Content-Type': 'application/json' }
        const pin         = String(accessCode).trim()

        // Repeat check-in within the same window — a valid, non-expired code
        // already exists for this PIN, so skip the delete/recreate entirely.
        const validCode = hadExistingAccessCode ? await findValidSeamCode(seamHeaders, gym.seamDeviceId, pin) : null

        if (validCode) {
          alreadyActive = true
          console.log('[checkin] repeat check-in within window — code already valid, skipping refresh — pin=%s ends_at=%s', pin, validCode.ends_at)
        } else {
        // Step 1: delete any existing code for this PIN (best-effort — never blocks create)
        try {
          const listRes  = await fetch(`${SEAM_API}/access_codes/list`, {
            method: 'POST', headers: seamHeaders,
            body:   JSON.stringify({ device_id: gym.seamDeviceId }),
          })
          const listJson = listRes.ok ? await listRes.json() : { access_codes: [] }
          const oldCode  = listJson.access_codes?.find(c => String(c.code).trim() === pin)
          if (oldCode) {
            await fetch(`${SEAM_API}/access_codes/delete`, {
              method: 'POST', headers: seamHeaders,
              body:   JSON.stringify({ access_code_id: oldCode.access_code_id }),
            })
            console.log('[checkin] deleted old Seam code — id=%s code=%s', oldCode.access_code_id, pin)
          } else {
            console.log('[checkin] no existing Seam code found for pin=%s', pin)
          }
        } catch (deleteErr) {
          console.error('[checkin] Seam delete step error (continuing to create):', deleteErr.message)
        }

        // Step 2: always create a fresh 24-hr code
        try {
          const startsAt      = new Date().toISOString()
          const endsAt        = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          const createPayload = {
            device_id: gym.seamDeviceId,
            name:      profile.name || email,
            code:      pin,
            starts_at: startsAt,
            ends_at:   endsAt,
          }
          console.log('[checkin] Seam create payload — %j', createPayload)
          const createRes  = await fetch(`${SEAM_API}/access_codes/create`, {
            method: 'POST', headers: seamHeaders,
            body:   JSON.stringify(createPayload),
          })
          const createJson = await createRes.json()
          console.log('[checkin] Seam create response — status=%d body=%j', createRes.status, createJson)
          if (!createRes.ok && createJson?.error?.type === 'duplicate_access_code') {
            alreadyActive = true
            console.log('[checkin] duplicate_access_code — code already active for pin=%s', pin)
          }
        } catch (createErr) {
          console.error('[checkin] Seam create step error:', createErr.message)
        }
        }

        // Persist accessCode to DB (handles null case or newly generated code)
        if (accessCode !== profile.accessCode) {
          await prisma.guest.update({ where: { id: profile.id }, data: { accessCode } })
          profile = { ...profile, accessCode }
        }
      }

      // ── Pack exhausted — give guest a final 24-hr window then let Seam auto-expire ──
      if (newCount === 0 && profile?.accessCode && gym.seamApiKey && gym.seamDeviceId) {
        const seamHeaders = { Authorization: `Bearer ${gym.seamApiKey}`, 'Content-Type': 'application/json' }
        const pin         = String(profile.accessCode).trim()

        // Repeat check-in within the window — access is already live, skip touching it
        const validCode = await findValidSeamCode(seamHeaders, gym.seamDeviceId, pin)

        if (validCode) {
          alreadyActive = true
          console.log('[checkin] exhausted — repeat check-in within window, code already valid, skipping refresh — pin=%s ends_at=%s', pin, validCode.ends_at)
        } else {
        // Delete existing code first
        try {
          const listRes  = await fetch(`${SEAM_API}/access_codes/list`, {
            method: 'POST', headers: seamHeaders,
            body:   JSON.stringify({ device_id: gym.seamDeviceId }),
          })
          const listJson = listRes.ok ? await listRes.json() : { access_codes: [] }
          const oldCode  = listJson.access_codes?.find(c => String(c.code).trim() === pin)
          if (oldCode) {
            await fetch(`${SEAM_API}/access_codes/delete`, {
              method: 'POST', headers: seamHeaders,
              body:   JSON.stringify({ access_code_id: oldCode.access_code_id }),
            })
            console.log('[checkin] exhausted — deleted old Seam code id=%s code=%s', oldCode.access_code_id, pin)
          }
        } catch (deleteErr) {
          console.error('[checkin] exhausted — Seam delete error (continuing to create):', deleteErr.message)
        }

        // Create a final 24-hr code — Seam will auto-expire it, no manual delete needed
        try {
          const startsAt      = new Date().toISOString()
          const endsAt        = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          const createPayload = {
            device_id: gym.seamDeviceId,
            name:      profile.name || email,
            code:      pin,
            starts_at: startsAt,
            ends_at:   endsAt,
          }
          console.log('[checkin] exhausted — creating final 24-hr Seam code — %j', createPayload)
          const createRes  = await fetch(`${SEAM_API}/access_codes/create`, {
            method: 'POST', headers: seamHeaders,
            body:   JSON.stringify(createPayload),
          })
          const createJson = await createRes.json()
          console.log('[checkin] exhausted — Seam create response status=%d body=%j', createRes.status, createJson)
        } catch (createErr) {
          console.error('[checkin] exhausted — Seam create error:', createErr.message)
        }
        }
      }

      // ── Fire Zapier guest webhook (check-in) ─────────────────────────────
      if (gym.zapierGuestWebhookUrl) {
        fetch(gym.zapierGuestWebhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:       profile?.name ?? name,
            email,
            accessCode: profile?.accessCode ?? null,
            passType:   updated.passType,
            passesLeft: updated.passesLeft,
            type:       'checkin',
          }),
        })
          .then(r => console.log('[checkin] Zapier guest webhook status:', r.status))
          .catch(e => console.error('[checkin] Zapier guest webhook error:', e.message))
      }

      return NextResponse.json({ ok: true, passesLeft: updated.passesLeft, passType: updated.passType, passTypeLabel: PASS_TYPE_LABEL[updated.passType] ?? updated.passType, accessCode: profile?.accessCode ?? null, alreadyActive })
    }

    // ── No pack found — create a single-use record and deactivate immediately
    await prisma.guestVisit.create({
      data: {
        gymId:          gym.id,
        guestProfileId: profile?.id ?? null,
        guestName:      name || email,
        guestEmail:     email || null,
        passType:       'SINGLE',
        passesLeft:     null,
        usedAt:         new Date(),
        expiresAt:      new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    // Single pass — deactivate immediately after use
    if (profile?.accessCode && gym.seamApiKey && gym.seamDeviceId) {
      await deleteSeamCodeByPin(gym.seamApiKey, profile.accessCode, gym.seamDeviceId, '[checkin]')
    }

    // ── Notify Zapier (fire-and-forget) ─────────────────────────────────
    if (profile?.accessCode) {
      notifyZapier(request, gymSlug, { name: profile.name, email, phone: body.phone, accessCode: profile.accessCode })
    }

    // ── Fire Zapier guest webhook (check-in) ─────────────────────────────
    if (gym.zapierGuestWebhookUrl) {
      fetch(gym.zapierGuestWebhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       profile?.name ?? name,
          email,
          accessCode: profile?.accessCode ?? null,
          passType:   'SINGLE',
          passesLeft: null,
          type:       'checkin',
        }),
      })
        .then(r => console.log('[checkin] Zapier guest webhook status:', r.status))
        .catch(e => console.error('[checkin] Zapier guest webhook error:', e.message))
    }

    return NextResponse.json({ ok: true, passesLeft: null, passType: 'SINGLE', passTypeLabel: 'Day Pass', accessCode: profile?.accessCode ?? null, alreadyActive: false })
  } catch (error) {
    console.error('[guest-passes/checkin]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
