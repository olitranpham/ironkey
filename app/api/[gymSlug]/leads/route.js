import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/permissions'
import { listLeads } from '@/lib/leads'

/**
 * GET /api/[gymSlug]/leads
 * Guests with a pass at this gym who aren't ACTIVE/FROZEN/OVERDUE members.
 * Requires leads.view.
 */
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params
    const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'leads.view')
    if (errorResponse) return errorResponse

    const leads = await listLeads(ctx.gym.id)
    return NextResponse.json({ leads, hasLeadWebhook: Boolean(ctx.gym.leadWebhookUrl) })
  } catch (error) {
    console.error('[leads GET]', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
