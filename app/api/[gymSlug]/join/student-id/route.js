import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/join/student-id
 * Public — accepts a student ID file upload during the join flow.
 * Stores the file as a base64 data URL in StudentIdUpload (temporary holding
 * record). The webhook reads this by ID and copies it to the Member record.
 *
 * Body: multipart/form-data with fields:
 *   file  — the image or PDF file
 *   email — the applicant's email (used for lookup in webhook)
 */
export async function POST(request, { params }) {
  try {
    const { gymSlug } = await params

    const gym = await prisma.gym.findUnique({
      where:  { slug: gymSlug },
      select: { id: true },
    })
    if (!gym) return NextResponse.json({ error: 'Gym not found' }, { status: 404 })

    const formData = await request.formData()
    const file     = formData.get('file')
    const email    = (formData.get('email') ?? '').trim().toLowerCase()

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
    const bytes     = await file.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 400 })
    }

    const base64   = Buffer.from(bytes).toString('base64')
    const mimeType = file.type || 'application/octet-stream'
    const dataUrl  = `data:${mimeType};base64,${base64}`

    const upload = await prisma.studentIdUpload.create({
      data: { gymId: gym.id, email, fileData: dataUrl },
    })

    return NextResponse.json({ uploadId: upload.id })
  } catch (error) {
    console.error('[join/student-id POST]', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
