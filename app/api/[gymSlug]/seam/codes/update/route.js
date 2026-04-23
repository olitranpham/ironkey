import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const SEAM_API = 'https://connect.getseam.com'

export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params
    const { accessCodeId, code } = await request.json()

    if (!accessCodeId || !code) {
      return NextResponse.json({ error: 'accessCodeId and code are required' }, { status: 400 })
    }

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { seamApiKey: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const apiKey = gym.seamApiKey ?? process.env.SEAM_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Seam not configured' }, { status: 422 })

    const seamRes = await fetch(`${SEAM_API}/access_codes/update`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ access_code_id: accessCodeId, code }),
    })

    const body = await seamRes.json()
    if (!seamRes.ok) {
      console.error('[seam/codes/update] Seam error:', seamRes.status, body)
      return NextResponse.json({ error: body?.error?.message ?? 'Seam API error' }, { status: 502 })
    }

    return NextResponse.json(body)
  } catch (error) {
    console.error('[seam/codes/update]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
