import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * GET /api/stripe/callback
 * Public route — Stripe OAuth redirect target.
 *
 * Query params: ?code=...&state=gymSlug
 *
 * Exchanges the authorization code for a stripe_user_id (connected account ID),
 * saves it to the gym row, then redirects the user back to settings.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const code    = searchParams.get('code')
  const gymSlug = searchParams.get('state')
  const error   = searchParams.get('error')
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL

  // Stripe sends ?error=access_denied if the user cancels
  if (error) {
    console.warn('[stripe/callback] OAuth error:', error, searchParams.get('error_description'))
    return NextResponse.redirect(`${appUrl}/${gymSlug}/settings?stripe_error=${encodeURIComponent(error)}`)
  }

  if (!code || !gymSlug) {
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

    const stripeAccountId = tokenData.stripe_user_id

    // Save to the gym row
    const gym = await prisma.gym.findUnique({ where: { slug: gymSlug } })
    if (!gym) {
      console.error('[stripe/callback] gym not found for slug:', gymSlug)
      return NextResponse.redirect(`${appUrl}/login`)
    }

    await prisma.gym.update({
      where: { id: gym.id },
      data:  { stripeAccountId },
    })

    console.log('[stripe/callback] connected account %s saved for gym %s', stripeAccountId, gymSlug)
    return NextResponse.redirect(`${appUrl}/${gymSlug}/settings?stripe_connected=1`)
  } catch (err) {
    console.error('[stripe/callback]', err.message, err.stack)
    return NextResponse.redirect(
      `${appUrl}/${gymSlug}/settings?stripe_error=${encodeURIComponent('server_error')}`,
    )
  }
}
