import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

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
      const phone      = meta.phone || null
      const passType   = meta.passType ?? 'SINGLE'
      const passesLeft = parseInt(meta.passesLeft, 10) || 1

      let guestProfile = null
      if (email) {
        guestProfile = await prisma.guest.upsert({
          where:  { email },
          update: { name: guestName || undefined, phone: phone || undefined },
          create: { name: guestName || email, email, phone },
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
      if (gym.seamApiKey) {
        const deviceId    = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
        const seamHeaders = {
          Authorization:  `Bearer ${gym.seamApiKey}`,
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
          await Promise.all(
            devices.map(dev =>
              fetch(`${SEAM_API}/access_codes/create`, {
                method:  'POST',
                headers: seamHeaders,
                body:    JSON.stringify({
                  device_id:      dev.device_id,
                  name:           guestName || email,
                  code:           accessCode,
                  starts_at:      startDt,
                  ends_at:        endDt,
                }),
              })
                .then(r => r.json())
                .then(r => console.log('[platform/webhook] Seam guest code programmed — device=%s code=%s ends_at=%s result=%s', dev.device_id, accessCode, endDt, r.access_code?.access_code_id ?? r.error?.type ?? 'unknown'))
                .catch(e  => console.error('[platform/webhook] Seam guest code error:', e.message))
            )
          )
        } catch (seamErr) {
          console.error('[platform/webhook] Seam guest error:', seamErr.message)
        }
      }

      const host    = request.headers.get('host') ?? ''
      const scheme  = host.startsWith('localhost') ? 'http' : 'https'
      const baseUrl = `${scheme}://${host}`
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
          console.log('[platform/webhook] guest-passes notified for', email, '| passType:', passType)
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
          body:    JSON.stringify({ name: guestName, email, accessCode, passType, passesLeft, firstTime }),
        })
          .then(r => console.log('[platform/webhook] Zapier guest webhook status:', r.status))
          .catch(e => console.error('[platform/webhook] Zapier guest webhook error:', e.message))
      }

      return NextResponse.json({ received: true })
    }

    // ── Member signup via join form ─────────────────────────────────────────
    const firstName      = meta.firstName      ?? ''
    const lastName       = meta.lastName       ?? ''
    const email          = (session.customer_email ?? meta.email ?? '').toLowerCase()
    const phone          = meta.phone          ?? null
    const membershipType = meta.membershipType ?? 'GENERAL'
    const subId          = session.subscription ?? null

    let priceId = meta.priceId ?? null
    try {
      const expandOptions = gym.stripeSecretKey
        ? {}
        : { stripeAccount: connectedAccountId }
      const expanded = await accountStripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items'],
        ...expandOptions,
      })
      const lineItemPrice = expanded.line_items?.data?.[0]?.price?.id
      if (lineItemPrice) {
        priceId = lineItemPrice
        console.log('[platform/webhook] priceId from line_items:', priceId)
      } else {
        console.warn('[platform/webhook] no line item price found, falling back to metadata priceId:', priceId)
      }
    } catch (err) {
      console.error('[platform/webhook] failed to retrieve session line items:', err.message)
    }

    let member = await prisma.member.findFirst({
      where: { gymId: gym.id, email: email.toLowerCase() },
    })

    if (!member) {
      member = await prisma.member.create({
        data: {
          gymId:               gym.id,
          firstName,
          lastName,
          email:               email.toLowerCase(),
          phone:               phone || null,
          status:              'ACTIVE',
          membershipType,
          stripeSubscriptionId: subId,
          priceId,
          dateAccessed:        new Date(),
        },
      })
      console.log('[platform/webhook] created member from checkout:', member.id, email)
    } else {
      member = await prisma.member.update({
        where: { id: member.id },
        data: {
          status:              'ACTIVE',
          stripeSubscriptionId: subId ?? member.stripeSubscriptionId,
          priceId:             priceId ?? member.priceId,
          dateAccessed:        new Date(),
        },
      })
      console.log('[platform/webhook] updated existing member from checkout:', member.id, email)
    }

    const accessCode = String(Math.floor(1000 + Math.random() * 9000))
    member = await prisma.member.update({
      where: { id: member.id },
      data:  { accessCode },
    })
    console.log('[platform/webhook] access code generated for member:', member.id, '| code:', accessCode)

    const zapierMemberUrl = gym.zapierMemberWebhookUrl || process.env.ZAPIER_MEMBER_WEBHOOK_URL
    console.log('[platform/webhook] firing Zapier member webhook:', zapierMemberUrl)
    console.log('[platform/webhook] Zapier member payload: firstName=%s lastName=%s email=%s accessCode=%s membershipType=%s', firstName, lastName, email, accessCode, membershipType)
    if (zapierMemberUrl) {
      fetch(zapierMemberUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ firstName, lastName, email, accessCode, membershipType }),
      })
        .then(r => console.log('[platform/webhook] Zapier member webhook status:', r.status))
        .catch(e => console.error('[platform/webhook] Zapier member webhook error:', e.message))
    }

    if (gym.seamApiKey) {
      const deviceId    = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
      const seamHeaders = {
        Authorization:  `Bearer ${gym.seamApiKey}`,
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
      update.status = 'ACTIVE'
    } else if (sub.status === 'canceled') {
      update.status = 'CANCELLED'
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

    if (member.accessCode && gym.seamApiKey && gym.seamDeviceId) {
      try {
        const seamHeaders = {
          Authorization:  `Bearer ${gym.seamApiKey}`,
          'Content-Type': 'application/json',
        }
        const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify({ device_id: gym.seamDeviceId }),
        })
        const { access_codes = [] } = await listRes.json()
        const match = access_codes.find(
          c => String(c.code).trim() === String(member.accessCode).trim()
        )
        if (match) {
          const delRes = await fetch(`${SEAM_API}/access_codes/delete`, {
            method:  'POST',
            headers: seamHeaders,
            body:    JSON.stringify({ access_code_id: match.access_code_id }),
          })
          console.log('[platform/webhook] Seam delete status:', delRes.status, '| code:', member.accessCode)
        } else {
          console.log('[platform/webhook] Seam code not found on device (may already be removed):', member.accessCode)
        }
      } catch (seamErr) {
        console.error('[platform/webhook] Seam error:', seamErr.message)
      }
    }

    if (member.status !== 'CANCELLED') {
      await prisma.member.update({
        where: { id: member.id },
        data:  { status: 'CANCELLED', dateCanceled: new Date(), updatedAt: new Date() },
      })
      console.log('[platform/webhook] member status updated to CANCELLED:', member.id)
    }
  }

  return NextResponse.json({ received: true })
}
