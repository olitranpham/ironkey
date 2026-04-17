import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

const PASS_TYPE_MAP = {
  single:     'SINGLE',
  '3-pack':   'THREE_PACK',
  '5-pack':   'FIVE_PACK',
  '10-pack':  'TEN_PACK',
  three_pack: 'THREE_PACK',
  five_pack:  'FIVE_PACK',
  ten_pack:   'TEN_PACK',
}

const PASS_TYPE_LABEL = {
  SINGLE:     'Day Pass',
  THREE_PACK: '3-Pack',
  FIVE_PACK:  '5-Pack',
  TEN_PACK:   '10-Pack',
}

/**
 * POST /api/[gymSlug]/guest-passes
 * Public route  called by Zapier when a guest purchases a pass.
 * Body: { name, email?, phone?, passType?, passesLeft?, accessCode? }
 *
 * Access code logic:
 *  - Returning guest (profile.accessCode exists)  reuse stored code, ignore body.accessCode
 *  - New guest (no accessCode yet)  save body.accessCode to profile and create Seam code
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const guestName = (body.name ?? '').trim()
    if (!guestName) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, seamApiKey: true, seamDeviceId: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const rawType  = (body.passType ?? '').toLowerCase().trim()
    const passType = PASS_TYPE_MAP[rawType] ?? 'SINGLE'
    const email    = (body.email ?? '').trim().toLowerCase() || null

    //  Upsert guest profile 
    let profile = null
    if (email) {
      profile = await prisma.guestProfile.upsert({
        where:  { gymId_email: { gymId: gym.id, email } },
        update: {
          name:  guestName,
          phone: body.phone ?? undefined,
        },
        create: {
          gymId: gym.id,
          name:  guestName,
          email,
          phone: body.phone ?? null,
        },
      })

      const seamHeaders = {
        Authorization:  `Bearer ${gym.seamApiKey}`,
        'Content-Type': 'application/json',
      }

      if (profile.accessCode) {
        //  Returning guest  reuse their existing code 
        // Ignore body.accessCode entirely; reprogram the stored code on the lock
        if (gym.seamApiKey && gym.seamDeviceId) {
          try {
            await fetch(`${SEAM_API}/access_codes/create`, {
              method:  'POST',
              headers: seamHeaders,
              body:    JSON.stringify({
                device_id: gym.seamDeviceId,
                name:      profile.name,
                code:      profile.accessCode,
              }),
            })
          } catch (seamErr) {
            console.error('[guest-passes POST] Seam reprogram error:', seamErr.message)
          }
        }
      } else {
        //  New guest  persist the code Zapier generated and create Seam code
        const incomingCode = body.accessCode ? String(body.accessCode).trim() : null
        if (incomingCode) {
          // Save to profile so it's reused on future purchases
          profile = await prisma.guestProfile.update({
            where: { id: profile.id },
            data:  { accessCode: incomingCode },
          })

          if (gym.seamApiKey && gym.seamDeviceId) {
            try {
              await fetch(`${SEAM_API}/access_codes/create`, {
                method:  'POST',
                headers: seamHeaders,
                body:    JSON.stringify({
                  device_id: gym.seamDeviceId,
                  name:      profile.name,
                  code:      incomingCode,
                }),
              })
            } catch (seamErr) {
              console.error('[guest-passes POST] Seam create error:', seamErr.message)
            }
          }
        }
      }
    }

    //  Create the pass 
    const pass = await prisma.guestPass.create({
      data: {
        gymId:          gym.id,
        guestProfileId: profile?.id ?? null,
        guestName,
        guestEmail:     email,
        guestPhone:     body.phone ?? null,
        passType,
        passesLeft:     body.passesLeft != null ? Number(body.passesLeft) : null,
        usedAt:         new Date(),
        expiresAt:      new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    const accessCode = profile?.accessCode ?? null
    return NextResponse.json({
      pass,
      accessCode,
      passTypeLabel: PASS_TYPE_LABEL[passType] ?? passType,
    }, { status: 201 })
  } catch (error) {
    console.error('[guest-passes POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/[gymSlug]/guest-passes
 * Returns guest profiles with their full pass history, sorted by most recent activity.
 */
export async function GET(request) {
  try {
    const gymId = request.headers.get('x-gym-id')

    if (!gymId) {
      return NextResponse.json({ error: 'Gym identity missing from request' }, { status: 400 })
    }

    // Profiles with all passes
    const profiles = await prisma.guestProfile.findMany({
      where:   { gymId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id:         true,
        name:       true,
        email:      true,
        phone:      true,
        accessCode: true,
        passes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id:         true,
            passType:   true,
            passesLeft: true,
            usedAt:     true,
            expiresAt:  true,
            createdAt:  true,
          },
        },
      },
    })

    // Also fetch unlinked passes (no profile / no email)
    const unlinked = await prisma.guestPass.findMany({
      where: {
        gymId,
        guestProfileId: null,
      },
      orderBy: [
        { usedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      select: {
        id:         true,
        guestName:  true,
        guestEmail: true,
        guestPhone: true,
        passType:   true,
        passesLeft: true,
        usedAt:     true,
        expiresAt:  true,
        createdAt:  true,
      },
    })

    console.log(`[guest-passes GET] ${profiles.length} profile(s), ${unlinked.length} unlinked pass(es) for gym ${gymId}`)
    return NextResponse.json({ profiles, unlinked })
  } catch (error) {
    console.error('[guest-passes GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
