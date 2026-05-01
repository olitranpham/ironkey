import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'

/**
 * GET /api/[gymSlug]/settings
 * Returns gym settings (keys masked to boolean presence — never exposed in plaintext).
 */
export async function GET(request) {
  try {
    const gymId = request.headers.get('x-gym-id')

    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: {
        name:                   true,
        slug:                   true,
        stripeAccountId:        true,
        seamApiKey:             true,
        zapierGuestWebhookUrl:  true,
        zapierMemberWebhookUrl: true,
      },
    })

    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    return NextResponse.json({
      settings: {
        name:                  gym.name,
        slug:                  gym.slug,
        hasStripeConnect:      Boolean(gym.stripeAccountId),
        hasSeam:               Boolean(gym.seamApiKey),
        zapierGuestWebhookUrl: gym.zapierGuestWebhookUrl  ?? '',
        zapierMemberWebhookUrl: gym.zapierMemberWebhookUrl ?? '',
      },
    })
  } catch (error) {
    console.error('[settings GET]', error.message, error.stack)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/[gymSlug]/settings
 * Updates gym settings. Only OWNER role may call this.
 *
 * Body variants:
 *   { type: 'gym',      name }
 *   { type: 'stripe',   stripeSecretKey?, stripeWebhookSecret? }
 *   { type: 'seam',     seamApiKey?, seamDeviceId? }
 *   { type: 'password', currentPassword, newPassword }
 *
 * Key fields: non-empty string → update, empty/absent → keep existing.
 * There is no explicit-clear path through this API (use a dedicated disconnect action).
 */
export async function PATCH(request) {
  try {
    const gymId  = request.headers.get('x-gym-id')
    const userId = request.headers.get('x-gym-user-id')
    const role   = (request.headers.get('x-gym-role') ?? '').toUpperCase()

    console.log('[settings PATCH] gymId=%s userId=%s role=%s', gymId, userId, role)

    if (!gymId) {
      return NextResponse.json({ error: 'Missing gym context' }, { status: 400 })
    }

    if (role !== 'OWNER') {
      return NextResponse.json({ error: 'Only the gym owner can update settings' }, { status: 403 })
    }

    const body = await request.json()
    const { type } = body

    console.log('[settings PATCH] type=%s body=%j', type, body)

    // ── Gym info ────────────────────────────────────────────────────────────
    if (type === 'gym') {
      const { name } = body
      if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

      const gym = await prisma.gym.update({
        where:  { id: gymId },
        data:   { name: name.trim() },
        select: { name: true, slug: true },
      })
      return NextResponse.json({ settings: gym })
    }

    // ── Stripe integration ───────────────────────────────────────────────────
    if (type === 'stripe') {
      const data = {}

      // Only update a field if the user actually provided a non-empty value.
      // Empty string means "leave as-is" (the placeholder already shows current state).
      const secretKey = body.stripeSecretKey?.trim()
      const webhookSecret = body.stripeWebhookSecret?.trim()

      if (secretKey)      data.stripeSecretKey     = secretKey
      if (webhookSecret)  data.stripeWebhookSecret = webhookSecret

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'Enter a key value to save' }, { status: 400 })
      }

      console.log('[settings PATCH] updating stripe fields: %j', Object.keys(data))

      await prisma.gym.update({ where: { id: gymId }, data })

      const updated = await prisma.gym.findUnique({
        where:  { id: gymId },
        select: { stripeSecretKey: true, stripeWebhookSecret: true },
      })
      return NextResponse.json({
        settings: {
          hasStripe:        Boolean(updated.stripeSecretKey),
          hasStripeWebhook: Boolean(updated.stripeWebhookSecret),
        },
      })
    }

    // ── Seam integration ─────────────────────────────────────────────────────
    if (type === 'seam') {
      const data = {}

      const apiKey   = body.seamApiKey?.trim()
      const deviceId = body.seamDeviceId?.trim()

      if (apiKey)    data.seamApiKey   = apiKey
      if (deviceId)  data.seamDeviceId = deviceId

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'Enter a value to save' }, { status: 400 })
      }

      console.log('[settings PATCH] updating seam fields: %j', Object.keys(data))

      await prisma.gym.update({ where: { id: gymId }, data })

      const updated = await prisma.gym.findUnique({
        where:  { id: gymId },
        select: { seamApiKey: true, seamDeviceId: true },
      })
      return NextResponse.json({
        settings: {
          hasSeam:      Boolean(updated.seamApiKey),
          seamDeviceId: updated.seamDeviceId ?? '',
        },
      })
    }

    // ── Zapier webhook URLs ──────────────────────────────────────────────────
    if (type === 'zapier') {
      const data = {}
      const guestUrl  = body.zapierGuestWebhookUrl?.trim()
      const memberUrl = body.zapierMemberWebhookUrl?.trim()

      if (guestUrl  !== undefined) data.zapierGuestWebhookUrl  = guestUrl  || null
      if (memberUrl !== undefined) data.zapierMemberWebhookUrl = memberUrl || null

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'No values provided' }, { status: 400 })
      }

      await prisma.gym.update({ where: { id: gymId }, data })

      const updated = await prisma.gym.findUnique({
        where:  { id: gymId },
        select: { zapierGuestWebhookUrl: true, zapierMemberWebhookUrl: true },
      })
      return NextResponse.json({
        settings: {
          zapierGuestWebhookUrl:  updated.zapierGuestWebhookUrl  ?? '',
          zapierMemberWebhookUrl: updated.zapierMemberWebhookUrl ?? '',
        },
      })
    }

    // ── Password change ──────────────────────────────────────────────────────
    if (type === 'password') {
      const { currentPassword, newPassword } = body
      if (!currentPassword || !newPassword) {
        return NextResponse.json({ error: 'Both current and new password are required' }, { status: 400 })
      }
      if (newPassword.length < 8) {
        return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
      }

      const user = await prisma.gymUser.findUnique({ where: { id: userId } })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const valid = await bcrypt.compare(currentPassword, user.password)
      if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

      const hashed = await bcrypt.hash(newPassword, 12)
      await prisma.gymUser.update({ where: { id: userId }, data: { password: hashed } })

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Invalid settings type' }, { status: 400 })
  } catch (error) {
    console.error('[settings PATCH] error:', error.message)
    console.error('[settings PATCH] stack:', error.stack)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
