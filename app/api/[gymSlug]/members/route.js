import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { formatPhone } from '@/lib/phone'

const SEAM_API = 'https://connect.getseam.com'

/**
 * POST /api/[gymSlug]/members
 * Creates or updates a member record, then programs their access code on Seam if configured.
 * Called by Zapier on signup and by the door-access manual-add form.
 * Body: { firstName?, lastName?, name?, email, phone?, membershipType?, accessCode?, joinDate? }
 * Email is required. No auth required (Zapier compatibility).
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const email = (body.email ?? '').toLowerCase().trim()
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    // Accept either name (single field) or firstName + lastName separately
    let firstName, lastName
    if (body.name) {
      const parts = body.name.trim().split(/\s+/)
      firstName = parts[0] ?? 'Unknown'
      lastName  = parts.slice(1).join(' ') || ''
    } else {
      firstName = (body.firstName ?? '').trim() || 'Unknown'
      lastName  = (body.lastName  ?? '').trim() || ''
    }

    const phone          = formatPhone(body.phone ?? null)
    const customerId     = body.customerId ?? null
    const subId          = body.subId      ?? null
    const accessCode     = body.accessCode ? String(body.accessCode).trim() : null
    const membershipType = (body.membershipType ?? '').toLowerCase().trim() || 'general'
    const dateAccessed   = body.joinDate ? new Date(body.joinDate) : null

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const member = await prisma.member.upsert({
      where:  { gymId_email: { gymId: gym.id, email } },
      create: {
        gymId: gym.id, firstName, lastName, email,
        phone, membershipType,
        stripeCustomerId:     customerId,
        stripeSubscriptionId: subId,
        ...(accessCode   ? { accessCode }   : {}),
        ...(dateAccessed ? { dateAccessed } : {}),
      },
      update: {
        firstName,
        lastName,
        membershipType,
        status: 'ACTIVE',
        ...(phone        ? { phone }                              : {}),
        ...(customerId   ? { stripeCustomerId:     customerId }   : {}),
        ...(subId        ? { stripeSubscriptionId: subId }        : {}),
        ...(accessCode   ? { accessCode }                         : {}),
        ...(dateAccessed ? { dateAccessed }                       : {}),
      },
    })

    // ── Program Seam access code ──────────────────────────────────────────────
    const apiKey   = gym.seamApiKey   ?? process.env.SEAM_API_KEY
    const deviceId = gym.seamDeviceId ?? process.env.SEAM_DEVICE_ID

    if (accessCode && apiKey && deviceId) {
      console.log('[members POST] programming Seam code=%s device=%s member=%s', accessCode, deviceId, member.id)
      try {
        const seamHeaders = {
          Authorization:  `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }
        const memberName = `${firstName} ${lastName}`.trim()

        // Check if a code with this PIN already exists on the device
        const listRes  = await fetch(`${SEAM_API}/access_codes/list`, {
          method:  'POST',
          headers: seamHeaders,
          body:    JSON.stringify({ device_id: deviceId }),
        })

        if (!listRes.ok) {
          const listText = await listRes.text()
          console.error('[members POST] Seam list failed status=%d body=%s', listRes.status, listText)
        } else {
          const { access_codes = [] } = await listRes.json()
          const existing = access_codes.find(c => c.code != null && String(c.code).trim() === accessCode)

          if (existing) {
            // PIN already on device — update the label to this member's name
            const updateRes  = await fetch(`${SEAM_API}/access_codes/update`, {
              method:  'POST',
              headers: seamHeaders,
              body:    JSON.stringify({ access_code_id: existing.access_code_id, name: memberName }),
            })
            const updateBody = await updateRes.json().catch(() => ({}))
            if (updateRes.ok) {
              console.log('[members POST] Seam update OK — access_code_id=%s name="%s" code=%s', existing.access_code_id, memberName, accessCode)
            } else {
              console.error('[members POST] Seam update FAILED status=%d body=%j', updateRes.status, updateBody)
            }
          } else {
            // PIN not on device — create a new code
            const createRes  = await fetch(`${SEAM_API}/access_codes/create`, {
              method:  'POST',
              headers: seamHeaders,
              body:    JSON.stringify({ device_id: deviceId, name: memberName, code: accessCode }),
            })
            const createBody = await createRes.json().catch(() => ({}))
            if (createRes.ok) {
              console.log('[members POST] Seam create OK — access_code_id=%s name="%s" code=%s', createBody?.access_code?.access_code_id, memberName, accessCode)
            } else {
              console.error('[members POST] Seam create FAILED status=%d body=%j', createRes.status, createBody)
            }
          }
        }
      } catch (seamErr) {
        // Seam failure must not block the member creation response
        console.error('[members POST] Seam programming threw: %s', seamErr.message)
      }
    } else {
      console.log('[members POST] skipping Seam — accessCode=%s apiKey=%s deviceId=%s',
        accessCode ?? 'none',
        apiKey   ? '(set)' : 'MISSING',
        deviceId ? '(set)' : 'MISSING',
      )
    }

    return NextResponse.json({ member }, { status: 200 })
  } catch (error) {
    console.error('[members POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
