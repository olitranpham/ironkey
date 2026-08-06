import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/join/checkout
 * Public — creates a Stripe Checkout session and returns the URL.
 *
 * Body: {
 *   firstName, lastName, email, phone, dob,
 *   emergencyName, emergencyPhone,
 *   priceId, membershipType,
 * }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const {
      firstName, lastName, email, phone, dob,
      address, address1, address2, city, state, zip,
      emergencyName, emergencyPhone, emergencyRelationship,
      priceId, membershipType, addonPriceId, groupTrainingPriceId,
      studentIdUploadId, gradSemester, gradYear, hearAboutUs,
      isMinor, guardianName, guardianEmail, guardianPhone, guardianRelationship,
    } = body

    if (!firstName || !lastName || !email || (!priceId && !groupTrainingPriceId)) {
      return NextResponse.json({ error: 'firstName, lastName, email, and a selected plan are required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, stripeSecretKey: true },
    })
    if (!gym)              return NextResponse.json({ error: 'Gym not found' },        { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    // Build base URL for redirect URLs — prefer explicit env var so mobile Safari
    // (which sometimes omits the Origin header on same-origin fetches) always gets
    // a valid success/cancel URL.
    const origin = process.env.NEXT_PUBLIC_APP_URL
      ?? request.headers.get('origin')
      ?? `https://${request.headers.get('host')}`

    // "Gym membership included" is informational copy, not a billing
    // instruction — group training's price already covers membership, so it
    // must be the ONLY line item. Stacking it alongside a base membership
    // price (which likely bills on a different interval/cadence) causes
    // Stripe to reject the session outright.
    const lineItems = groupTrainingPriceId
      ? [{ price: groupTrainingPriceId, quantity: 1 }]
      : [{ price: priceId, quantity: 1 }]
    if (addonPriceId) lineItems.push({ price: addonPriceId, quantity: 1 })

    const session = await stripe.checkout.sessions.create({
      mode:                  'subscription',
      customer_email:        email,
      line_items:            lineItems,
      allow_promotion_codes: true,
      success_url: `${origin}/${gymSlug}/join/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/${gymSlug}/join`,
      metadata: {
        gymSlug,
        gymId:                 gym.id,
        firstName:             firstName.trim(),
        lastName:              lastName.trim(),
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
        membershipType:        membershipType        ?? '',
        addonPriceId:          addonPriceId          ?? '',
        groupTrainingPriceId:  groupTrainingPriceId  ?? '',
        studentIdUploadId:     studentIdUploadId     ?? '',
        gradSemester:          gradSemester          ?? '',
        gradYear:              gradYear              ?? '',
        hearAboutUs:           hearAboutUs           ?? '',
        isMinor:               isMinor ? 'true' : '',
        guardianName:          guardianName          ?? '',
        guardianEmail:         guardianEmail         ?? '',
        guardianPhone:         guardianPhone         ?? '',
        guardianRelationship:  guardianRelationship  ?? '',
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[join/checkout POST]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
