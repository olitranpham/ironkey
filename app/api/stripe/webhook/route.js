import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { deleteSeamCodeByPin, generateUniqueAccessCode } from '@/lib/seam'
import { formatPhone } from '@/lib/phone'
import { normalizeGradSemester } from '@/lib/gradSemester'

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
  const stripe         = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  const webhookSecret  = process.env.STRIPE_WEBHOOK_SECRET
  let event
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    } else {
      event = JSON.parse(rawBody)
    }
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
      const phone      = formatPhone(meta.phone || null)
      const passesLeft = parseInt(meta.passesLeft, 10) || 1

      // Expand line items to log the price/product IDs for debugging
      let lineItemPriceId   = null
      let lineItemProductId = null
      try {
        const expandOptions = gym.stripeSecretKey
          ? {}
          : { stripeAccount: connectedAccountId }
        const expanded = await accountStripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items'],
          ...expandOptions,
        })
        const lineItem = expanded.line_items?.data?.[0]
        lineItemPriceId   = lineItem?.price?.id      ?? null
        lineItemProductId = lineItem?.price?.product ?? null
        console.log('[platform/webhook] guest pass line item — priceId:', lineItemPriceId, '| productId:', lineItemProductId)
      } catch (err) {
        console.error('[platform/webhook] failed to expand guest pass line items:', err.message)
      }

      // Fallback product → passType map (used when metadata passType is missing)
      const PRODUCT_TO_PASS_TYPE = {
        'prod_UdG5qNSMCuYDhN': 'SINGLE',  // Oasis single pass
        'prod_UdG5tLURJQAEog': 'VALUE',   // Oasis value pack
        'prod_UdG5qpIhMMjmyA': 'DELUXE',  // Oasis deluxe pack
      }

      const passType = meta.passType
        || (lineItemProductId && PRODUCT_TO_PASS_TYPE[lineItemProductId])
        || 'SINGLE'

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
        accessCode = String(Math.floor(1000 + Math.random() * 9000))
        if (guestProfile) {
          await prisma.guest.update({
            where: { id: guestProfile.id },
            data:  { accessCode },
          })
        }
        console.log('[platform/webhook] generated accessCode', accessCode, 'for new guest', email)
      } else {
        console.log('[platform/webhook] reusing accessCode', accessCode, 'for returning guest', email)
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
          const seamResults = await Promise.all(
            devices.map(dev =>
              fetch(`${SEAM_API}/access_codes/create`, {
                method:  'POST',
                headers: seamHeaders,
                body:    JSON.stringify({
                  device_id: dev.device_id,
                  name:      guestName || email,
                  code:      accessCode,
                  starts_at: startDt,
                  ends_at:   endDt,
                }),
              })
                .then(r => r.json())
                .then(r => {
                  const errType = r.error?.type ?? null
                  const isDuplicate = errType === 'duplicate_access_code'
                  console.log('[platform/webhook] Seam guest code — device=%s code=%s passType=%s result=%s', dev.device_id, accessCode, passType, isDuplicate ? 'already_active (duplicate)' : (r.access_code?.access_code_id ?? errType ?? 'unknown'))
                  return { deviceId: dev.device_id, alreadyActive: isDuplicate, success: isDuplicate || Boolean(r.access_code?.access_code_id) }
                })
                .catch(e => { console.error('[platform/webhook] Seam guest code error:', e.message); return { alreadyActive: false, success: false } })
            )
          )
          alreadyActive = seamResults.some(r => r.alreadyActive) && !seamResults.some(r => r.success && !r.alreadyActive)
        } catch (seamErr) {
          console.error('[platform/webhook] Seam guest error:', seamErr.message)
        }
      }

      const host    = request.headers.get('host') ?? ''
      const scheme  = host.startsWith('localhost') ? 'http' : 'https'
      const baseUrl = `${scheme}://${host}`

      // passesLeft from the saved DB record (guest-passes route subtracts 1 for the current use)
      let savedPassesLeft = passType === 'SINGLE' ? null : passesLeft
      try {
        const zapRes = await fetch(`${baseUrl}/api/${gymSlug}/guest-passes`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:       guestName,
            email,
            phone,
            passType:   passType.toLowerCase(),
            passesLeft: passType === 'SINGLE' ? null : passesLeft,
            accessCode,
          }),
        })
        if (!zapRes.ok) {
          console.error('[platform/webhook] guest-passes notify failed:', zapRes.status, await zapRes.text())
        } else {
          const zapJson = await zapRes.json()
          savedPassesLeft = zapJson.pass?.passesLeft ?? savedPassesLeft
          console.log('[platform/webhook] guest-passes notified for', email, '| passType:', passType, '| savedPassesLeft:', savedPassesLeft)
        }
      } catch (e) {
        console.error('[platform/webhook] guest-passes notify error:', e.message)
      }

      const zapierGuestUrl = gym.zapierGuestWebhookUrl || process.env.ZAPIER_GUEST_WEBHOOK_URL
      console.log('[platform/webhook] firing Zapier guest webhook:', zapierGuestUrl)
      if (zapierGuestUrl) {
        fetch(zapierGuestUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name: guestName, email, accessCode, passType, passesLeft: savedPassesLeft, firstTime, alreadyActive,
            isMinor:               guestIsMinor,
            guardianName:          guestIsMinor ? (meta.guardianName         || null) : null,
            guardianEmail:         guestIsMinor ? (meta.guardianEmail        || null) : null,
            guardianPhone:         guestIsMinor ? (meta.guardianPhone        || null) : null,
            guardianRelationship:  guestIsMinor ? (meta.guardianRelationship || null) : null,
          }),
        })
          .then(r => console.log('[platform/webhook] Zapier guest webhook status:', r.status))
          .catch(e => console.error('[platform/webhook] Zapier guest webhook error:', e.message))
      }

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
    }

    await prisma.membershipEvent.create({
      data: { memberId: member.id, gymId: gym.id, type: isNew ? 'joined' : 'reactivated' },
    })

    const memberSeamApiKey   = gym.seamApiKey ?? process.env.SEAM_API_KEY
    const memberSeamDeviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

    const accessCode = await generateUniqueAccessCode({
      prisma, gymId: gym.id, apiKey: memberSeamApiKey, deviceId: memberSeamDeviceId,
      logPrefix: '[platform/webhook]',
    })
    member = await prisma.member.update({
      where: { id: member.id },
      data:  { accessCode },
    })
    console.log('[platform/webhook] access code generated for member:', member.id, '| code:', accessCode)

    const zapierMemberUrl = gym.zapierMemberWebhookUrl || process.env.ZAPIER_MEMBER_WEBHOOK_URL
    console.log('[platform/webhook] firing Zapier member webhook:', zapierMemberUrl)
    console.log('[platform/webhook] Zapier member payload: firstName=%s lastName=%s email=%s accessCode=%s membershipType=%s isMinor=%s', firstName, lastName, email, accessCode, membershipType, isMinor)
    if (zapierMemberUrl) {
      fetch(zapierMemberUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          firstName, lastName, email, accessCode, membershipType,
          isMinor,
          guardianName:         isMinor ? (meta.guardianName         || null) : null,
          guardianEmail:        isMinor ? (meta.guardianEmail        || null) : null,
          guardianPhone:        isMinor ? (meta.guardianPhone        || null) : null,
          guardianRelationship: isMinor ? (meta.guardianRelationship || null) : null,
        }),
      })
        .then(r => console.log('[platform/webhook] Zapier member webhook status:', r.status))
        .catch(e => console.error('[platform/webhook] Zapier member webhook error:', e.message))
    }

    if (memberSeamApiKey) {
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

    const host   = request.headers.get('host') ?? ''
    const scheme = host.startsWith('localhost') ? 'http' : 'https'
    fetch(`${scheme}://${host}/api/${gymSlug}/members`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
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
      }),
    }).catch(e => console.error('[platform/webhook] members notify error:', e.message))
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
      select: { id: true, accessCode: true, status: true },
    })

    if (!member) {
      console.warn('[platform/webhook] no member found for subscription:', subId)
      return NextResponse.json({ received: true })
    }

    console.log('[platform/webhook] subscription deleted for member:', member.id, '| accessCode:', member.accessCode)

    const cancelSeamApiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
    if (member.accessCode && cancelSeamApiKey) {
      await deleteSeamCodeByPin(cancelSeamApiKey, member.accessCode, gym.seamDeviceId, '[platform/webhook]')
    }

    if (member.status !== 'CANCELED') {
      const now = new Date()
      await prisma.member.update({
        where: { id: member.id },
        data:  { status: 'CANCELED', cancelScheduled: false, dateCanceled: now, updatedAt: now },
      })
      await prisma.membershipEvent.create({
        data: { memberId: member.id, gymId: gym.id, type: 'canceled' },
      })
      console.log('[platform/webhook] member status updated to CANCELED:', member.id)
    }
  }

  return NextResponse.json({ received: true })
}
