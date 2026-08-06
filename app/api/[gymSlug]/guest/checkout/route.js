import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/guest/checkout
 * Public — creates a Stripe Checkout session (one-time payment) for a guest pass.
 *
 * Body: {
 *   priceId, passType, passesLeft,
 *   firstName, lastName, email, phone, dob, address,
 *   emergencyName, emergencyPhone, emergencyRelationship,
 *   isNewGuest,
 * }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const {
      priceId, passType, passesLeft,
      firstName, lastName, email, phone, dob,
      address, address1, address2, city, state, zip,
      emergencyName, emergencyPhone, emergencyRelationship,
      isNewGuest,
      isMinor, guardianName, guardianEmail, guardianPhone, guardianRelationship,
    } = body

    if (!priceId || !email?.trim()) {
      return NextResponse.json({ error: 'priceId and email are required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, stripeSecretKey: true },
    })
    if (!gym)                return NextResponse.json({ error: 'Gym not found' },        { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe    = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })
    const origin    = process.env.NEXT_PUBLIC_APP_URL
      ?? request.headers.get('origin')
      ?? `https://${request.headers.get('host')}`
    // Accept pre-built name (returning guest) or construct from first/last
    const guestName = body.name?.trim() || [firstName, lastName].filter(Boolean).join(' ').trim() || email.trim()

    console.log('[guest/checkout] creating session — priceId:', priceId, '| passType from body:', passType, '| passesLeft:', passesLeft, '| metadata.passType will be:', passType ?? 'SINGLE')

    const session = await stripe.checkout.sessions.create({
      mode:                  'payment',
      customer_email:        email.trim().toLowerCase(),
      line_items:            [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/${gymSlug}/guest/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/${gymSlug}/guest`,
      metadata: {
        source:                'guest_pass',
        gymId:                 gym.id,
        gymSlug,
        guestName,
        email:                 email.trim().toLowerCase(),
        phone:                 phone                 ?? '',
        dob:                   dob                   ?? '',
        address:               address               ?? '',
        address1:              address1              ?? '',
        address2:              address2              ?? '',
        city:                  city                  ?? '',
        state:                 state                 ?? '',
        zip:                   zip                   ?? '',
        emergencyName:         emergencyName         ?? '',
        emergencyPhone:        emergencyPhone        ?? '',
        emergencyRelationship: emergencyRelationship ?? '',
        passType:              passType              ?? 'SINGLE',
        passesLeft:            String(passesLeft     ?? 1),
        isNewGuest:            isNewGuest ? 'yes' : 'no',
        isMinor:               isMinor ? 'true' : '',
        guardianName:          guardianName          ?? '',
        guardianEmail:         guardianEmail         ?? '',
        guardianPhone:         guardianPhone         ?? '',
        guardianRelationship:  guardianRelationship  ?? '',
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[guest/checkout POST]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
