import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { findGymLeadProfile } from '@/lib/leads'
import { createLeadInviteToken, leadJoinLink } from '@/lib/leadInvite'
import { postWebhook } from '@/lib/guestCodeDelivery'
import { writeAudit } from '@/lib/audit'

/**
 * POST /api/[gymSlug]/leads/[guestProfileId]/invite
 * "send membership link": builds a signed 30-day link to this gym's join page
 * (prefilled from the lead's profile; they pick a plan and complete the full
 * join form, agreement and waiver there). No checkout session or subscription
 * is created here, and no coupon or guest-pass credit is attached.
 *
 *  - Gym has a lead webhook → POST { name, email, phone, joinLink, gymName } to
 *    it (Zapier emails the link); 2xx required, else 502 and nothing changes.
 *  - No lead webhook → return the link for the staff UI to copy.
 * Either way, on success the lead is marked contacted. Requires leads.manage.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug, guestProfileId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'leads.manage')
    if (errorResponse) return errorResponse

    const profile = await findGymLeadProfile(ctx.gym.id, guestProfileId)
    if (!profile) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!profile.email) return NextResponse.json({ error: 'this lead has no email address' }, { status: 400 })

    const origin   = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
    const joinLink = leadJoinLink(origin, gymSlug, createLeadInviteToken({ gymId: ctx.gym.id, guestProfileId }))

    let delivered = 'clipboard'
    if (ctx.gym.leadWebhookUrl) {
      const { ok, status } = await postWebhook(ctx.gym.leadWebhookUrl, gymSlug, {
        name:     profile.name,
        email:    profile.email,
        phone:    profile.phone ?? null,   // informational only — email is the only channel
        joinLink,
        gymName:  ctx.gym.name,
      }, 'lead')
      if (!ok) {
        writeAudit(ctx, 'lead.invite_failed', 'Guest', guestProfileId, { status })
        return NextResponse.json({ error: "couldn't send the invite — check the gym's lead webhook" }, { status: 502 })
      }
      delivered = 'webhook'
    }

    const now       = new Date()
    const converted = await isConverted(ctx.gym.id, guestProfileId)
    const lead = await prisma.lead.upsert({
      where:  { gymId_guestProfileId: { gymId: ctx.gym.id, guestProfileId } },
      create: { gymId: ctx.gym.id, guestProfileId, status: 'contacted', contactedAt: now },
      // Never downgrade a converted lead back to contacted
      update: { contactedAt: now, ...(converted ? {} : { status: 'contacted' }) },
    })
    writeAudit(ctx, 'lead.invite', 'Lead', lead.id, { delivered })

    return NextResponse.json({
      ok:        true,
      delivered,
      // Only returned when the UI has to copy it (no webhook configured)
      ...(delivered === 'clipboard' ? { joinLink } : {}),
      lead:      { status: lead.status, contactedAt: lead.contactedAt, convertedAt: lead.convertedAt },
    })
  } catch (error) {
    console.error('[leads invite]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function isConverted(gymId, guestProfileId) {
  const row = await prisma.lead.findUnique({
    where:  { gymId_guestProfileId: { gymId, guestProfileId } },
    select: { status: true },
  })
  return row?.status === 'converted'
}
