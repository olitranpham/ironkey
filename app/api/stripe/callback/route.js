import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyStripeState } from '@/lib/stripeOAuthState'

/**
 * GET /api/stripe/callback
 * Public route — Stripe OAuth redirect target.
 *
 * Query params: ?code=...&state=<signed state from /api/[gymSlug]/stripe/connect>
 *
 * Verifies the signed state (signature + expiry), exchanges the authorization
 * code for a stripe_user_id (connected account ID), saves it to the gym named
 * in the state, then redirects the user back to settings.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code    = searchParams.get('code')
  const error   = searchParams.get('error')
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL

  // ── Verify state before doing anything else ─────────────────────────────
  const state = verifyStripeState(searchParams.get('state'))
  if (!state) {
    console.warn('[stripe/callback] rejected: invalid or expired state')
    return NextResponse.redirect(`${appUrl}/login`)
  }

  const gym = await prisma.gym.findUnique({ where: { id: state.gymId }, select: { id: true, slug: true } })
  if (!gym) {
    console.error('[stripe/callback] gym not found for state gymId:', state.gymId)
    return NextResponse.redirect(`${appUrl}/login`)
  }
  const gymSlug = gym.slug

  // Stripe sends ?error=access_denied if the user cancels
  if (error) {
    console.warn('[stripe/callback] OAuth error:', error, searchParams.get('error_description'))
    return NextResponse.redirect(`${appUrl}/${gymSlug}/settings?stripe_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login`)
  }

  try {
    // Exchange authorization code for a connected account ID
    const tokenRes = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_secret: process.env.STRIPE_SECRET_KEY,
      }),
    })

    const tokenData = await tokenRes.json()

    if (!tokenRes.ok || tokenData.error) {
      console.error('[stripe/callback] token exchange failed:', tokenData)
      return NextResponse.redirect(
        `${appUrl}/${gymSlug}/settings?stripe_error=${encodeURIComponent(tokenData.error_description ?? 'token_exchange_failed')}`,
      )
    }

    console.log('[stripe/callback] tokenData:', JSON.stringify(tokenData, null, 2))

    const stripeAccountId = tokenData.stripe_user_id

    // Save to the gym bound in the signed state — never to a gym named by the URL
    await prisma.gym.update({
      where: { id: gym.id },
      data:  {
        stripeAccountId,
        stripeSecretKey: tokenData.access_token ?? null,
      },
    })

    console.log('[stripe/callback] connected account %s saved for gym %s (user %s)', stripeAccountId, gymSlug, state.userId)
    return NextResponse.redirect(`${appUrl}/${gymSlug}/settings?stripe_connected=1`)
  } catch (err) {
    console.error('[stripe/callback]', err.message, err.stack)
    return NextResponse.redirect(
      `${appUrl}/${gymSlug}/settings?stripe_error=${encodeURIComponent('server_error')}`,
    )
  }
}
