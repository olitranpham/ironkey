import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin } from '@/lib/seam'
import { revokeAccess as revokeKisiAccess } from '@/lib/kisi'
import { formatPhone } from '@/lib/phone'
import { normalizeGradSemester } from '@/lib/gradSemester'
import { maskPin, redactObject } from '@/lib/redact'
import { intakeMember } from '@/lib/memberIntake'
import { intakeGuestPass } from '@/lib/guestPassIntake'
import { writeAudit } from '@/lib/audit'
import { generateUniquePin } from '@/lib/pins'
import { OASIS_GYM_SLUG, OASIS_GUEST_PASS_PRODUCTS, isOasisGuestPassProduct } from '@/lib/oasisGuestPasses'
import { recordCouponRedemption } from '@/lib/couponRedemption'
import { resolvePackSize } from '@/lib/gymPassTypes'
import { kickJob } from '@/lib/webhookJobs'
import { stripeSessionPhone } from '@/lib/zapierPayload'

/** Trimmed string, or null for null/undefined/blank. */
function normalizePhone(value) {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

/**
 * If a guest profile with this email has a Lead row at this gym that isn't
 * converted yet, mark it converted. Failures are logged, never thrown.
 */
async function markLeadConverted(gym, email) {
  try {
    const normalized = (email ?? '').trim().toLowerCase()
    if (!normalized) return
    const { count } = await prisma.lead.updateMany({
      where: { gymId: gym.id, status: { not: 'converted' }, guestProfile: { email: normalized } },
      data:  { status: 'converted', convertedAt: new Date() },
    })
    if (count) {
      console.log('[platform/webhook] lead converted gym=%s', gym.slug)
      writeAudit({ gym, user: null }, 'lead.converted', 'Lead', null, { via: 'stripe_checkout' })
    }
  } catch (err) {
    console.error('[platform/webhook] lead conversion update failed:', err.message)
  }
}

/**
 * POST /api/stripe/webhook
 * Platform-level Stripe Connect webhook.
 *
 * Receives events from ALL connected accounts. The `account` field on the
 * event identifies which connected account triggered it. We look up the gym
 * by stripeAccountId, then run the same handler logic as the per-gym webhook.
 *
 * Register this URL once in the Stripe dashboard under
 * Connect → Webhooks → "Listen to events on connected accounts".
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY         — platform secret key
 *   STRIPE_WEBHOOK_SECRET     — platform Connect webhook signing secret
 */
export async function POST(request) {
  const rawBody = await request.text()
  const sig     = request.headers.get('stripe-signature')

  // ── Verify signature ──────────────────────────────────────────────────────
  // Every event must be signed. An unverified body is never parsed or acted on.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[platform/webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting event')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err) {
    console.error('[platform/webhook] signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // ── Identify gym via connected account ───────────────────────────────────
  const connectedAccountId = event.account
  if (!connectedAccountId) {
    // Platform-level event with no connected account — not handled here
    console.log('[platform/webhook] ignoring platform-level event (no account):', event.type)
    return NextResponse.json({ received: true })
  }

  const gym = await prisma.gym.findFirst({
    where:  { stripeAccountId: connectedAccountId },
    select: {
      id:                     true,
      slug:                   true,
      stripeSecretKey:        true,
      seamApiKey:             true,
      seamDeviceId:           true,
      zapierMemberWebhookUrl: true,
      zapierGuestWebhookUrl:  true,
      accessProvider:         true,
      kisiApiKey:             true,
      kisiPlaceId:            true,
      kisiMemberGroupId:      true,
      kisiWeekendGroupId:     true,
    },
  })

  if (!gym) {
    console.warn('[platform/webhook] no gym found for account:', connectedAccountId)
    return NextResponse.json({ received: true })
  }

  const gymSlug = gym.slug

  // Use the stored connected account access_token for per-account API calls,
  // falling back to platform key + stripeAccount option if not stored.
  const accountStripe = gym.stripeSecretKey
    ? new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    : new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

  console.log('[platform/webhook]', gymSlug, '| account:', connectedAccountId, '| event:', event.type)

  // ── checkout.session.completed ────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const meta    = session.metadata ?? {}

    // ── Guest pass purchase ─────────────────────────────────────────────────
    if (meta.source === 'guest_pass') {
      // Repeated delivery of a session already recorded → no-op (no second
      // pass, Seam code or email)
      const recorded = await prisma.guestVisit.findUnique({ where: { stripeSessionId: session.id }, select: { id: true } })
      if (recorded) {
        console.log('[platform/webhook] guest pass already recorded for session', session.id, '— ignoring repeat delivery')
        return NextResponse.json({ received: true })
      }

      const guestName  = meta.guestName ?? ''
      const email      = (session.customer_email ?? meta.email ?? '').toLowerCase()
      // Ironkey checkout form phone (session metadata): formatted, trimmed, blank → null.
      // Same value is saved to the profile and sent in the Oasis payload.
      const phone      = normalizePhone(formatPhone(meta.phone || null))
      const passesLeft = parseInt(meta.passesLeft, 10) || 1

      // Expand line items — the price/product IDs give the pass type and pack size
      let lineItemPriceId   = null
      let lineItemProductId = null
      let lineItemProduct   = null   // expanded product object (id + metadata), when available
      try {
        const expandOptions = gym.stripeSecretKey
          ? {}
          : { stripeAccount: connectedAccountId }
        const expanded = await accountStripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items', 'line_items.data.price.product'],
          ...expandOptions,
        })
        const lineItem = expanded.line_items?.data?.[0]
        lineItemPriceId   = lineItem?.price?.id      ?? null
        const product     = lineItem?.price?.product ?? null
        lineItemProduct   = typeof product === 'object' ? product : null
        lineItemProductId = typeof product === 'string' ? product : product?.id ?? null
        console.log('[platform/webhook] guest pass line item — priceId:', lineItemPriceId, '| productId:', lineItemProductId)
      } catch (err) {
        console.error('[platform/webhook] failed to expand guest pass line items:', err.message)
      }

      // Fallback product → passType map (used when metadata passType is missing)
      const passType = meta.passType
        || (lineItemProductId && OASIS_GUEST_PASS_PRODUCTS[lineItemProductId]?.passType)
        || 'SINGLE'

      // Oasis guest passes send the buyer's phone to Zapier (below). Product-ID
      // keyed (same rule as the kiosk listing); if the line items couldn't be
      // loaded, a guest_pass checkout at Oasis is still a guest pass.
      const isOasisGuestPass = gymSlug === OASIS_GYM_SLUG
        && (!lineItemProductId || isOasisGuestPassProduct(lineItemProduct ?? lineItemProductId))

      console.log('[platform/webhook] guest pass — passType:', passType, '| source:', meta.passType ? 'metadata' : lineItemProductId ? 'product map' : 'default')

      const guestIsMinor = meta.isMinor === 'true'

      let guestProfile = null
      if (email) {
        console.log('[platform/webhook] guest upsert — dob:', meta.dob || '(empty)', '| address:', meta.address || '(empty)', '| emergencyName:', meta.emergencyName || '(empty)', '| emergencyPhone:', meta.emergencyPhone || '(empty)', '| emergencyRelationship:', meta.emergencyRelationship || '(empty)', '| isMinor:', guestIsMinor)
        guestProfile = await prisma.guest.upsert({
          where:  { email },
          update: {
            name:                        guestName             || undefined,
            phone:                       phone                 || undefined,
            dateOfBirth:                 meta.dob              || undefined,
            address:                     meta.address          || undefined,
            emergencyContactName:        meta.emergencyName    || undefined,
            emergencyContactPhone:       meta.emergencyPhone   || undefined,
            emergencyContactRelationship: meta.emergencyRelationship || undefined,
            ...(guestIsMinor ? {
              isMinor:              true,
              guardianName:         meta.guardianName         || null,
              guardianEmail:        meta.guardianEmail        || null,
              guardianPhone:        meta.guardianPhone        || null,
              guardianRelationship: meta.guardianRelationship || null,
            } : {}),
          },
          create: {
            name:                        guestName || email,
            email,
            phone,
            dateOfBirth:                 meta.dob              || null,
            address:                     meta.address          || null,
            emergencyContactName:        meta.emergencyName    || null,
            emergencyContactPhone:       meta.emergencyPhone   || null,
            emergencyContactRelationship: meta.emergencyRelationship || null,
            isMinor:                     guestIsMinor,
            guardianName:                guestIsMinor ? (meta.guardianName         || null) : null,
            guardianEmail:               guestIsMinor ? (meta.guardianEmail        || null) : null,
            guardianPhone:               guestIsMinor ? (meta.guardianPhone        || null) : null,
            guardianRelationship:        guestIsMinor ? (meta.guardianRelationship || null) : null,
          },
        })
      }

      let firstTime = true
      if (guestProfile) {
        const existingWaiver = await prisma.guestWaiver.findUnique({
          where: { guestProfileId_gymId: { guestProfileId: guestProfile.id, gymId: gym.id } },
        })
        firstTime = !existingWaiver
        if (!existingWaiver) {
          await prisma.guestWaiver.create({
            data: { guestProfileId: guestProfile.id, gymId: gym.id },
          }).catch(err => {
            // A concurrent delivery of this session created it first
            if (err.code !== 'P2002') throw err
          })
        }
      }

      let accessCode = guestProfile?.accessCode ?? null
      if (!accessCode) {
        accessCode = await generateUniquePin(gym.id, undefined, { guestId: guestProfile?.id ?? null })
        if (guestProfile) {
          await prisma.guest.update({
            where: { id: guestProfile.id },
            data:  { accessCode },
          })
        }
        console.log('[platform/webhook] generated accessCode', maskPin(accessCode), 'for new guest', email)
      } else {
        console.log('[platform/webhook] reusing accessCode', maskPin(accessCode), 'for returning guest', email)
      }

      // Oasis payload phone: checkout form phone → phone already on the profile → null
      const oasisPayloadPhone = isOasisGuestPass
        ? (phone ?? normalizePhone(guestProfile?.phone) ?? null)
        : null
      if (isOasisGuestPass) {
        console.log('[platform/webhook] oasis guest pass phone source=%s',
          phone ? 'checkout_form' : normalizePhone(guestProfile?.phone) ? 'profile' : 'none')
      }

      // Zapier phone comes from the guest profile at send time; Stripe's phone
      // is the fallback when there's no profile phone (or no profile)
      const stripePhone = (phone || normalizePhone(guestProfile?.phone))
        ? null
        : await stripeSessionPhone(accountStripe, session, gym.stripeSecretKey ? {} : { stripeAccount: connectedAccountId })

      // Pass + check-in + follow-up job in one transaction. The Seam code and
      // the Zapier email run in the job after Stripe has its 200 (they used
      // to run here and could take long enough for Stripe to give up and
      // resend the event).
      let job = null
      try {
        const { status: intakeStatus, json: intakeJson } = await intakeGuestPass(gymSlug, {
          name:       guestName,
          email,
          phone,
          passType:   passType.toLowerCase(),
          passesLeft: passType === 'SINGLE' ? null : passesLeft,
          accessCode,
          stripeSessionId: session.id,
          stripePriceId:   lineItemPriceId,
          packSize:        resolvePackSize(gymSlug, { priceId: lineItemPriceId, product: lineItemProduct ?? lineItemProductId }),
          // What the guest actually paid (cents, after discounts)
          amountPaid:      session.amount_total,
        }, {
          onCreate: async (tx, pass) => {
            job = await tx.webhookJob.create({
              data: {
                kind:            'guest_access',
                gymId:           gym.id,
                guestPassId:     pass.id,
                stripeSessionId: session.id,
                payload: {
                  guestProfileId: guestProfile?.id ?? null,
                  accessCode,
                  seamName:  guestName || email,
                  // Same 24-hour window as the pass itself
                  startsAt:  pass.createdAt.toISOString(),
                  endsAt:    pass.expiresAt.toISOString(),
                  seamCodes: {},
                  stripePhone,
                  // Zapier guest payload (accessCode and phone are added at
                  // send time — a Seam PIN collision can change the code)
                  zapier: {
                    name: guestName, email, passType, passesLeft: pass.passesLeft, firstTime, alreadyActive: false,
                    ...(isOasisGuestPass ? { phone: oasisPayloadPhone } : {}),
                    isMinor:              guestIsMinor,
                    guardianName:         guestIsMinor ? (meta.guardianName         || null) : null,
                    guardianEmail:        guestIsMinor ? (meta.guardianEmail        || null) : null,
                    guardianPhone:        guestIsMinor ? (meta.guardianPhone        || null) : null,
                    guardianRelationship: guestIsMinor ? (meta.guardianRelationship || null) : null,
                  },
                },
              },
            })
          },
        })
        if (intakeJson.duplicate) {
          // A concurrent delivery of this session recorded it (and its job) first
          console.log('[platform/webhook] guest pass already recorded for session', session.id, '— skipping')
          return NextResponse.json({ received: true })
        }
        if (intakeStatus >= 400) {
          console.error('[platform/webhook] guest pass not recorded session=%s status=%d %j', session.id, intakeStatus, redactObject(intakeJson))
          writeAudit({ gym, user: null }, 'guest_pass.intake_failed', 'Guest', guestProfile?.id ?? null, { stripeSessionId: session.id, status: intakeStatus, error: intakeJson.error ?? null })
        } else {
          console.log('[platform/webhook] guest pass recorded pass=%s job=%s for', intakeJson.pass?.id, job?.id, email, '| passType:', passType)

          // Student ID photo — mirrors the Member resolution logic above:
          // look up the temp staging row by ID, copy its file data onto the
          // permanent record (here, this specific GuestVisit rather than the
          // globally-shared Guest), then delete the temp row.
          if (meta.studentIdUploadId && intakeJson.pass?.id) {
            try {
              const upload = await prisma.studentIdUpload.findUnique({
                where: { id: meta.studentIdUploadId },
              })
              if (upload) {
                await prisma.guestVisit.update({
                  where: { id: intakeJson.pass.id },
                  data:  { studentIdImage: upload.fileData },
                })
                await prisma.studentIdUpload.delete({ where: { id: upload.id } })
                console.log('[platform/webhook] guest student ID image retrieved and upload record deleted:', meta.studentIdUploadId)
              }
            } catch (err) {
              console.error('[platform/webhook] failed to retrieve guest student ID upload:', err.message)
            }
          }
        }
      } catch (e) {
        // Nothing was recorded — fail so Stripe redelivers (the session ID
        // makes the redelivery safe)
        console.error('[platform/webhook] guest pass write failed session=%s: %s', session.id, e.message)
        return NextResponse.json({ error: 'guest pass not recorded' }, { status: 500 })
      }

      await recordCouponRedemption(gym, session, 'guest_pass')

      // Seam + Zapier, after the response
      if (job) kickJob(job.id)
      return NextResponse.json({ received: true })
    }

    // ── Concessions purchase — decrement inventory stock ────────────────────
    if (meta.source === 'concessions') {
      try {
        const expandOptions = gym.stripeSecretKey
          ? {}
          : { stripeAccount: connectedAccountId }
        const lineItems = await accountStripe.checkout.sessions.listLineItems(session.id, {
          expand: ['data.price.product'],
          ...expandOptions,
        })

        for (const li of lineItems.data ?? []) {
          const productId    = typeof li.price?.product === 'string' ? li.price.product : li.price?.product?.id
          const purchasedQty = li.quantity ?? 0
          if (!productId || !purchasedQty) continue

          const item = await prisma.inventoryItem.findFirst({
            where: { gymId: gym.id, stripeProductId: productId },
          })
          if (!item) {
            console.warn('[platform/webhook] concessions — no InventoryItem found for product:', productId, '| gym:', gymSlug)
            continue
          }

          const newQuantity = Math.max(0, item.quantity - purchasedQty)
          await prisma.$transaction([
            prisma.inventoryItem.update({
              where: { id: item.id },
              data:  { quantity: newQuantity },
            }),
            prisma.inventoryLog.create({
              data: {
                gymId:  gym.id,
                itemId: item.id,
                change: -purchasedQty,
                reason: 'concessions_sale',
              },
            }),
          ])
          console.log(`[inventory] decremented ${item.name} by ${purchasedQty} — new stock: ${newQuantity}`)
        }
      } catch (err) {
        console.error('[platform/webhook] concessions inventory decrement error:', err.message)
      }

      await recordCouponRedemption(gym, session, 'concessions')

      return NextResponse.json({ received: true })
    }

    // ── Member signup via join form ─────────────────────────────────────────
    // Repeat delivery of a session already recorded → no-op (no second
    // member update, code, Kisi grant or email)
    const recordedJob = await prisma.webhookJob.findUnique({
      where:  { kind_stripeSessionId: { kind: 'member_access', stripeSessionId: session.id } },
      select: { id: true },
    })
    if (recordedJob) {
      console.log('[platform/webhook] join already recorded for session', session.id, '— ignoring repeat delivery')
      return NextResponse.json({ received: true })
    }

    const firstName      = meta.firstName      ?? ''
    const lastName       = meta.lastName       ?? ''
    const email          = (session.customer_email ?? meta.email ?? '').toLowerCase()
    const phone          = formatPhone(meta.phone ?? null)
    const membershipType = (meta.membershipType ?? '').toLowerCase()
    const subId          = session.subscription ?? null

    const TRIUMPH_PT_PRODUCT_ID          = 'prod_UrUgF0FkeB0IJx'
    const TRIUMPH_PROGRAMMING_PRODUCT_ID = 'prod_UrtfMuPRgjfdsd'
    const HYDRA_COACHING_PRODUCT_IDS     = new Set(['prod_UibCDN1vBqO2DX', 'prod_UoBtsZTZOcp8it'])

    let priceId = meta.priceId ?? null
    let resolvedMembershipType = membershipType
    try {
      const expandOptions = gym.stripeSecretKey
        ? {}
        : { stripeAccount: connectedAccountId }
      const expanded = await accountStripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items.data.price.product'],
        ...expandOptions,
      })
      const lineItems   = expanded.line_items?.data ?? []
      const lineItemPrice = lineItems[0]?.price?.id
      if (lineItemPrice) {
        priceId = lineItemPrice
        console.log('[platform/webhook] priceId from line_items:', priceId)
      } else {
        console.warn('[platform/webhook] no line item price found, falling back to metadata priceId:', priceId)
      }

      const productIds = lineItems.map(li => {
        const prod = li.price?.product
        return typeof prod === 'string' ? prod : prod?.id
      }).filter(Boolean)

      // For Triumph Barbell, override membershipType based on product IDs in the order
      if (gymSlug === 'triumph-barbell') {
        const hasPT          = productIds.includes(TRIUMPH_PT_PRODUCT_ID)
        const hasProgramming = productIds.includes(TRIUMPH_PROGRAMMING_PRODUCT_ID)
        if (hasPT && hasProgramming)   resolvedMembershipType = 'personal training + programming'
        else if (hasPT)                resolvedMembershipType = 'personal training'
        else if (hasProgramming)       resolvedMembershipType = 'programming'
        if (hasPT || hasProgramming) {
          console.log('[platform/webhook] triumph-barbell membership type overridden to:', resolvedMembershipType)
        }
      }

      // For Hydra Athletic Co., append '+ pt' when a coaching/programming add-on is in the order
      if (gymSlug === 'hydra-athletic-co') {
        const hasCoaching = productIds.some(id => HYDRA_COACHING_PRODUCT_IDS.has(id))
        if (hasCoaching) {
          resolvedMembershipType = membershipType ? `${membershipType} + pt` : 'pt'
          console.log('[platform/webhook] hydra-athletic-co membership type with coaching:', resolvedMembershipType)
        }
      }
    } catch (err) {
      console.error('[platform/webhook] failed to retrieve session line items:', err.message)
    }

    const memberBeforeUpdate = await prisma.member.findFirst({
      where: { gymId: gym.id, email: email.toLowerCase() },
    })
    // Snapshot of the member before this checkout — Kisi's tier-change check
    // needs the membershipType/assignment as they were, not after.
    const isNew = !memberBeforeUpdate

    // Zapier phone comes from the member at send time; Stripe's phone is the
    // fallback when neither the form nor the existing member has one
    const stripePhone = (phone || memberBeforeUpdate?.phone)
      ? null
      : await stripeSessionPhone(accountStripe, session, gym.stripeSecretKey ? {} : { stripeAccount: connectedAccountId })

    // Build full address from individual metadata fields
    const addressParts = [
      meta.address1,
      meta.address2,
      meta.city && meta.state ? `${meta.city}, ${meta.state}` : (meta.city || meta.state),
      meta.zip,
    ].filter(Boolean)
    const fullAddress = addressParts.length ? addressParts.join(', ') : (meta.address || null)

    // Student ID image from the temp upload (deleted with the member write)
    let studentIdUpload = null
    if (meta.studentIdUploadId) {
      studentIdUpload = await prisma.studentIdUpload.findUnique({ where: { id: meta.studentIdUploadId } })
        .catch(err => { console.error('[platform/webhook] failed to retrieve student ID upload:', err.message); return null })
    }
    const studentIdImage = studentIdUpload?.fileData ?? null

    // Stripe metadata values are always strings — normalize casing and coerce
    // the year to Int to match the Member schema.
    const parsedGradSemester = normalizeGradSemester(meta.gradSemester)
    const parsedGradYear     = meta.gradYear ? parseInt(meta.gradYear, 10) : null

    const isMinor = meta.isMinor === 'true'
    const isKisi  = gym.accessProvider === 'KISI'

    // Rutgers Powerlifting Club — one-off $5 payment, club president lets
    // members in manually, so this membership type must never get a Seam
    // access code.
    const isRutgersPowerliftingOneOff = gymSlug === 'hydra-athletic-co'
      && (meta.membershipType ?? '').toLowerCase() === 'rutgers powerlifting'

    // Collision-checked against the gym's codes in the DB here; the job
    // checks the lock's own codes before programming it (Seam calls don't
    // belong in the request path).
    const newAccessCode = !isKisi && !isRutgersPowerliftingOneOff ? await generateUniquePin(gym.id) : null

    const zapierPayload = {
      firstName, lastName, email, membershipType,
      isMinor,
      guardianName:         isMinor ? (meta.guardianName         || null) : null,
      guardianEmail:        isMinor ? (meta.guardianEmail        || null) : null,
      guardianPhone:        isMinor ? (meta.guardianPhone        || null) : null,
      guardianRelationship: isMinor ? (meta.guardianRelationship || null) : null,
    }

    // Member + membership event + follow-up job in one transaction. Kisi /
    // Seam and the Zapier email run in the job after Stripe has its 200.
    let member
    let job = null
    try {
      member = await prisma.$transaction(async tx => {
        let m
        if (!memberBeforeUpdate) {
          m = await tx.member.create({
            data: {
              gymId:               gym.id,
              firstName,
              lastName,
              email:               email.toLowerCase(),
              phone:               phone || null,
              status:              'ACTIVE',
              membershipType:      resolvedMembershipType,
              stripeSubscriptionId: subId,
              priceId,
              dateAccessed:        new Date(),
              dateOfBirth:           meta.dob               || null,
              address:               fullAddress,
              emergencyContactName:         meta.emergencyName         || null,
              emergencyContactPhone:        meta.emergencyPhone        || null,
              emergencyContactRelationship: meta.emergencyRelationship || null,
              gradSemester:                 parsedGradSemester,
              gradYear:                     Number.isNaN(parsedGradYear) ? null : parsedGradYear,
              studentIdImage:               studentIdImage,
              hearAboutUs:                  meta.hearAboutUs           || null,
              isMinor:                      isMinor,
              guardianName:                 isMinor ? (meta.guardianName         || null) : null,
              guardianEmail:                isMinor ? (meta.guardianEmail        || null) : null,
              guardianPhone:                isMinor ? (meta.guardianPhone        || null) : null,
              guardianRelationship:         isMinor ? (meta.guardianRelationship || null) : null,
            },
          })
        } else {
          m = await tx.member.update({
            where: { id: memberBeforeUpdate.id },
            data: {
              status:              'ACTIVE',
              membershipType:      resolvedMembershipType || undefined,
              stripeSubscriptionId: subId ?? memberBeforeUpdate.stripeSubscriptionId,
              priceId:             priceId ?? memberBeforeUpdate.priceId,
              dateAccessed:        new Date(),
              // Only set when the form actually submitted a phone this time —
              // never overwrite an existing stored phone with null/blank.
              ...(phone ? { phone } : {}),
              ...(parsedGradSemester ? { gradSemester: parsedGradSemester } : {}),
              ...(parsedGradYear && !Number.isNaN(parsedGradYear) ? { gradYear: parsedGradYear } : {}),
              ...(studentIdImage          ? { studentIdImage }                               : {}),
              ...(meta.hearAboutUs        ? { hearAboutUs: meta.hearAboutUs }               : {}),
              ...(isMinor ? {
                isMinor:              true,
                guardianName:         meta.guardianName         || null,
                guardianEmail:        meta.guardianEmail        || null,
                guardianPhone:        meta.guardianPhone        || null,
                guardianRelationship: meta.guardianRelationship || null,
              } : {}),
            },
          })
        }

        await tx.membershipEvent.create({
          data: { memberId: m.id, gymId: gym.id, type: isNew ? 'joined' : 'reactivated' },
        })
        if (studentIdUpload) await tx.studentIdUpload.deleteMany({ where: { id: studentIdUpload.id } })

        if (!isKisi) {
          if (newAccessCode) m = await tx.member.update({ where: { id: m.id }, data: { accessCode: newAccessCode } })
          // Same member write the old /members loopback made (name, type,
          // phone, subscription, code); its Seam part is the job's now.
          // reactivate only when this checkout created a new (active) subscription.
          const { status, json } = await intakeMember(gymSlug, {
            firstName,
            lastName,
            email,
            phone:                 phone || null,
            dob:                   meta.dob                   || null,
            address:               meta.address               || null,
            emergencyName:         meta.emergencyName         || null,
            emergencyPhone:        meta.emergencyPhone        || null,
            emergencyRelationship: meta.emergencyRelationship || null,
            membershipType:        membershipType.toLowerCase(),
            subId,
            accessCode:            newAccessCode,
          }, { reactivate: Boolean(subId), via: 'stripe_checkout', db: tx, provision: false })
          if (status >= 400) throw new Error(`member intake failed: ${status} ${json.error ?? ''}`)
          m = await tx.member.findUnique({ where: { id: m.id } })
        }

        const name = `${firstName} ${lastName}`.trim()
        job = await tx.webhookJob.create({
          data: {
            kind:            'member_access',
            gymId:           gym.id,
            memberId:        m.id,
            stripeSessionId: session.id,
            // Steps that don't apply are done from the start
            kisiDone:        !isKisi,
            seamDone:        isKisi || !m.accessCode,
            payload: {
              accessCode: isKisi ? null : m.accessCode,
              seamName:   name,
              seamCodes:  {},
              stripePhone,
              kisi: isKisi ? {
                existingMember: memberBeforeUpdate ? {
                  kisiUserId:           memberBeforeUpdate.kisiUserId,
                  kisiRoleAssignmentId: memberBeforeUpdate.kisiRoleAssignmentId,
                  membershipType:       memberBeforeUpdate.membershipType,
                } : null,
                email, name, membershipType: m.membershipType,
              } : null,
              // Zapier member payload (accessCode and phone are added at send
              // time — a Seam PIN collision can change the code)
              zapier: zapierPayload,
            },
          },
        })
        return m
      })
    } catch (err) {
      if (err.code === 'P2002') {
        const raced = await prisma.webhookJob.findUnique({ where: { kind_stripeSessionId: { kind: 'member_access', stripeSessionId: session.id } }, select: { id: true } })
        if (raced) {
          console.log('[platform/webhook] join already recorded for session', session.id, '— skipping')
          return NextResponse.json({ received: true })
        }
      }
      // Nothing was recorded — fail so Stripe redelivers (the job's session
      // key makes the redelivery safe)
      console.error('[platform/webhook] join write failed session=%s: %s', session.id, err.message)
      return NextResponse.json({ error: 'member not recorded' }, { status: 500 })
    }

    console.log('[platform/webhook] %s member from checkout: %s job=%s', isNew ? 'created' : 'updated', member.id, job.id, '| hearAboutUs=%s', meta.hearAboutUs || '(none)', '| isMinor=%s', isMinor)
    if (memberBeforeUpdate && memberBeforeUpdate.status !== 'ACTIVE') {
      writeAudit({ gym, user: null }, 'member.reactivate', 'Member', member.id, {
        via: 'stripe_checkout', from: memberBeforeUpdate.status, subscription: Boolean(subId),
      })
    }
    if (isRutgersPowerliftingOneOff) {
      console.log('[platform/webhook] Rutgers Powerlifting one-off — no access code for member:', member.id)
    }

    // A lead at this gym with this email just became a member → converted
    await markLeadConverted(gym, email)

    await recordCouponRedemption(gym, session, 'join')

    // Kisi / Seam + Zapier, after the response
    kickJob(job.id)
    return NextResponse.json({ received: true })
  }

  // ── customer.subscription.updated ────────────────────────────────────────
  if (event.type === 'customer.subscription.updated') {
    const sub   = event.data.object
    const subId = sub.id

    const member = await prisma.member.findFirst({
      where:  { gymId: gym.id, stripeSubscriptionId: subId },
      select: { id: true, stripeCustomerId: true, priceId: true, status: true },
    })

    if (!member) {
      console.warn('[platform/webhook] subscription.updated — no member found for sub:', subId)
      return NextResponse.json({ received: true })
    }

    const update = {}

    // Sync customer ID if it changed or was missing
    const newCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
    if (newCustomerId && newCustomerId !== member.stripeCustomerId) {
      update.stripeCustomerId = newCustomerId
    }

    // Sync price ID from first line item if it changed
    const newPriceId = sub.items?.data?.[0]?.price?.id ?? null
    if (newPriceId && newPriceId !== member.priceId) {
      update.priceId = newPriceId
    }

    // Map Stripe status → member status
    // past_due is handled by the overdue-cancel cron — leave DB status unchanged
    if (sub.status === 'active') {
      // Cancellation scheduled via cancel_at_period_end OR cancel_at (30-day notice path).
      // In both cases the subscription stays "active" until it ends — keep member ACTIVE
      // in DB and mark cancelScheduled so the UI can show the indicator.
      if (sub.cancel_at_period_end || sub.cancel_at) {
        console.log('[platform/webhook] subscription.updated — cancellation scheduled (cancel_at_period_end=%s cancel_at=%s), marking cancelScheduled for member %s', sub.cancel_at_period_end, sub.cancel_at, member.id)
        update.cancelScheduled = true
      } else if (member.status === 'CANCELED') {
        console.log('[platform/webhook] subscription.updated — member %s already CANCELED in DB, skipping ACTIVE update', member.id)
      } else {
        update.status = 'ACTIVE'
        update.cancelScheduled = false
      }
    } else if (sub.status === 'canceled') {
      update.status = 'CANCELED'
      update.cancelScheduled = false
    }
    // past_due / unpaid / trialing / paused — no change here

    if (Object.keys(update).length > 0) {
      await prisma.member.update({ where: { id: member.id }, data: update })
      console.log('[platform/webhook] subscription.updated — member %s updated: %j', member.id, update)
    } else {
      console.log('[platform/webhook] subscription.updated — no changes for member %s', member.id)
    }

    return NextResponse.json({ received: true })
  }

  // ── customer.subscription.deleted ────────────────────────────────────────
  if (event.type === 'customer.subscription.deleted') {
    const sub    = event.data.object
    const subId  = sub.id

    const member = await prisma.member.findFirst({
      where:  { gymId: gym.id, stripeSubscriptionId: subId },
      select: { id: true, accessCode: true, status: true, kisiRoleAssignmentId: true },
    })

    if (!member) {
      console.warn('[platform/webhook] no member found for subscription:', subId)
      return NextResponse.json({ received: true })
    }

    console.log('[platform/webhook] subscription deleted for member:', member.id, '| accessCode:', maskPin(member.accessCode))

    if (gym.accessProvider === 'KISI') {
      await revokeKisiAccess(gym, member.kisiRoleAssignmentId)
      await prisma.member.update({ where: { id: member.id }, data: { kisiRoleAssignmentId: null } })
    } else {
      const cancelSeamApiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
      if (member.accessCode && cancelSeamApiKey) {
        await deleteSeamCodeByPin(cancelSeamApiKey, member.accessCode, gym.seamDeviceId, '[platform/webhook]')
      }
    }

    if (member.status !== 'CANCELED') {
      const now = new Date()
      await prisma.member.update({
        where: { id: member.id },
        data:  { status: 'CANCELED', cancelScheduled: false, cancelEffectiveDate: null, dateCanceled: now, updatedAt: now },
      })
      await prisma.membershipEvent.create({
        data: { memberId: member.id, gymId: gym.id, type: 'canceled' },
      })
      console.log('[platform/webhook] member status updated to CANCELED:', member.id)
    }
  }

  return NextResponse.json({ received: true })
}
