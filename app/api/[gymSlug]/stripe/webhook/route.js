import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

/**
 * POST /api/[gymSlug]/stripe/webhook
 * Public route — registered in the gym's Stripe dashboard.
 *
 * Handles:
 *   customer.subscription.deleted  → delete Seam access code when subscription actually ends
 */
export async function POST(request, { params }) {
  const { gymSlug } = await params
  const rawBody     = await request.text()
  const sig         = request.headers.get('stripe-signature')

  // ── Load gym + webhook secret ─────────────────────────────────────────────
  const gym = await prisma.gym.findUnique({
    where:  { slug: gymSlug },
    select: {
      id:                 true,
      stripeSecretKey:    true,
      stripeWebhookSecret: true,
      seamApiKey:         true,
      seamDeviceId:       true,
    },
  })

  if (!gym) {
    console.error('[webhook] gym not found for slug:', gymSlug)
    return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
  }

  if (!gym.stripeSecretKey || !gym.stripeWebhookSecret) {
    console.warn('[webhook] Stripe not configured for gym:', gymSlug)
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  let event
  try {
    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    event = stripe.webhooks.constructEvent(rawBody, sig, gym.stripeWebhookSecret)
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log('[webhook]', gymSlug, '| event:', event.type)

  // ── Handle events ─────────────────────────────────────────────────────────

  // ── checkout.session.completed ────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const meta    = session.metadata ?? {}

    // Only process sessions that belong to this gym
    if (!meta.gymId || meta.gymId !== gym.id) {
      return NextResponse.json({ received: true })
    }

    // ── Guest pass purchase ─────────────────────────────────────────────────
    if (meta.source === 'guest_pass') {
      const guestName  = meta.guestName ?? ''
      const email      = (session.customer_email ?? meta.email ?? '').toLowerCase()
      const phone      = meta.phone || null
      const passType   = meta.passType ?? 'SINGLE'
      const passesLeft = parseInt(meta.passesLeft, 10) || 1

      // Upsert GuestProfile (global — keyed by email only)
      let guestProfile = null
      if (email) {
        guestProfile = await prisma.guest.upsert({
          where:  { email },
          update: { name: guestName || undefined, phone: phone || undefined },
          create: { name: guestName || email, email, phone },
        })
      }

      // Create GuestWaiver for this gym if not already recorded
      if (guestProfile) {
        await prisma.guestWaiver.upsert({
          where:  { guestProfileId_gymId: { guestProfileId: guestProfile.id, gymId: gym.id } },
          update: {},
          create: { guestProfileId: guestProfile.id, gymId: gym.id },
        })
      }

      // New guests get a fresh 4-digit accessCode; returning guests reuse theirs
      let accessCode = guestProfile?.accessCode ?? null
      if (!accessCode) {
        accessCode = String(Math.floor(1000 + Math.random() * 9000))
        if (guestProfile) {
          await prisma.guest.update({
            where: { id: guestProfile.id },
            data:  { accessCode },
          })
        }
        console.log('[webhook] generated new accessCode', accessCode, 'for new guest', email)
      } else {
        console.log('[webhook] reusing existing accessCode', accessCode, 'for returning guest', email)
      }

      // Trigger Zapier via the guest-passes endpoint — this creates the GuestPass
      // record and hands off Seam code programming to Zapier automation.
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
            passType:   passType.toLowerCase(),  // 'THREE_PACK' → 'three_pack' matches PASS_TYPE_MAP
            passesLeft: passType === 'SINGLE' ? null : passesLeft,
            accessCode,
          }),
        })
        if (!zapRes.ok) {
          const txt = await zapRes.text()
          console.error('[webhook] guest-passes notify failed:', zapRes.status, txt)
        } else {
          console.log('[webhook] guest-passes notified for', email, '| passType:', passType, '| accessCode:', accessCode)
        }
      } catch (e) {
        console.error('[webhook] guest-passes notify error:', e.message)
      }

      return NextResponse.json({ received: true })
    }

    // ── Member signup via join form ─────────────────────────────────────────
    const firstName      = meta.firstName      ?? ''
    const lastName       = meta.lastName       ?? ''
    const email          = session.customer_email ?? meta.email ?? ''
    const phone          = meta.phone          ?? null
    const membershipType = meta.membershipType ?? 'GENERAL'
    const subId          = session.subscription ?? null
    const priceId        = meta.priceId        ?? null

    // Upsert member — avoid duplicate if webhook fires more than once
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
          membershipType:      membershipType,
          stripeSubscriptionId: subId,
          priceId,
          dateAccessed:        new Date(),
        },
      })
      console.log('[webhook] created member from checkout:', member.id, email)
    } else {
      // Member exists (e.g. re-subscribing) — update status and subscription
      member = await prisma.member.update({
        where: { id: member.id },
        data: {
          status:              'ACTIVE',
          stripeSubscriptionId: subId ?? member.stripeSubscriptionId,
          priceId:             priceId ?? member.priceId,
          dateAccessed:        new Date(),
        },
      })
      console.log('[webhook] updated existing member from checkout:', member.id, email)
    }

    // ── Always generate and save a 4-digit access code ───────────────────────
    const accessCode  = String(Math.floor(1000 + Math.random() * 9000))
    member = await prisma.member.update({
      where: { id: member.id },
      data:  { accessCode },
    })
    console.log('[webhook] access code generated for member:', member.id, '| code:', accessCode)

    // ── Program Seam lock if configured ──────────────────────────────────────
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
            }).catch(e => console.error('[webhook] Seam create error:', e.message))
          )
        )
        console.log('[webhook] Seam code programmed for member:', member.id)
      } catch (seamErr) {
        console.error('[webhook] Seam error:', seamErr.message)
      }
    }

    // ── Notify Zapier via members endpoint (fire-and-forget) ─────────────────
    const memberHost   = request.headers.get('host') ?? ''
    const memberScheme = memberHost.startsWith('localhost') ? 'http' : 'https'
    fetch(`${memberScheme}://${memberHost}/api/${gymSlug}/members`, {
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
    }).catch(e => console.error('[webhook] members notify error:', e.message))
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    const subId = sub.id

    // Find member by subscription ID
    const member = await prisma.member.findFirst({
      where: { gymId: gym.id, stripeSubscriptionId: subId },
      select: { id: true, accessCode: true, status: true },
    })

    if (!member) {
      console.warn('[webhook] no member found for subscription:', subId)
      return NextResponse.json({ received: true })
    }

    console.log('[webhook] subscription deleted for member:', member.id, '| accessCode:', member.accessCode)

    // ── Delete Seam access code ─────────────────────────────────────────────
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
          console.log('[webhook] Seam delete status:', delRes.status, '| code:', member.accessCode)
        } else {
          console.log('[webhook] Seam code not found on device (may already be removed):', member.accessCode)
        }
      } catch (seamErr) {
        console.error('[webhook] Seam error:', seamErr.message)
      }
    }

    // ── Ensure DB status is CANCELLED ───────────────────────────────────────
    if (member.status !== 'CANCELLED') {
      await prisma.member.update({
        where: { id: member.id },
        data:  { status: 'CANCELLED', dateCanceled: new Date(), updatedAt: new Date() },
      })
      console.log('[webhook] member status updated to CANCELLED:', member.id)
    }
  }

  return NextResponse.json({ received: true })
}
