import { NextResponse } from 'next/server'
import { authorizeIntake } from '@/lib/webhookAuth'
import { intakeMember } from '@/lib/memberIntake'

/**
 * POST /api/[gymSlug]/members
 * Creates or updates a member record, then programs their access code on Seam if configured.
 * Called by Zapier on signup and by the door-access manual-add form.
 * Body: { firstName?, lastName?, name?, email, phone?, membershipType?, accessCode?, joinDate? }
 *
 * Auth: a staff JWT with door.manage, OR x-webhook-secret = WEBHOOK_SECRET (Zapier).
 * Unauthenticated calls are rejected when WEBHOOK_ENFORCE=true, otherwise allowed with a warning.
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const auth = await authorizeIntake(request, gymSlug, 'door.manage', 'POST /api/[gymSlug]/members')
    if (auth.errorResponse) return auth.errorResponse

    const body = await request.json()
    const { status, json } = await intakeMember(gymSlug, body)
    return NextResponse.json(json, { status })
  } catch (error) {
    console.error('[members POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
