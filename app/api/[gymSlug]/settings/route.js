import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'
import { withGymContext } from '@/lib/auth/gymContext'
import { requirePermission, can } from '@/lib/permissions'
import { writeAudit } from '@/lib/audit'

/**
 * GET /api/[gymSlug]/settings
 * Returns gym settings (keys masked to boolean presence — never exposed in plaintext).
 * Any active user may call this (the page also hosts their password change);
 * without settings.manage the response is empty — the password section needs nothing from it.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await withGymContext(request, gymSlug)
    if (errorResponse) return errorResponse
    if (!can(ctx.user, 'settings.manage')) return NextResponse.json({ settings: {} })
    const gymId = ctx.gym.id

    const gym = await prisma.gym.findUnique({
      where:  { id: gymId },
      select: {
        name:            true,
        slug:            true,
        stripeAccountId: true,
        seamApiKey:      true,
        accessProvider:  true,
        kisiApiKey:      true,
        kisiPlaceId:     true,
        kisiMemberGroupId:  true,
        kisiWeekendGroupId: true,
      },
    })

    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    return NextResponse.json({
      settings: {
        name:             gym.name,
        slug:             gym.slug,
        hasStripeConnect: Boolean(gym.stripeAccountId),
        hasSeam:          Boolean(gym.seamApiKey),
        hasKisi:          Boolean(gym.kisiApiKey),
        accessProvider:     gym.accessProvider,
        kisiPlaceId:        gym.kisiPlaceId ?? '',
        kisiMemberGroupId:  gym.kisiMemberGroupId ?? '',
        kisiWeekendGroupId: gym.kisiWeekendGroupId ?? '',
      },
    })
  } catch (error) {
    console.error('[settings GET]', error.message, error.stack)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/[gymSlug]/settings
 * Updates gym settings. Requires settings.manage (OWNER by default).
 *
 * Body variants:
 *   { type: 'gym',      name }
 *   { type: 'stripe',   stripeSecretKey?, stripeWebhookSecret? }
 *   { type: 'seam',     seamApiKey?, seamDeviceId? }
 *   { type: 'kisi',     kisiApiKey?, kisiPlaceId?, kisiMemberGroupId?, kisiWeekendGroupId? }
 *   { type: 'password', currentPassword, newPassword }
 *
 * Key fields: non-empty string → update, empty/absent → keep existing.
 * There is no explicit-clear path through this API (use a dedicated disconnect action).
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'settings.manage')
    if (errorResponse) return errorResponse
    const gymId  = ctx.gym.id
    const userId = ctx.user.id
    const role   = (ctx.user.role ?? '').toUpperCase()

    console.log('[settings PATCH] gymId=%s userId=%s role=%s', gymId, userId, role)

    const body = await request.json()
    const { type } = body

    // Field names only — body carries API keys and passwords.
    console.log('[settings PATCH] type=%s fields=%j', type, Object.keys(body).filter(k => k !== 'type'))

    // ── Gym info ────────────────────────────────────────────────────────────
    if (type === 'gym') {
      const { name } = body
      if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

      const gym = await prisma.gym.update({
        where:  { id: gymId },
        data:   { name: name.trim() },
        select: { name: true, slug: true },
      })
      writeAudit(ctx, 'settings.update', 'Gym', gymId, { type, fields: ['name'] })
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
      writeAudit(ctx, 'settings.update', 'Gym', gymId, { type, fields: Object.keys(data) })

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
      writeAudit(ctx, 'settings.update', 'Gym', gymId, { type, fields: Object.keys(data) })

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

    // ── Kisi integration ──────────────────────────────────────────────────────
    if (type === 'kisi') {
      const data = {}

      const apiKey          = body.kisiApiKey?.trim()
      const placeId         = body.kisiPlaceId?.trim()
      const memberGroupId   = body.kisiMemberGroupId?.trim()
      const weekendGroupId  = body.kisiWeekendGroupId?.trim()

      if (apiKey)         data.kisiApiKey         = apiKey
      if (placeId)        data.kisiPlaceId        = placeId
      if (memberGroupId)  data.kisiMemberGroupId  = memberGroupId
      if (weekendGroupId) data.kisiWeekendGroupId = weekendGroupId

      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'Enter a value to save' }, { status: 400 })
      }

      console.log('[settings PATCH] updating kisi fields: %j', Object.keys(data))

      await prisma.gym.update({ where: { id: gymId }, data })
      writeAudit(ctx, 'settings.update', 'Gym', gymId, { type, fields: Object.keys(data) })

      const updated = await prisma.gym.findUnique({
        where:  { id: gymId },
        select: { kisiApiKey: true, kisiPlaceId: true, kisiMemberGroupId: true, kisiWeekendGroupId: true },
      })
      return NextResponse.json({
        settings: {
          hasKisi:            Boolean(updated.kisiApiKey),
          kisiPlaceId:        updated.kisiPlaceId ?? '',
          kisiMemberGroupId:  updated.kisiMemberGroupId ?? '',
          kisiWeekendGroupId: updated.kisiWeekendGroupId ?? '',
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
      writeAudit(ctx, 'settings.update', 'GymUser', userId, { type, fields: ['password'] })

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Invalid settings type' }, { status: 400 })
  } catch (error) {
    console.error('[settings PATCH] error:', error.message)
    console.error('[settings PATCH] stack:', error.stack)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
