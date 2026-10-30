import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/permissions'
import { LEAD_STATUSES, findGymLeadProfile } from '@/lib/leads'
import { writeAudit } from '@/lib/audit'

/**
 * PATCH /api/[gymSlug]/leads/[guestProfileId]
 * Body: { status?: 'new' | 'contacted' | 'converted', notes?: string }
 * Requires leads.manage. The guest must have a pass at this gym.
 */
export async function PATCH(request, { params }) {
  try {
    const { gymSlug, guestProfileId } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'leads.manage')
    if (errorResponse) return errorResponse

    const body = await request.json().catch(() => ({}))
    if (body.status !== undefined && !LEAD_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'status must be new, contacted or converted' }, { status: 400 })
    }
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
      return NextResponse.json({ error: 'notes must be text up to 2000 characters' }, { status: 400 })
    }

    const profile = await findGymLeadProfile(ctx.gym.id, guestProfileId)
    if (!profile) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const now  = new Date()
    const data = {}
    if (body.status !== undefined) {
      data.status = body.status
      if (body.status === 'contacted') data.contactedAt = now
      if (body.status === 'converted') data.convertedAt = now
    }
    if (body.notes !== undefined) data.notes = body.notes.trim() || null

    const lead = await prisma.lead.upsert({
      where:  { gymId_guestProfileId: { gymId: ctx.gym.id, guestProfileId } },
      create: { gymId: ctx.gym.id, guestProfileId, ...data },
      update: data,
    })
    writeAudit(ctx, 'lead.update', 'Lead', lead.id, { fields: Object.keys(data) })

    return NextResponse.json({ lead: { status: lead.status, contactedAt: lead.contactedAt, convertedAt: lead.convertedAt, notes: lead.notes } })
  } catch (error) {
    console.error('[leads PATCH]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
