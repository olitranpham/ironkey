import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'
import { maskPin, redactObject } from '@/lib/redact'
import { intakeGuestPass } from '@/lib/guestPassIntake'
import { generateUniquePin, DEFAULT_PIN_LENGTH } from '@/lib/pins'
import { maskEmail, findValidSeamCode } from '@/lib/guestCodeDelivery'
import { limitRequest } from '@/lib/rateLimit'

const SEAM_API = 'https://connect.getseam.com'

const DAY_MS                = 24 * 60 * 60 * 1000
const MAX_DUPLICATE_RETRIES = 5

/**
 * Create a 24-hr code for `pin` on the lock. Seam's duplicate_access_code
 * means the PIN is already taken on the lock — that is a failure, never
 * success: retry with a fresh collision-checked PIN (up to 5 times).
 * @returns {Promise<{ ok: boolean, pin: string, codeId?: string | null, endsAt?: string }>} pin may differ from the one passed in
 */
async function createGuestSeamCode({ seamHeaders, deviceId, gymId, pin, name, seamCodes = [], logPrefix }) {
  const tried   = new Set()
  let candidate = pin
  for (let attempt = 1; attempt <= MAX_DUPLICATE_RETRIES; attempt++) {
    const endsAt        = new Date(Date.now() + DAY_MS).toISOString()
    const createPayload = {
      device_id: deviceId,
      name,
      code:      candidate,
      starts_at: new Date().toISOString(),
      ends_at:   endsAt,
    }
    console.log('%s Seam create payload — %j', logPrefix, redactObject(createPayload))
    const createRes  = await fetch(`${SEAM_API}/access_codes/create`, {
      method: 'POST', headers: seamHeaders,
      body:   JSON.stringify(createPayload),
    })
    const createJson = await createRes.json().catch(() => ({}))
    console.log('%s Seam create response — status=%d body=%j', logPrefix, createRes.status, redactObject(createJson))

    if (createRes.ok) return { ok: true, pin: candidate, codeId: createJson.access_code?.access_code_id ?? null, endsAt }
    if (createJson?.error?.type !== 'duplicate_access_code') return { ok: false, pin: candidate }

    tried.add(candidate)
    console.warn('%s duplicate_access_code for pin=%s — retrying with a new PIN (attempt %d/%d)', logPrefix, maskPin(candidate), attempt, MAX_DUPLICATE_RETRIES)
    candidate = await generateUniquePin(gymId, candidate.length, { seamCodes, exclude: tried })
  }
  return { ok: false, pin: candidate }
}


// Records the check-in as a single guest pass (direct call — previously an HTTP POST to /guest-passes)
function notifyZapier(gymSlug, { name, email, phone, accessCode }) {
  intakeGuestPass(gymSlug, {
    name,
    email,
    phone:      phone ?? null,
    passType:   'single',
    passesLeft: null,
    accessCode,
  })
    .then(({ status, json }) => { if (status >= 400) console.error('[checkin] guest pass record failed:', status, json.error) })
    .catch(e => console.error('[checkin] Zapier notify error:', e.message))
}

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const email = (body.email ?? '').trim().toLowerCase()

    const limited = await limitRequest(request, 'guest-checkin', email)
    if (limited) return limited
    const name  = (body.name  ?? '').trim()

    console.log('[checkin] POST gymSlug=%s email=%s', gymSlug, email)

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true, zapierGuestWebhookUrl: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    // ── Guest profile (global — keyed by email) ─────────────────────────────
    // Request fields are used only to create a NEW profile; an existing
    // profile is never modified by a check-in.
    let profile = await prisma.guest.findUnique({ where: { email } })
    if (!profile) {
      profile = await prisma.guest.create({ data: { name: name || email, email } })
        .catch(async (err) => {
          // Concurrent first check-in created it — use that one, unmodified
          if (err.code === 'P2002') return prisma.guest.findUnique({ where: { email } })
          throw err
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

      // ── Refresh 24-hr Seam code on every check-in ───────────────────────
      let alreadyActive = false
      let codeFailed    = false
      let codeExpiresAt = null
      console.log('[checkin] Seam gate check — newCount=%s profile=%s seamApiKey=%s seamDeviceId=%s',
        newCount, profile?.id ?? 'null', gym.seamApiKey ? '(set)' : 'null', gym.seamDeviceId ?? 'null')

      if (profile && gym.seamApiKey && gym.seamDeviceId && (newCount > 0 || profile.accessCode)) {
        const seamHeaders = { Authorization: `Bearer ${gym.seamApiKey}`, 'Content-Type': 'application/json' }
        const storedPin   = profile.accessCode ? String(profile.accessCode).trim() : null

        // Repeat check-in within the same window — a valid, non-expired code
        // already exists for this PIN, so skip the delete/recreate entirely.
        const validCode = storedPin ? await findValidSeamCode(seamHeaders, gym.seamDeviceId, storedPin) : null

        if (validCode) {
          alreadyActive = true
          codeExpiresAt = validCode.ends_at ?? null
          console.log('[checkin] repeat check-in within window — code already valid, skipping refresh — pin=%s ends_at=%s', maskPin(storedPin), validCode.ends_at)
        } else {
          // Step 1: snapshot the lock's codes, and delete this guest's own
          // stale code (best-effort — never blocks create)
          let seamCodes = []
          try {
            const listRes  = await fetch(`${SEAM_API}/access_codes/list`, {
              method: 'POST', headers: seamHeaders,
              body:   JSON.stringify({ device_id: gym.seamDeviceId }),
            })
            const listJson = listRes.ok ? await listRes.json() : { access_codes: [] }
            seamCodes = (listJson.access_codes ?? []).map(c => String(c.code).trim())
            const oldCode = storedPin ? listJson.access_codes?.find(c => String(c.code).trim() === storedPin) : null
            if (oldCode) {
              await fetch(`${SEAM_API}/access_codes/delete`, {
                method: 'POST', headers: seamHeaders,
                body:   JSON.stringify({ access_code_id: oldCode.access_code_id }),
              })
              console.log('[checkin] deleted old Seam code — id=%s code=%s', oldCode.access_code_id, maskPin(storedPin))
            } else if (storedPin) {
              console.log('[checkin] no existing Seam code found for pin=%s', maskPin(storedPin))
            }
          } catch (deleteErr) {
            console.error('[checkin] Seam delete step error (continuing to create):', deleteErr.message)
          }

          // Step 2: create a fresh 24-hr code (the final window when the pack
          // is now exhausted — Seam auto-expires it). New guests get a
          // collision-checked PIN; duplicates are retried with a new PIN.
          try {
            const pin = storedPin
              ?? await generateUniquePin(gym.id, DEFAULT_PIN_LENGTH, { seamCodes })
            if (!storedPin) console.log('[checkin] generated accessCode=%s for guest=%s', maskPin(pin), email)

            const result = await createGuestSeamCode({
              seamHeaders, deviceId: gym.seamDeviceId, gymId: gym.id,
              pin, name: profile.name || email, seamCodes,
              logPrefix: newCount === 0 ? '[checkin] exhausted —' : '[checkin]',
            })
            if (result.ok) {
              codeExpiresAt = result.endsAt
              if (result.pin !== profile.accessCode) {
                await prisma.guest.update({ where: { id: profile.id }, data: { accessCode: result.pin } })
                profile = { ...profile, accessCode: result.pin }
              }
            } else {
              codeFailed = true
            }
          } catch (createErr) {
            console.error('[checkin] Seam create step error:', createErr.message)
            codeFailed = true
          }
        }
      }

      // No working door code — undo this check-in's pass deduction and fail
      if (codeFailed) {
        await prisma.guestVisit.update({
          where: { id: existing.id },
          data:  { passesLeft: existing.passesLeft, usedAt: existing.usedAt },
        })
        return NextResponse.json(
          { error: 'could not activate a door code — please see the front desk' },
          { status: 503 },
        )
      }

      // ── Fire Zapier guest webhook (check-in) ─────────────────────────────
      if (gym.zapierGuestWebhookUrl) {
        fetch(gym.zapierGuestWebhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:       profile.name,
            email:      profile.email,   // always the profile's email, never the request's
            accessCode: profile.accessCode ?? null,
            passType:   updated.passType,
            passesLeft: updated.passesLeft,
            type:       'checkin',
          }),
        })
          .then(r => console.log('[checkin] Zapier guest webhook status:', r.status))
          .catch(e => console.error('[checkin] Zapier guest webhook error:', e.message))
      }

      // The code is never returned — it's emailed by the gym's guest webhook
      return NextResponse.json({ ok: true, sentTo: maskEmail(profile.email), passesLeft: updated.passesLeft, expiresAt: codeExpiresAt })
    }

    // ── No pack found — create a single-use record and deactivate immediately
    const singleVisit = await prisma.guestVisit.create({
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
      notifyZapier(gymSlug, { name: profile.name, email: profile.email, phone: body.phone, accessCode: profile.accessCode })
    }

    // ── Fire Zapier guest webhook (check-in) ─────────────────────────────
    if (gym.zapierGuestWebhookUrl) {
      fetch(gym.zapierGuestWebhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:       profile.name,
          email:      profile.email,   // always the profile's email, never the request's
          accessCode: profile.accessCode ?? null,
          passType:   'SINGLE',
          passesLeft: null,
          type:       'checkin',
        }),
      })
        .then(r => console.log('[checkin] Zapier guest webhook status:', r.status))
        .catch(e => console.error('[checkin] Zapier guest webhook error:', e.message))
    }

    return NextResponse.json({ ok: true, sentTo: maskEmail(profile.email), passesLeft: null, expiresAt: singleVisit.expiresAt })
  } catch (error) {
    console.error('[guest-passes/checkin]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
