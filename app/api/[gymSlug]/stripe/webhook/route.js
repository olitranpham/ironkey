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

      // Upsert GuestProfile
      let guestProfile = null
      if (email) {
        guestProfile = await prisma.guestProfile.upsert({
          where:  { gymId_email: { gymId: gym.id, email } },
          update: { name: guestName || undefined, phone: phone || undefined },
          create: { gymId: gym.id, name: guestName || email, email, phone },
        })
      }

      // Create GuestPass
      await prisma.guestPass.create({
        data: {
          gymId:          gym.id,
          guestProfileId: guestProfile?.id ?? null,
          guestName:      guestName || email,
          guestEmail:     email || null,
          guestPhone:     phone,
          passType,
          passesLeft,
          expiresAt:      new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      console.log('[webhook] created guest pass:', passType, 'passesLeft:', passesLeft, 'for', email)

      // ── Seam: time-bound 24hr access code for guest ────────────────────────
      if (gym.seamApiKey && guestProfile) {
        const newCode     = String(Math.floor(1000 + Math.random() * 9000))
        const accessCode  = guestProfile.accessCode ?? newCode
        const deviceId    = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
        const seamHeaders = {
          Authorization:  `Bearer ${gym.seamApiKey}`,
          'Content-Type': 'application/json',
        }
        const startsAt = new Date().toISOString()
        const endsAt   = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

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

          if (guestProfile.accessCode) {
            // Returning guest — find and update expiry on each device
            for (const dev of devices) {
              const listRes = await fetch(`${SEAM_API}/access_codes/list`, {
                method: 'POST', headers: seamHeaders,
                body:   JSON.stringify({ device_id: dev.device_id }),
              })
              if (!listRes.ok) continue
              const { access_codes = [] } = await listRes.json()
              const match = access_codes.find(
                c => String(c.code).trim() === String(accessCode).trim()
              )
              if (match) {
                await fetch(`${SEAM_API}/access_codes/update`, {
                  method: 'POST', headers: seamHeaders,
                  body:   JSON.stringify({
                    access_code_id: match.access_code_id,
                    type:           'time_bound',
                    starts_at:      startsAt,
                    ends_at:        endsAt,
                  }),
                }).catch(e => console.error('[webhook] Seam update error:', e.message))
              } else {
                // Code not on device — create it
                await fetch(`${SEAM_API}/access_codes/create`, {
                  method: 'POST', headers: seamHeaders,
                  body:   JSON.stringify({
                    device_id:  dev.device_id,
                    name:       guestName,
                    code:       accessCode,
                    type:       'time_bound',
                    starts_at:  startsAt,
                    ends_at:    endsAt,
                  }),
                }).catch(e => console.error('[webhook] Seam create error:', e.message))
              }
            }
          } else {
            // New guest — create code on all devices
            await Promise.all(devices.map(dev =>
              fetch(`${SEAM_API}/access_codes/create`, {
                method: 'POST', headers: seamHeaders,
                body:   JSON.stringify({
                  device_id:  dev.device_id,
                  name:       guestName,
                  code:       accessCode,
                  type:       'time_bound',
                  starts_at:  startsAt,
                  ends_at:    endsAt,
                }),
              }).catch(e => console.error('[webhook] Seam create error:', e.message))
            ))
          }

          await prisma.guestProfile.update({
            where: { id: guestProfile.id },
            data:  { accessCode },
          })
          console.log('[webhook] Seam guest code set:', accessCode, '| expires:', endsAt)
        } catch (seamErr) {
          console.error('[webhook] Seam guest error:', seamErr.message)
        }
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

    // ── Generate and program a Seam access code ──────────────────────────────
    if (gym.seamApiKey) {
      const accessCode   = String(Math.floor(1000 + Math.random() * 9000))
      const deviceId     = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID
      const seamHeaders  = {
        Authorization:  `Bearer ${gym.seamApiKey}`,
        'Content-Type': 'application/json',
      }

      try {
        let devices = deviceId ? [{ device_id: deviceId }] : []

        if (!deviceId) {
          const devRes = await fetch(`${SEAM_API}/devices/list`, {
            method:  'POST',
            headers: seamHeaders,
            body:    JSON.stringify({}),
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
                device_id: dev.device_id,
                name:      `${firstName} ${lastName}`,
                code:      accessCode,
              }),
            }).catch(e => console.error('[webhook] Seam create error:', e.message))
          )
        )

        await prisma.member.update({
          where: { id: member.id },
          data:  { accessCode },
        })
        console.log('[webhook] Seam access code created for member:', member.id, '| code:', accessCode)
      } catch (seamErr) {
        console.error('[webhook] Seam error:', seamErr.message)
      }
    }
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
