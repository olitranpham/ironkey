import prisma from '@/lib/prisma'
import { getAllowedPassTypes } from '@/lib/gymPassTypes'
import { formatPhone } from '@/lib/phone'

const PASS_TYPE_MAP = {
  single:     'SINGLE',
  '3-pack':   'THREE_PACK',
  '5-pack':   'FIVE_PACK',
  '10-pack':  'TEN_PACK',
  three_pack: 'THREE_PACK',
  five_pack:  'FIVE_PACK',
  ten_pack:   'TEN_PACK',
  value:      'VALUE',
  deluxe:     'DELUXE',
}

const PASS_TYPE_LABEL = {
  SINGLE:     'Day Pass',
  THREE_PACK: '3-Pack',
  FIVE_PACK:  '5-Pack',
  TEN_PACK:   '10-Pack',
  VALUE:      'Value',
  DELUXE:     'Deluxe',
}

/**
 * Record a guest pass purchase: upsert the (global, email-keyed) guest
 * profile, store an incoming access code for a new guest, and create the
 * GuestVisit together with a GuestCheckIn for the pass used at purchase.
 * Returns the guest's stored access code.
 *
 * With stripeSessionId, a second call for the same session creates nothing
 * and returns the existing pass with `duplicate: true` (status 200).
 *
 * Shared by POST /api/[gymSlug]/guest-passes (Zapier), the guest check-in
 * route and the platform Stripe webhook, which call it directly instead of
 * over HTTP. Callers are responsible for authorization.
 *
 * Access code logic:
 *  - Returning guest (profile.accessCode exists) → reuse stored code, ignore body.accessCode
 *  - New guest (no accessCode yet) → save body.accessCode to profile
 *
 * Body: { name, email?, phone?, passType?, passesLeft?, accessCode?,
 *         stripeSessionId?, stripePriceId?, packSize?, amountPaid? }
 *
 * @param {string} gymSlug
 * @param {object} body
 * @param {{ onCreate?: (tx: object, pass: object) => Promise<void> }} [options]
 *   onCreate runs inside the pass + check-in transaction (the webhook enqueues
 *   its follow-up job there)
 * @returns {Promise<{ status: number, json: object }>}
 */
export async function intakeGuestPass(gymSlug, body, { onCreate } = {}) {
  const guestName = (body.name ?? '').trim()
  if (!guestName) {
    return { status: 400, json: { error: 'name is required' } }
  }

  const gym = await prisma.gym.findUnique({
    where:  { slug: gymSlug },
    select: { id: true },
  })
  if (!gym) {
    return { status: 404, json: { error: 'Gym not found' } }
  }

  const rawType  = (body.passType ?? '').toLowerCase().trim()
  const passType = PASS_TYPE_MAP[rawType] ?? 'SINGLE'

  const allowed = getAllowedPassTypes(gymSlug)
  if (!allowed.includes(passType)) {
    return { status: 400, json: { error: `Pass type "${passType}" is not available for this gym` } }
  }
  const email    = (body.email ?? '').trim().toLowerCase() || null
  const phone    = formatPhone(body.phone ?? null)

  //  Guest profile (global — keyed by email only). Request name/phone/email
  //  are used only when creating a NEW profile — an existing profile's
  //  contact details are never overwritten here.
  let profile = null
  if (email) {
    profile = await prisma.guest.findUnique({ where: { email } })
    if (!profile) {
      profile = await prisma.guest.create({
        data: {
          name:  guestName,
          email,
          phone: phone ?? null,
        },
      }).catch(async (err) => {
        // Concurrent request created it — use that one, unmodified
        if (err.code === 'P2002') return prisma.guest.findUnique({ where: { email } })
        throw err
      })
    }

    if (profile.accessCode) {
      // Returning guest -- accessCode already stored, Zapier will reprogram Seam
    } else {
      // New guest -- save incoming code to profile
      const incomingCode = body.accessCode ? String(body.accessCode).trim() : null
      if (incomingCode) {
        profile = await prisma.guest.update({
          where: { id: profile.id },
          data:  { accessCode: incomingCode },
        })
      }
    }
  }

  //  Create the pass, and the check-in for the pass used at purchase, together
  const stripeSessionId = body.stripeSessionId || null
  let pass
  try {
    pass = await prisma.$transaction(async tx => {
      const created = await tx.guestVisit.create({
        data: {
          gymId:          gym.id,
          guestProfileId: profile?.id ?? null,
          guestName,
          guestEmail:     email,
          guestPhone:     phone ?? null,
          passType,
          passesLeft:     body.passesLeft != null && passType !== 'SINGLE'
                            ? Math.max(0, Number(body.passesLeft) - 1)
                            : null,
          usedAt:         new Date(),
          expiresAt:      new Date(Date.now() + 24 * 60 * 60 * 1000),
          stripeSessionId,
          stripePriceId:  body.stripePriceId || null,
          packSize:       Number.isInteger(body.packSize) ? body.packSize : null,
          amountPaid:     Number.isInteger(body.amountPaid) ? body.amountPaid : null,
        },
      })
      await tx.guestCheckIn.create({
        data: { gymId: gym.id, guestPassId: created.id, guestProfileId: profile?.id ?? null },
      })
      if (onCreate) await onCreate(tx, created)
      return created
    })
  } catch (err) {
    // Same Checkout session already recorded (concurrent webhook delivery)
    if (err.code === 'P2002' && stripeSessionId) {
      const existing = await prisma.guestVisit.findUnique({ where: { stripeSessionId } })
      if (existing) return { status: 200, json: { pass: existing, accessCode: profile?.accessCode ?? null, duplicate: true } }
    }
    throw err
  }

  const accessCode = profile?.accessCode ?? null
  return {
    status: 201,
    json: {
      pass,
      accessCode,
      passTypeLabel: PASS_TYPE_LABEL[passType] ?? passType,
    },
  }
}
