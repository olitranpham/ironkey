import prisma from '@/lib/prisma'
import { ensureKisiMembership } from '@/lib/kisi'
import { formatPhone } from '@/lib/phone'
import { maskPin, redactObject, redactJsonText } from '@/lib/redact'
import { writeAudit } from '@/lib/audit'
import { generateUniquePin, isPinInUse } from '@/lib/pins'

const SEAM_API = 'https://connect.getseam.com'

/**
 * Create or update a member by (gym, email), then program their access code
 * on Seam (or grant Kisi access) if configured.
 *
 * Shared by POST /api/[gymSlug]/members (Zapier / door-access form) and the
 * platform Stripe webhook, which calls it directly instead of over HTTP.
 * Callers are responsible for authorization.
 *
 * Body: { firstName?, lastName?, name?, email, phone?, membershipType?, accessCode?, joinDate?, customerId?, subId? }
 *
 * Status: set to ACTIVE only when the member is created. Updating an existing
 * member never changes status — unless the caller passes options.reactivate
 * (only the Stripe webhook, after a new active subscription checkout), which
 * re-activates a non-ACTIVE member and records a membership event + audit entry.
 * `reactivate` is deliberately a separate argument, never read from `body`.
 *
 * @param {string} gymSlug
 * @param {object} body
 * @param {{ reactivate?: boolean, via?: string, db?: object, provision?: boolean }} [options]
 *   db — a transaction client for the member writes (default: prisma).
 *   provision: false skips Kisi/Seam (the platform webhook does those in its
 *   follow-up job instead).
 * @returns {Promise<{ status: number, json: object }>}
 */
export async function intakeMember(gymSlug, body, { reactivate = false, via = 'intake', db = prisma, provision = true } = {}) {
  const email = (body.email ?? '').toLowerCase().trim()
  if (!email) {
    return { status: 400, json: { error: 'email is required' } }
  }

  // Accept either name (single field) or firstName + lastName separately
  let firstName, lastName
  if (body.name) {
    const parts = body.name.trim().split(/\s+/)
    firstName = parts[0] ?? 'Unknown'
    lastName  = parts.slice(1).join(' ') || ''
  } else {
    firstName = (body.firstName ?? '').trim() || 'Unknown'
    lastName  = (body.lastName  ?? '').trim() || ''
  }

  const phone          = formatPhone(body.phone ?? null)
  const customerId     = body.customerId ?? null
  const subId          = body.subId      ?? null
  let accessCode       = body.accessCode ? String(body.accessCode).trim() : null
  const membershipType = (body.membershipType ?? '').toLowerCase().trim() || 'general'
  const dateAccessed   = body.joinDate ? new Date(body.joinDate) : null

  const gym = await prisma.gym.findUnique({
    where:  { slug: gymSlug },
    select: { id: true, seamApiKey: true, seamDeviceId: true, accessProvider: true, kisiApiKey: true, kisiPlaceId: true, kisiMemberGroupId: true, kisiWeekendGroupId: true },
  })
  if (!gym) {
    return { status: 404, json: { error: 'Gym not found' } }
  }

  // Snapshot pre-upsert state — the reactivate check and Kisi's tier-change
  // check (below) need status/membershipType/assignment as they were before.
  const memberBeforeUpsert = await db.member.findUnique({ where: { gymId_email: { gymId: gym.id, email } } })
  const shouldReactivate   = Boolean(reactivate && memberBeforeUpsert && memberBeforeUpsert.status !== 'ACTIVE')

  // A requested code already used by someone else at this gym is never
  // shared — this member gets a fresh unique PIN instead.
  if (accessCode && await isPinInUse(gym.id, accessCode, { memberId: memberBeforeUpsert?.id ?? null })) {
    const replacement = await generateUniquePin(gym.id, accessCode.length >= 4 && accessCode.length <= 8 ? accessCode.length : undefined)
    console.warn('[members POST] requested code=%s is already in use at this gym — issuing code=%s instead', maskPin(accessCode), maskPin(replacement))
    accessCode = replacement
  }

  let member = await db.member.upsert({
    where:  { gymId_email: { gymId: gym.id, email } },
    create: {
      gymId: gym.id, firstName, lastName, email,
      phone, membershipType,
      status: 'ACTIVE',
      stripeCustomerId:     customerId,
      stripeSubscriptionId: subId,
      ...(accessCode   ? { accessCode }   : {}),
      ...(dateAccessed ? { dateAccessed } : {}),
    },
    update: {
      firstName,
      lastName,
      membershipType,
      ...(shouldReactivate ? { status: 'ACTIVE', dateFrozen: null } : {}),
      ...(phone        ? { phone }                              : {}),
      ...(customerId   ? { stripeCustomerId:     customerId }   : {}),
      ...(subId        ? { stripeSubscriptionId: subId }        : {}),
      ...(accessCode   ? { accessCode }                         : {}),
      ...(dateAccessed ? { dateAccessed }                       : {}),
    },
  })

  if (shouldReactivate) {
    await db.membershipEvent.create({ data: { memberId: member.id, gymId: gym.id, type: 'reactivated' } })
    writeAudit({ gym, user: null }, 'member.reactivate', 'Member', member.id, { via, from: memberBeforeUpsert.status })
  }

  if (!provision) return { status: 200, json: { member } }

  if (gym.accessProvider === 'KISI') {
    // ── Grant/update Kisi access ─────────────────────────────────────────
    try {
      const result = await ensureKisiMembership(gym, {
        existingMember: memberBeforeUpsert,
        email,
        name: `${firstName} ${lastName}`.trim(),
        membershipType,
      })
      if (result) {
        await prisma.member.update({
          where: { id: member.id },
          data:  { kisiUserId: result.kisiUserId, kisiRoleAssignmentId: result.kisiRoleAssignmentId },
        })
      }
    } catch (err) {
      console.error('[members POST] Kisi error:', err.message)
    }
    return { status: 200, json: { member } }
  }

  // ── Program Seam access code ──────────────────────────────────────────────
  const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
  const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

  if (accessCode && apiKey && deviceId) {
    console.log('[members POST] programming Seam code=%s device=%s member=%s', maskPin(accessCode), deviceId, member.id)
    try {
      const seamHeaders = {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
      const memberName = `${firstName} ${lastName}`.trim()

      // Check if a code with this PIN already exists on the device
      const listRes  = await fetch(`${SEAM_API}/access_codes/list`, {
        method:  'POST',
        headers: seamHeaders,
        body:    JSON.stringify({ device_id: deviceId }),
      })

      if (!listRes.ok) {
        const listText = await listRes.text()
        console.error('[members POST] Seam list failed status=%d body=%j', listRes.status, redactJsonText(listText))
      } else {
        const { access_codes = [] } = await listRes.json()
        let existing = access_codes.find(c => c.code != null && String(c.code).trim() === accessCode)

        // The PIN is on the lock but wasn't this member's code before this
        // request → it belongs to someone else (or is orphaned). Never relabel
        // it: issue this member a new unique PIN and create that instead.
        if (existing && memberBeforeUpsert?.accessCode !== accessCode) {
          const lockCodes   = access_codes.map(c => c.code).filter(c => c != null)
          const replacement = await generateUniquePin(gym.id, undefined, { seamCodes: lockCodes, exclude: [accessCode] })
          console.warn('[members POST] code=%s already on the lock for someone else — issuing code=%s to member=%s', maskPin(accessCode), maskPin(replacement), member.id)
          accessCode = replacement
          member     = await prisma.member.update({ where: { id: member.id }, data: { accessCode } })
          existing   = null
        }

        if (existing) {
          // PIN already on device and it is this member's own code — update the label to their name
          const updateRes  = await fetch(`${SEAM_API}/access_codes/update`, {
            method:  'POST',
            headers: seamHeaders,
            body:    JSON.stringify({ access_code_id: existing.access_code_id, name: memberName }),
          })
          const updateBody = await updateRes.json().catch(() => ({}))
          if (updateRes.ok) {
            console.log('[members POST] Seam update OK — access_code_id=%s name="%s" code=%s', existing.access_code_id, memberName, maskPin(accessCode))
          } else {
            console.error('[members POST] Seam update FAILED status=%d body=%j', updateRes.status, redactObject(updateBody))
          }
        } else {
          // PIN not on device — create a new code
          const createRes  = await fetch(`${SEAM_API}/access_codes/create`, {
            method:  'POST',
            headers: seamHeaders,
            body:    JSON.stringify({ device_id: deviceId, name: memberName, code: accessCode }),
          })
          const createBody = await createRes.json().catch(() => ({}))
          if (createRes.ok) {
            console.log('[members POST] Seam create OK — access_code_id=%s name="%s" code=%s', createBody?.access_code?.access_code_id, memberName, maskPin(accessCode))
          } else {
            console.error('[members POST] Seam create FAILED status=%d body=%j', createRes.status, redactObject(createBody))
          }
        }
      }
    } catch (seamErr) {
      // Seam failure must not block the member creation response
      console.error('[members POST] Seam programming threw: %s', seamErr.message)
    }
  } else {
    console.log('[members POST] skipping Seam — accessCode=%s apiKey=%s deviceId=%s',
      accessCode ? maskPin(accessCode) : 'none',
      apiKey   ? '(set)' : 'MISSING',
      deviceId ? '(set)' : 'MISSING',
    )
  }

  return { status: 200, json: { member } }
}
