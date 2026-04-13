import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const STRIPE_OAUTH_URL = 'https://connect.stripe.com/oauth/authorize'

/**
 * GET /api/[gymSlug]/stripe/connect
 * Redirects the authenticated gym owner to Stripe's OAuth authorization page.
 */
export async function GET(request, { params }) {
  const { gymSlug } = await params
  const clientId  = process.env.STRIPE_CLIENT_ID
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL

  if (!clientId) {
    return NextResponse.json({ error: 'STRIPE_CLIENT_ID is not configured' }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/stripe/callback`

  const url = new URL(STRIPE_OAUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'read_write')
  url.searchParams.set('state', gymSlug)
  url.searchParams.set('redirect_uri', redirectUri)

  return NextResponse.redirect(url.toString())
}

/**
 * DELETE /api/[gymSlug]/stripe/connect
 * Disconnects the gym's Stripe connected account (clears stripeAccountId).
 * Only OWNER may disconnect.
 */
export async function DELETE(request) {
  try {
    const gymId = request.headers.get('x-gym-id')
    const role  = (request.headers.get('x-gym-role') ?? '').toUpperCase()

    if (role !== 'OWNER') {
      return NextResponse.json({ error: 'Only the gym owner can disconnect Stripe' }, { status: 403 })
    }

    await prisma.gym.update({
      where: { id: gymId },
      data:  { stripeAccountId: null },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[stripe/connect DELETE]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
