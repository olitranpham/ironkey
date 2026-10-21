import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { createStripeState } from '@/lib/stripeOAuthState'

const STRIPE_OAUTH_URL = 'https://connect.stripe.com/oauth/authorize'

/**
 * GET /api/[gymSlug]/stripe/connect
 * Returns { url } — Stripe's OAuth authorization page for this gym. Only the
 * holder of settings.manage (OWNER by default) may start the flow. The `state` param is signed and binds the
 * callback to this gym + user (see lib/stripeOAuthState.js).
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'settings.manage')
    if (errorResponse) return errorResponse

    const clientId  = process.env.STRIPE_CLIENT_ID
    const appUrl    = process.env.NEXT_PUBLIC_APP_URL

    console.log('[stripe/connect GET] STRIPE_CLIENT_ID:', clientId)

    if (!clientId) {
      return NextResponse.json({ error: 'STRIPE_CLIENT_ID is not configured' }, { status: 500 })
    }
    if (!process.env.STRIPE_STATE_SECRET) {
      return NextResponse.json({ error: 'STRIPE_STATE_SECRET is not configured' }, { status: 500 })
    }

    const redirectUri = `${appUrl}/api/stripe/callback`

    const url = new URL(STRIPE_OAUTH_URL)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('scope', 'read_write')
    url.searchParams.set('state', createStripeState({ gymId: ctx.gym.id, userId: ctx.user.id }))
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('stripe_landing', 'login')
    url.searchParams.set('always_prompt', 'true')

    return NextResponse.json({ url: url.toString() })
  } catch (error) {
    console.error('[stripe/connect GET]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/[gymSlug]/stripe/connect
 * Disconnects the gym's Stripe connected account (clears stripeAccountId).
 * Requires settings.manage, and only for the caller's own gym.
 */
export async function DELETE(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'settings.manage')
    if (errorResponse) return errorResponse
    const gymId = ctx.gym.id

    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: { slug: true, stripeAccountId: true },
    })

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
