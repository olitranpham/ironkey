import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { maskPin, redactObject } from '@/lib/redact'
import { generateUniquePin, DEFAULT_PIN_LENGTH } from '@/lib/pins'
import { maskEmail, findValidSeamCode, deliverGuestCode } from '@/lib/guestCodeDelivery'
import { withPhone } from '@/lib/zapierPayload'
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
async function createGuestSeamCode({ seamHeaders, deviceId, gymId, guestId, pin, name, seamCodes = [], logPrefix }) {
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
    candidate = await generateUniquePin(gymId, candidate.length, { seamCodes, exclude: tried, guestId })
  }
  return { ok: false, pin: candidate }
}


const DELIVERY_FAILED = () => NextResponse.json(
  { error: "we couldn't send your code. please see the front desk." },
  { status: 502 },
)

/**
 * POST /api/[gymSlug]/guest-passes/checkin
 * Public kiosk check-in. Body: { email, name? }
 *
 * Uses one pass from the guest's active pack at this gym. No active pack →
 * 402 { ok: false, needsPass: true } and nothing is created or changed (the
 * kiosk sends them to the guest checkout).
 *
 * Never returns the door code: it is emailed by the gym's guest Zapier webhook
 * to the email on the profile. If the gym has no webhook, or delivery fails
 * (non-2xx / error / 5 s timeout), everything this request did is undone and
 * the kiosk gets 502.
 */
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

    // No way to deliver a code → refuse before changing anything
    if (!gym.zapierGuestWebhookUrl) {
      console.error('[guest-code-delivery] gym=%s status=no_webhook_configured', gymSlug)
      return DELIVERY_FAILED()
    }

    // ── Everything this request changes, so it can be undone ────────────────
    const undo = {
      createdProfileId:   null,   // profile created by this request
      restoreVisit:       null,   // { id, usedAt, guestProfileId } — passesLeft is re-incremented
      checkInId:          null,   // GuestCheckIn written with the decrement
      activatedSeamCode:  null,   // { seamHeaders, codeId } activated by this request
      restoreProfileCode: null,   // { id, accessCode } previous profile code
    }
    async function rollback() {
      try {
        if (undo.activatedSeamCode?.codeId) {
          await fetch(`${SEAM_API}/access_codes/delete`, {
            method: 'POST', headers: undo.activatedSeamCode.seamHeaders,
            body:   JSON.stringify({ access_code_id: undo.activatedSeamCode.codeId }),
          }).catch(e => console.error('[checkin] rollback Seam delete failed:', e.message))
        }
        if (undo.restoreVisit) {
          const { id, ...data } = undo.restoreVisit
          // Give the pass back (increment, so a concurrent check-in's decrement
          // isn't undone too) and drop this check-in's row, together
          await prisma.$transaction([
            ...(undo.checkInId ? [prisma.guestCheckIn.delete({ where: { id: undo.checkInId } })] : []),
            prisma.guestVisit.update({ where: { id }, data: { ...data, passesLeft: { increment: 1 } } }),
          ])
        }
        if (undo.restoreProfileCode) {
          await prisma.guest.update({ where: { id: undo.restoreProfileCode.id }, data: { accessCode: undo.restoreProfileCode.accessCode } })
        }
        if (undo.createdProfileId) {
          await prisma.guest.delete({ where: { id: undo.createdProfileId } }).catch(() => {})
        }
      } catch (e) {
        console.error('[checkin] rollback error:', e.message)
      }
    }

    // ── Most recent pack with passes remaining (checked before touching any profile)
    const existing = await prisma.guestVisit.findFirst({
      where: {
        gymId:      gym.id,
        guestEmail: { equals: email, mode: 'insensitive' },
        passesLeft: { gt: 0 },
      },
      orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
    })

    // No active pass → nothing is created, issued or deleted; the kiosk sends them to checkout
    if (!existing) {
      return NextResponse.json({ ok: false, needsPass: true }, { status: 402 })
    }

    // ── Guest profile (global — keyed by email) ─────────────────────────────
    // Request fields are used only to create a NEW profile; an existing
    // profile is never modified by a check-in.
    let profile = await prisma.guest.findUnique({ where: { email } })
    if (!profile) {
      profile = await prisma.guest.create({ data: { name: name || email, email } })
        .then(p => { undo.createdProfileId = p.id; return p })
        .catch(async (err) => {
          // Concurrent first check-in created it — use that one, unmodified
          if (err.code === 'P2002') return prisma.guest.findUnique({ where: { email } })
          throw err
        })
    }

    const newCount = existing.passesLeft - 1
    // Decrement and record the visit together. The decrement only applies if
    // passesLeft is still what was read above, so two simultaneous check-ins
    // can't both spend the same pass.
    const used = await prisma.$transaction(async tx => {
      const { count } = await tx.guestVisit.updateMany({
        where: { id: existing.id, passesLeft: existing.passesLeft },
        data:  {
          passesLeft:     newCount,
          usedAt:         new Date(),
          guestProfileId: profile.id,
        },
      })
      if (count !== 1) return null
      const checkIn = await tx.guestCheckIn.create({ data: { gymId: gym.id, guestPassId: existing.id, guestProfileId: profile.id } })
      const visit   = await tx.guestVisit.findUnique({ where: { id: existing.id } })
      return { checkIn, visit }
    })
    if (!used) {
      await rollback()
      return NextResponse.json({ error: 'check-in already in progress — please try again' }, { status: 409 })
    }
    // So a failed delivery can undo this check-in
    undo.restoreVisit = { id: existing.id, usedAt: existing.usedAt, guestProfileId: existing.guestProfileId }
    undo.checkInId    = used.checkIn.id
    const updated     = used.visit

    // ── Refresh 24-hr Seam code on every check-in ───────────────────────
    let codeFailed    = false
    let codeExpiresAt = null
    console.log('[checkin] Seam gate check — newCount=%s profile=%s seamApiKey=%s seamDeviceId=%s',
      newCount, profile.id, gym.seamApiKey ? '(set)' : 'null', gym.seamDeviceId ?? 'null')

    if (gym.seamApiKey && gym.seamDeviceId && (newCount > 0 || profile.accessCode)) {
      const seamHeaders = { Authorization: `Bearer ${gym.seamApiKey}`, 'Content-Type': 'application/json' }
      const storedPin   = profile.accessCode ? String(profile.accessCode).trim() : null

      // Repeat check-in within the same window — a valid, non-expired code
      // already exists for this PIN, so skip the delete/recreate entirely.
      const validCode = storedPin ? await findValidSeamCode(seamHeaders, gym.seamDeviceId, storedPin) : null

      if (validCode) {
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
            ?? await generateUniquePin(gym.id, DEFAULT_PIN_LENGTH, { seamCodes, guestId: profile.id })
          if (!storedPin) console.log('[checkin] generated accessCode=%s for guest=%s', maskPin(pin), email)

          const result = await createGuestSeamCode({
            seamHeaders, deviceId: gym.seamDeviceId, gymId: gym.id, guestId: profile.id,
            pin, name: profile.name || email, seamCodes,
            logPrefix: newCount === 0 ? '[checkin] exhausted —' : '[checkin]',
          })
          if (result.ok) {
            codeExpiresAt = result.endsAt
            undo.activatedSeamCode = { seamHeaders, codeId: result.codeId }
            if (result.pin !== profile.accessCode) {
              undo.restoreProfileCode = { id: profile.id, accessCode: profile.accessCode }
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

    // No working door code — undo this check-in and fail
    if (codeFailed) {
      await rollback()
      return NextResponse.json(
        { error: 'could not activate a door code — please see the front desk' },
        { status: 503 },
      )
    }

    // ── Deliver the code (guest Zapier webhook → email on the profile) ────
    const delivered = await deliverGuestCode(gym, gymSlug, withPhone({
      name:       profile.name,
      email:      profile.email,   // always the profile's email, never the request's
      accessCode: profile.accessCode ?? null,
      passType:   updated.passType,
      passesLeft: updated.passesLeft,
      type:       'checkin',
    }, profile.phone, `guest=${profile.id}`))
    if (!delivered) {
      await rollback()
      return DELIVERY_FAILED()
    }

    // The code is never returned — it's emailed by the gym's guest webhook
    return NextResponse.json({ ok: true, sentTo: maskEmail(profile.email), passesLeft: updated.passesLeft, expiresAt: codeExpiresAt })
  } catch (error) {
    console.error('[guest-passes/checkin]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
