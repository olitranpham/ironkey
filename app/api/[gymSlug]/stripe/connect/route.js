import { NextResponse } from 'next/server'
import Stripe from 'stripe'
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

  console.log('[stripe/connect GET] STRIPE_CLIENT_ID:', clientId)

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
 * Only OWNER may disconnect, and only for their own gym.
 */
export async function DELETE(request, { params }) {
  try {
    const { gymSlug } = await params
    const gymId = request.headers.get('x-gym-id')
    const role  = (request.headers.get('x-gym-role') ?? '').toUpperCase()

    if (role !== 'OWNER') {
      return NextResponse.json({ error: 'Only the gym owner can disconnect Stripe' }, { status: 403 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: { slug: true, stripeAccountId: true },
    })

    // Defense in depth — the JWT's gymId must actually belong to the gym in
    // the URL, so an authenticated owner of one gym can't pass a different
    // gym's slug and disconnect that gym's Stripe account.
    if (!gym || gym.slug !== gymSlug) {
      return NextResponse.json({ error: 'Gym mismatch' }, { status: 403 })
    }

    // Revoke the OAuth grant on Stripe's side (fire-and-forget — DB update is authoritative)
    if (gym?.stripeAccountId && process.env.STRIPE_CLIENT_ID && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
        await stripe.oauth.deauthorize({
          client_id:      process.env.STRIPE_CLIENT_ID,
          stripe_user_id: gym.stripeAccountId,
        })
        console.log('[stripe/connect DELETE] deauthorized account:', gym.stripeAccountId)
      } catch (e) {
        console.warn('[stripe/connect DELETE] deauthorize failed (continuing):', e.message)
      }
    }

    await prisma.gym.update({
      where: { id: gymId },
      data:  { stripeAccountId: null, stripeSecretKey: null },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[stripe/connect DELETE]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
