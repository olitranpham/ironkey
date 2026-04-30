import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getAllowedPassTypes } from '@/lib/gymPassTypes'

const PASS_TYPE_MAP = {
  single:     'SINGLE',
  '3-pack':   'THREE_PACK',
  '5-pack':   'FIVE_PACK',
  '10-pack':  'TEN_PACK',
  three_pack: 'THREE_PACK',
  five_pack:  'FIVE_PACK',
  ten_pack:   'TEN_PACK',
  value:      'VALUE',
  deluxe:     'DELUXE',
}

const PASS_TYPE_LABEL = {
  SINGLE:     'Day Pass',
  THREE_PACK: '3-Pack',
  FIVE_PACK:  '5-Pack',
  TEN_PACK:   '10-Pack',
  VALUE:      'Value',
  DELUXE:     'Deluxe',
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
      select: { id: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    const rawType  = (body.passType ?? '').toLowerCase().trim()
    const passType = PASS_TYPE_MAP[rawType] ?? 'SINGLE'

    const allowed = getAllowedPassTypes(gymSlug)
    if (!allowed.includes(passType)) {
      return NextResponse.json(
        { error: `Pass type "${passType}" is not available for this gym` },
        { status: 400 },
      )
    }
    const email    = (body.email ?? '').trim().toLowerCase() || null

    //  Upsert guest profile (global — keyed by email only)
    let profile = null
    if (email) {
      profile = await prisma.guest.upsert({
        where:  { email },
        update: {
          name:  guestName,
          phone: body.phone ?? undefined,
        },
        create: {
          name:  guestName,
          email,
          phone: body.phone ?? null,
        },
      })

      if (profile.accessCode) {
        // Returning guest -- accessCode already stored, Zapier will reprogram Seam
      } else {
        // New guest -- save incoming code to profile
        const incomingCode = body.accessCode ? String(body.accessCode).trim() : null
        if (incomingCode) {
          profile = await prisma.guest.update({
            where: { id: profile.id },
            data:  { accessCode: incomingCode },
          })
        }
      }
    }

    //  Create the pass 
    const pass = await prisma.guestVisit.create({
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
export async function GET(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }
    const gymId = gym.id

    // Find profile IDs that have passes at this gym (GuestProfile is now global)
    const gymPassLinks = await prisma.guestVisit.findMany({
      where:    { gymId, guestProfileId: { not: null } },
      select:   { guestProfileId: true },
      distinct: ['guestProfileId'],
    })
    const profileIds = gymPassLinks.map(p => p.guestProfileId)

    const profiles = await prisma.guest.findMany({
      where:   { id: { in: profileIds } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id:         true,
        name:       true,
        email:      true,
        phone:      true,
        accessCode: true,
        passes: {
          where:   { gymId },   // only this gym's passes
          orderBy: { usedAt: { sort: 'desc', nulls: 'last' } },
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
    const unlinked = await prisma.guestVisit.findMany({
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
