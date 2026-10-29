import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin, generateUniqueAccessCode } from '@/lib/seam'
import { ensureKisiMembership, revokeAccess as revokeKisiAccess } from '@/lib/kisi'
import { formatPhone } from '@/lib/phone'
import { normalizeGradSemester } from '@/lib/gradSemester'
import { maskPin, redactObject } from '@/lib/redact'
import { intakeMember } from '@/lib/memberIntake'
import { intakeGuestPass } from '@/lib/guestPassIntake'
import { writeAudit } from '@/lib/audit'
import { generateUniquePin } from '@/lib/pins'
import { postWebhook } from '@/lib/guestCodeDelivery'
import { OASIS_GYM_SLUG, OASIS_GUEST_PASS_PRODUCTS, isOasisGuestPassProduct } from '@/lib/oasisGuestPasses'

/** Trimmed string, or null for null/undefined/blank. */
function normalizePhone(value) {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

/**
 * Deliver a purchase payload (with the door code) to a Zapier webhook and wait
 * up to 5 s. Never fails the Stripe webhook: a non-2xx / timeout / missing URL
 * is logged (gym slug + status) and audited as code.delivery_failed.
 */
async function deliverOrAudit(gym, url, payload, kind, targetType, targetId) {
  const { ok, status } = await postWebhook(url, gym.slug, payload, kind)
  if (!ok) writeAudit({ gym, user: null }, 'code.delivery_failed', targetType, targetId, { kind, status })
  return ok
}

const SEAM_API = 'https://connect.getseam.com'

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
      const guestName  = meta.guestName ?? ''
      const email      = (session.customer_email ?? meta.email ?? '').toLowerCase()
      // Ironkey checkout form phone (session metadata): formatted, trimmed, blank → null.
      // Same value is saved to the profile and sent in the Oasis payload.
      const phone      = normalizePhone(formatPhone(meta.phone || null))
      const passesLeft = parseInt(meta.passesLeft, 10) || 1

      // Expand line items to log the price/product IDs for debugging
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

      // ── Program time-bound Seam access code for guest (24-hour window) ────────
      let alreadyActive = false
      const guestSeamApiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
      if (guestSeamApiKey) {
        const deviceId    = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
        const seamHeaders = {
          Authorization:  `Bearer ${guestSeamApiKey}`,
          'Content-Type': 'application/json',
        }
        const nowMs       = Date.now()
        const startDt     = new Date(nowMs).toISOString()
        const endDt       = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString()
        try {
          let devices = deviceId ? [{ device_id: deviceId }] : []
          if (!deviceId) {
            const devRes = await fetch(`${SEAM_API}/devices/list`, {
              method: 'POST', headers: seamHeaders, body: JSON.stringify({}),
            })
            if (devRes.ok) {
              const { devices: devList = [] } = await devRes.json()
              devices = devList
            }
          }
          // duplicate_access_code means the PIN is already taken on a lock —
          // a failure, never success. Undo this attempt's codes on the other
          // devices and retry with a fresh collision-checked PIN.
          const createOnDevice = (dev, code) =>
            fetch(`${SEAM_API}/access_codes/create`, {
              method:  'POST',
              headers: seamHeaders,
              body:    JSON.stringify({
                device_id: dev.device_id,
                name:      guestName || email,
                code,
                starts_at: startDt,
                ends_at:   endDt,
              }),
            })
              .then(r => r.json())
              .then(r => {
                const errType = r.error?.type ?? null
                console.log('[platform/webhook] Seam guest code — device=%s code=%s passType=%s result=%s', dev.device_id, maskPin(code), passType, r.access_code?.access_code_id ?? errType ?? 'unknown')
                return { duplicate: errType === 'duplicate_access_code', codeId: r.access_code?.access_code_id ?? null }
              })
              .catch(e => { console.error('[platform/webhook] Seam guest code error:', e.message); return { duplicate: false, codeId: null } })

          const tried = new Set()
          for (let attempt = 1; attempt <= 5; attempt++) {
            const results = await Promise.all(devices.map(dev => createOnDevice(dev, accessCode)))
            if (!results.some(r => r.duplicate)) break

            await Promise.all(results.filter(r => r.codeId).map(r =>
              fetch(`${SEAM_API}/access_codes/delete`, {
                method: 'POST', headers: seamHeaders, body: JSON.stringify({ access_code_id: r.codeId }),
              }).catch(() => {}),
            ))
            tried.add(accessCode)
            if (attempt === 5) {
              console.error('[platform/webhook] Seam guest code — still duplicate after %d PINs for guest=%s', attempt, email)
              break
            }
            const previous = accessCode
            accessCode = await generateUniquePin(gym.id, previous.length, { exclude: tried, guestId: guestProfile?.id ?? null })
            console.warn('[platform/webhook] duplicate_access_code for pin=%s — retrying with %s', maskPin(previous), maskPin(accessCode))
            if (guestProfile) {
              await prisma.guest.update({ where: { id: guestProfile.id }, data: { accessCode } })
            }
          }
        } catch (seamErr) {
          console.error('[platform/webhook] Seam guest error:', seamErr.message)
        }
      }

      // passesLeft from the saved DB record (guest-passes route subtracts 1 for the current use)
      let savedPassesLeft = passType === 'SINGLE' ? null : passesLeft
      try {
        // Direct call — previously an HTTP POST to /api/[gymSlug]/guest-passes
        const { status: zapStatus, json: zapJson } = await intakeGuestPass(gymSlug, {
          name:       guestName,
          email,
          phone,
          passType:   passType.toLowerCase(),
          passesLeft: passType === 'SINGLE' ? null : passesLeft,
          accessCode,
        })
        if (zapStatus >= 400) {
          console.error('[platform/webhook] guest-passes notify failed:', zapStatus, redactObject(zapJson))
        } else {
          savedPassesLeft = zapJson.pass?.passesLeft ?? savedPassesLeft
          console.log('[platform/webhook] guest-passes notified for', email, '| passType:', passType, '| savedPassesLeft:', savedPassesLeft)

          // Student ID photo — mirrors the Member resolution logic above:
          // look up the temp staging row by ID, copy its file data onto the
          // permanent record (here, this specific GuestVisit rather than the
          // globally-shared Guest), then delete the temp row.
          if (meta.studentIdUploadId && zapJson.pass?.id) {
            try {
              const upload = await prisma.studentIdUpload.findUnique({
                where: { id: meta.studentIdUploadId },
              })
              if (upload) {
                await prisma.guestVisit.update({
                  where: { id: zapJson.pass.id },
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
        console.error('[platform/webhook] guest-passes notify error:', e.message)
      }

      // Oasis payload phone: checkout form phone → phone already on the profile → null
      const oasisPayloadPhone = isOasisGuestPass
        ? (phone ?? normalizePhone(guestProfile?.phone) ?? null)
        : null
      if (isOasisGuestPass) {
        console.log('[platform/webhook] oasis guest pass phone source=%s',
          phone ? 'checkout_form' : normalizePhone(guestProfile?.phone) ? 'profile' : 'none')
      }
      const zapierGuestUrl = gym.zapierGuestWebhookUrl || process.env.ZAPIER_GUEST_WEBHOOK_URL
      console.log('[platform/webhook] firing Zapier guest webhook (configured=%s)', Boolean(zapierGuestUrl))
      await deliverOrAudit(gym, zapierGuestUrl, {
        name: guestName, email, accessCode, passType, passesLeft: savedPassesLeft, firstTime, alreadyActive,
        ...(isOasisGuestPass ? { phone: oasisPayloadPhone } : {}),
        isMinor:               guestIsMinor,
        guardianName:          guestIsMinor ? (meta.guardianName         || null) : null,
        guardianEmail:         guestIsMinor ? (meta.guardianEmail        || null) : null,
        guardianPhone:         guestIsMinor ? (meta.guardianPhone        || null) : null,
        guardianRelationship:  guestIsMinor ? (meta.guardianRelationship || null) : null,
      }, 'guest', 'Guest', guestProfile?.id ?? null)

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

      return NextResponse.json({ received: true })
    }

    // ── Member signup via join form ─────────────────────────────────────────
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

    let member = await prisma.member.findFirst({
      where: { gymId: gym.id, email: email.toLowerCase() },
    })

    const isNew = !member
    // Snapshot before member gets reassigned below (create/update) — Kisi's
    // tier-change check needs the membershipType/assignment as they were
    // BEFORE this checkout, not after.
    const memberBeforeUpdate = member

    // Build full address from individual metadata fields
    const addressParts = [
      meta.address1,
      meta.address2,
      meta.city && meta.state ? `${meta.city}, ${meta.state}` : (meta.city || meta.state),
      meta.zip,
    ].filter(Boolean)
    const fullAddress = addressParts.length ? addressParts.join(', ') : (meta.address || null)

    // Retrieve student ID image if an upload ID was provided
    let studentIdImage = null
    if (meta.studentIdUploadId) {
      try {
        const upload = await prisma.studentIdUpload.findUnique({
          where: { id: meta.studentIdUploadId },
        })
        if (upload) {
          studentIdImage = upload.fileData
          await prisma.studentIdUpload.delete({ where: { id: upload.id } })
          console.log('[platform/webhook] student ID image retrieved and upload record deleted:', meta.studentIdUploadId)
        }
      } catch (err) {
        console.error('[platform/webhook] failed to retrieve student ID upload:', err.message)
      }
    }

    // Stripe metadata values are always strings — normalize casing and coerce
    // the year to Int to match the Member schema.
    const parsedGradSemester = normalizeGradSemester(meta.gradSemester)
    const parsedGradYear     = meta.gradYear ? parseInt(meta.gradYear, 10) : null

    const isMinor = meta.isMinor === 'true'

    if (!member) {
      member = await prisma.member.create({
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
      console.log('[platform/webhook] created member from checkout:', member.id, email, '| hearAboutUs=%s', meta.hearAboutUs || '(none)', '| isMinor=%s', isMinor)
    } else {
      member = await prisma.member.update({
        where: { id: member.id },
        data: {
          status:              'ACTIVE',
          membershipType:      resolvedMembershipType || undefined,
          stripeSubscriptionId: subId ?? member.stripeSubscriptionId,
          priceId:             priceId ?? member.priceId,
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
      console.log('[platform/webhook] updated existing member from checkout:', member.id, email)
      if (memberBeforeUpdate.status !== 'ACTIVE') {
        writeAudit({ gym, user: null }, 'member.reactivate', 'Member', member.id, {
          via: 'stripe_checkout', from: memberBeforeUpdate.status, subscription: Boolean(subId),
        })
      }
    }

    await prisma.membershipEvent.create({
      data: { memberId: member.id, gymId: gym.id, type: isNew ? 'joined' : 'reactivated' },
    })

    // ── Kisi gyms (DNA Strength only) — grant access, skip all Seam logic
    // below entirely, including the /members loopback (which exists only to
    // re-trigger Seam programming and would otherwise redundantly re-run
    // this same Kisi grant a second time).
    if (gym.accessProvider === 'KISI') {
      try {
        const result = await ensureKisiMembership(gym, {
          existingMember: memberBeforeUpdate,
          email,
          name: `${firstName} ${lastName}`.trim(),
          membershipType: member.membershipType,
        })
        if (result) {
          member = await prisma.member.update({
            where: { id: member.id },
            data:  { kisiUserId: result.kisiUserId, kisiRoleAssignmentId: result.kisiRoleAssignmentId },
          })
        }
      } catch (err) {
        console.error('[platform/webhook] Kisi grant error:', err.message)
      }

      const zapierMemberUrlKisi = gym.zapierMemberWebhookUrl || process.env.ZAPIER_MEMBER_WEBHOOK_URL
      await deliverOrAudit(gym, zapierMemberUrlKisi, {
        firstName, lastName, email, accessCode: null, membershipType,
        isMinor,
        guardianName:         isMinor ? (meta.guardianName         || null) : null,
        guardianEmail:        isMinor ? (meta.guardianEmail        || null) : null,
        guardianPhone:        isMinor ? (meta.guardianPhone        || null) : null,
        guardianRelationship: isMinor ? (meta.guardianRelationship || null) : null,
      }, 'member', 'Member', member.id)

      return NextResponse.json({ received: true })
    }

    const memberSeamApiKey   = gym.seamApiKey ?? process.env.SEAM_API_KEY
    const memberSeamDeviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

    // Rutgers Powerlifting Club — one-off $5 payment, club president lets
    // members in manually, so this membership type must never get a Seam
    // access code.
    const isRutgersPowerliftingOneOff = gymSlug === 'hydra-athletic-co'
      && (meta.membershipType ?? '').toLowerCase() === 'rutgers powerlifting'

    let accessCode = null
    if (!isRutgersPowerliftingOneOff) {
      accessCode = await generateUniqueAccessCode({
        prisma, gymId: gym.id, apiKey: memberSeamApiKey, deviceId: memberSeamDeviceId,
        logPrefix: '[platform/webhook]',
      })
      member = await prisma.member.update({
        where: { id: member.id },
        data:  { accessCode },
      })
      console.log('[platform/webhook] access code generated for member:', member.id, '| code:', maskPin(accessCode))
    } else {
      console.log('[platform/webhook] Rutgers Powerlifting one-off — skipping access code generation for member:', member.id)
    }

    const zapierMemberUrl = gym.zapierMemberWebhookUrl || process.env.ZAPIER_MEMBER_WEBHOOK_URL
    console.log('[platform/webhook] firing Zapier member webhook (configured=%s)', Boolean(zapierMemberUrl))
    console.log('[platform/webhook] Zapier member payload: firstName=%s lastName=%s email=%s accessCode=%s membershipType=%s isMinor=%s', firstName, lastName, email, maskPin(accessCode), membershipType, isMinor)
    await deliverOrAudit(gym, zapierMemberUrl, {
      firstName, lastName, email, accessCode, membershipType,
      isMinor,
      guardianName:         isMinor ? (meta.guardianName         || null) : null,
      guardianEmail:        isMinor ? (meta.guardianEmail        || null) : null,
      guardianPhone:        isMinor ? (meta.guardianPhone        || null) : null,
      guardianRelationship: isMinor ? (meta.guardianRelationship || null) : null,
    }, 'member', 'Member', member.id)

    if (memberSeamApiKey && !isRutgersPowerliftingOneOff) {
      const deviceId    = memberSeamDeviceId
      const seamHeaders = {
        Authorization:  `Bearer ${memberSeamApiKey}`,
        'Content-Type': 'application/json',
      }
      try {
        let devices = deviceId ? [{ device_id: deviceId }] : []
        if (!deviceId) {
          const devRes = await fetch(`${SEAM_API}/devices/list`, {
            method: 'POST', headers: seamHeaders, body: JSON.stringify({}),
          })
          if (devRes.ok) {
            const { devices: devList = [] } = await devRes.json()
            devices = devList
          }
        }
        await Promise.all(
          devices.map(dev =>
            fetch(`${SEAM_API}/access_codes/create`, {
              method:  'POST',
              headers: seamHeaders,
              body:    JSON.stringify({ device_id: dev.device_id, name: `${firstName} ${lastName}`, code: accessCode }),
            }).catch(e => console.error('[platform/webhook] Seam create error:', e.message))
          )
        )
        console.log('[platform/webhook] Seam code programmed for member:', member.id)
      } catch (seamErr) {
        console.error('[platform/webhook] Seam error:', seamErr.message)
      }
    }

    // Direct call — previously a fire-and-forget HTTP POST to /api/[gymSlug]/members.
    // reactivate only when this checkout created a new (active) subscription.
    intakeMember(gymSlug, {
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
      accessCode,
    }, { reactivate: Boolean(subId), via: 'stripe_checkout' })
      .then(({ status, json }) => { if (status >= 400) console.error('[platform/webhook] members notify failed:', status, json.error) })
      .catch(e => console.error('[platform/webhook] members notify error:', e.message))
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
