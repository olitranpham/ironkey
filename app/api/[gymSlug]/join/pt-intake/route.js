import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/join/pt-intake
 * Public — saves PT intake form responses after a PT/programming checkout.
 *
 * Body: {
 *   name, email, phone, goals, experience, injuriesConditions,
 *   additionalInfo, consultationTime
 * }
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const body = await request.json()

    const {
      name,
      email,
      phone,
      goals,
      experience,
      injuriesConditions,
      additionalInfo,
      consultationTime,
    } = body

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true, zapierMemberWebhookUrl: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const intake = await prisma.pTIntake.create({
      data: {
        gymId:              gym.id,
        name:               name               || null,
        email:              email.trim().toLowerCase(),
        phone:              phone              || null,
        goals:              goals              || null,
        experience:         experience         || null,
        injuriesConditions: injuriesConditions || null,
        additionalInfo:     additionalInfo     || null,
        consultationTime:   consultationTime   || null,
      },
    })

    // Fire Zapier webhook
    const zapierUrl = gym.zapierMemberWebhookUrl || process.env.ZAPIER_MEMBER_WEBHOOK_URL
    if (zapierUrl) {
      fetch(zapierUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type: 'pt_intake',
          name,
          email,
          phone,
          goals,
          experience,
          injuriesConditions,
          additionalInfo,
          consultationTime,
        }),
      }).catch(e => console.error('[pt-intake] Zapier webhook error:', e.message))
    }

    return NextResponse.json({ ok: true, intakeId: intake.id })
  } catch (error) {
    console.error('[join/pt-intake POST]', error)
    return NextResponse.json({ error: 'Failed to save intake form' }, { status: 500 })
  }
}
