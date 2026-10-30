import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const VALID_ACCESS_PROVIDERS = ['SEAM', 'KISI']

/**
 * PATCH /api/admin/gyms/[gymId]
 * Body: { name?, slug?, seamApiKey?, seamDeviceId?, stripeAccountId?, accessProvider?, kisiApiKey?, kisiPlaceId?, kisiMemberGroupId?, kisiWeekendGroupId? }
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
    if (body.seamDeviceId?.trim())    data.seamDeviceId    = body.seamDeviceId.trim()
    if (body.stripeAccountId?.trim()) data.stripeAccountId = body.stripeAccountId.trim()
    if (body.accessProvider?.trim()) {
      const provider = body.accessProvider.trim().toUpperCase()
      if (!VALID_ACCESS_PROVIDERS.includes(provider)) {
        return NextResponse.json({ error: 'Invalid accessProvider' }, { status: 400 })
      }
      data.accessProvider = provider
    }
    if (body.kisiApiKey?.trim())         data.kisiApiKey         = body.kisiApiKey.trim()
    if (body.kisiPlaceId?.trim())        data.kisiPlaceId        = body.kisiPlaceId.trim()
    if (body.kisiMemberGroupId?.trim())  data.kisiMemberGroupId  = body.kisiMemberGroupId.trim()
    if (body.kisiWeekendGroupId?.trim()) data.kisiWeekendGroupId = body.kisiWeekendGroupId.trim()
    // Allow empty string to clear Zapier URLs
    if (body.zapierMemberWebhookUrl  !== undefined) data.zapierMemberWebhookUrl  = body.zapierMemberWebhookUrl.trim()  || null
    if (body.zapierGuestWebhookUrl   !== undefined) data.zapierGuestWebhookUrl   = body.zapierGuestWebhookUrl.trim()   || null
    if (body.zapierOverdueWebhookUrl !== undefined) data.zapierOverdueWebhookUrl = body.zapierOverdueWebhookUrl.trim() || null
    if (body.zapierMembershipRequestWebhookUrl !== undefined) data.zapierMembershipRequestWebhookUrl = body.zapierMembershipRequestWebhookUrl.trim() || null
    if (body.leadWebhookUrl !== undefined) data.leadWebhookUrl = String(body.leadWebhookUrl).trim() || null

    console.log('[admin/gyms PATCH] gymId=%s writing fields=%j', gymId, Object.keys(data))

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const gym = await prisma.gym.update({
      where:  { id: gymId },
      data,
      select: { id: true, name: true, slug: true, stripeAccountId: true, seamApiKey: true, seamDeviceId: true, accessProvider: true, kisiApiKey: true, kisiPlaceId: true, kisiMemberGroupId: true, kisiWeekendGroupId: true, zapierMemberWebhookUrl: true, zapierGuestWebhookUrl: true, zapierOverdueWebhookUrl: true, zapierMembershipRequestWebhookUrl: true, leadWebhookUrl: true },
    })
    console.log('[admin/gyms PATCH] DB result: name=%j slug=%j seamDeviceId=%j accessProvider=%j', gym.name, gym.slug, gym.seamDeviceId, gym.accessProvider)

    return NextResponse.json({
      gym: {
        id:                     gym.id,
        name:                   gym.name,
        slug:                   gym.slug,
        hasStripe:              Boolean(gym.stripeAccountId),
        hasSeam:                Boolean(gym.seamApiKey || gym.seamDeviceId),
        seamDeviceId:           gym.seamDeviceId ?? '',
        hasKisi:                Boolean(gym.kisiApiKey),
        accessProvider:         gym.accessProvider,
        kisiPlaceId:            gym.kisiPlaceId ?? '',
        kisiMemberGroupId:      gym.kisiMemberGroupId ?? '',
        kisiWeekendGroupId:     gym.kisiWeekendGroupId ?? '',
        zapierMemberWebhookUrl:  gym.zapierMemberWebhookUrl  ?? '',
        zapierGuestWebhookUrl:   gym.zapierGuestWebhookUrl   ?? '',
        zapierOverdueWebhookUrl: gym.zapierOverdueWebhookUrl ?? '',
        zapierMembershipRequestWebhookUrl: gym.zapierMembershipRequestWebhookUrl ?? '',
        leadWebhookUrl:     gym.leadWebhookUrl ?? '',
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
