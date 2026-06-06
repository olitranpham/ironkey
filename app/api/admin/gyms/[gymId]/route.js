import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/admin/gyms/[gymId]
 * Body: { name?, slug?, seamApiKey?, seamDeviceId?, stripeAccountId? }
 * Updates gym settings. Only provided non-empty fields are updated.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymId } = await params
    const body = await request.json()

    const data = {}
    if (body.name?.trim())            data.name            = body.name.trim()
    if (body.slug?.trim())            data.slug            = body.slug.trim()
    if (body.seamApiKey?.trim())      data.seamApiKey      = body.seamApiKey.trim()
    console.log('[admin/gyms PATCH] incoming seamDeviceId: %j (will save: %s)', body.seamDeviceId, Boolean(body.seamDeviceId?.trim()))
    if (body.seamDeviceId?.trim())    data.seamDeviceId    = body.seamDeviceId.trim()
    if (body.stripeAccountId?.trim()) data.stripeAccountId = body.stripeAccountId.trim()
    // Allow empty string to clear Zapier URLs
    if (body.zapierMemberWebhookUrl  !== undefined) data.zapierMemberWebhookUrl  = body.zapierMemberWebhookUrl.trim()  || null
    if (body.zapierGuestWebhookUrl   !== undefined) data.zapierGuestWebhookUrl   = body.zapierGuestWebhookUrl.trim()   || null
    if (body.zapierOverdueWebhookUrl !== undefined) data.zapierOverdueWebhookUrl = body.zapierOverdueWebhookUrl.trim() || null

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    console.log('[admin/gyms PATCH] writing to DB for gymId %s: %j', gymId, data)
    const gym = await prisma.gym.update({
      where:  { id: gymId },
      data,
      select: { id: true, name: true, slug: true, stripeAccountId: true, seamApiKey: true, seamDeviceId: true, zapierMemberWebhookUrl: true, zapierGuestWebhookUrl: true, zapierOverdueWebhookUrl: true },
    })
    console.log('[admin/gyms PATCH] DB result seamDeviceId: %j', gym.seamDeviceId)

    return NextResponse.json({
      gym: {
        id:                     gym.id,
        name:                   gym.name,
        slug:                   gym.slug,
        hasStripe:              Boolean(gym.stripeAccountId),
        hasSeam:                Boolean(gym.seamApiKey || gym.seamDeviceId),
        zapierMemberWebhookUrl:  gym.zapierMemberWebhookUrl  ?? '',
        zapierGuestWebhookUrl:   gym.zapierGuestWebhookUrl   ?? '',
        zapierOverdueWebhookUrl: gym.zapierOverdueWebhookUrl ?? '',
      },
    })
  } catch (error) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'That slug is already taken' }, { status: 409 })
    }
    console.error('[admin/gyms PATCH]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/gyms/[gymId]
 * Deletes the gym and all associated data (cascades via schema).
 */
export async function DELETE(request, { params }) {
  try {
    const { gymId } = await params
    await prisma.gym.delete({ where: { id: gymId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[admin/gyms DELETE]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
