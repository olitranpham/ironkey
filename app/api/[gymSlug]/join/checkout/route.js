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
    const contentType = request.headers.get('content-type') ?? ''
    const body = contentType.includes('multipart/form-data')
      ? Object.fromEntries(await request.formData())
      : await request.json()

    // Support both JSON and multipart/form-data (student ID upload)
    let fields = body
    if (!(body instanceof Object) || body === null) fields = {}

    const {
      firstName, lastName, email, phone, dob,
      emergencyName, emergencyPhone,
      priceId, membershipType,
    } = fields

    if (!firstName || !lastName || !email || !priceId) {
      return NextResponse.json({ error: 'firstName, lastName, email, and priceId are required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, name: true, stripeSecretKey: true },
    })
    if (!gym)              return NextResponse.json({ error: 'Gym not found' },        { status: 404 })
    if (!gym.stripeSecretKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 })

    const stripe = new Stripe(gym.stripeSecretKey, { apiVersion: '2024-06-20' })

    // Build base URL from request origin for redirect URLs
    const origin = request.headers.get('origin') ?? `https://${request.headers.get('host')}`

    const session = await stripe.checkout.sessions.create({
      mode:           'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/${gymSlug}/join/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/${gymSlug}/join`,
      metadata: {
        gymSlug,
        gymId:              gym.id,
        firstName:          firstName.trim(),
        lastName:           lastName.trim(),
        phone:              phone          ?? '',
        dob:                dob            ?? '',
        emergencyName:      emergencyName  ?? '',
        emergencyPhone:     emergencyPhone ?? '',
        membershipType:     membershipType ?? 'GENERAL',
        studentIdUploaded:  body.studentId ? 'yes' : '',
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[join/checkout POST]', error)
    return NextResponse.json({ error: error.message ?? 'Internal server error' }, { status: 500 })
  }
}
