import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

/**
 * PATCH /api/[gymSlug]/guest-passes/profiles/[profileId]
 * Updates a guest profile's name, phone, or accessCode.
 * When accessCode changes, recreates the Seam code on the device.
 */
export async function PATCH(request, { params }) {
  try {
    const gymId      = request.headers.get('x-gym-id')
    const { profileId } = await params
    const body       = await request.json()

    const profile = await prisma.guestProfile.findFirst({
      where: { id: profileId, gymId },
    })
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const data = {}
    if (body.name  !== undefined) data.name  = body.name
    if (body.phone !== undefined) data.phone = body.phone

    const newCode = body.accessCode !== undefined ? String(body.accessCode).trim() : null

    if (newCode && newCode !== profile.accessCode) {
      data.accessCode = newCode

      // Recreate Seam code
      const gym = await prisma.gym.findUnique({
        where:  { id: gymId },
        select: { seamApiKey: true, seamDeviceId: true },
      })
      if (gym?.seamApiKey && gym?.seamDeviceId) {
        try {
          const seamHeaders = {
            Authorization:  `Bearer ${gym.seamApiKey}`,
            'Content-Type': 'application/json',
          }
          // Delete old code if one existed
          if (profile.accessCode) {
            const listRes  = await fetch(`${SEAM_API}/access_codes/list`, {
              method: 'POST', headers: seamHeaders,
              body:   JSON.stringify({ device_id: gym.seamDeviceId }),
            })
            const { access_codes = [] } = await listRes.json()
            const match = access_codes.find(c => String(c.code).trim() === String(profile.accessCode).trim())
            if (match) {
              await fetch(`${SEAM_API}/access_codes/delete`, {
                method: 'POST', headers: seamHeaders,
                body:   JSON.stringify({ access_code_id: match.access_code_id }),
              })
            }
          }
          // Create new code
          await fetch(`${SEAM_API}/access_codes/create`, {
            method: 'POST', headers: seamHeaders,
            body:   JSON.stringify({
              device_id: gym.seamDeviceId,
              name:      data.name ?? profile.name,
              code:      newCode,
            }),
          })
        } catch (seamErr) {
          console.error('[guest-profile PATCH] Seam error:', seamErr.message)
        }
      }
    } else if (body.accessCode === '' || body.accessCode === null) {
      data.accessCode = null
    }

    const updated = await prisma.guestProfile.update({
      where: { id: profileId },
      data,
    })

    return NextResponse.json({ profile: updated })
  } catch (error) {
    console.error('[guest-profile PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
