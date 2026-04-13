import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/prisma'

/**
 * POST /api/[gymSlug]/settings/password
 * Body: { currentPassword, newPassword }
 *
 * Verifies the caller's current password, then hashes and saves the new one.
 * Any authenticated user may change their own password.
 */
export async function POST(request) {
  try {
    const userId = request.headers.get('x-gym-user-id')

    if (!userId) {
      return NextResponse.json({ error: 'Missing user context' }, { status: 400 })
    }

    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Both current and new password are required' },
        { status: 400 },
      )
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 },
      )
    }

    const user = await prisma.gymUser.findUnique({ where: { id: userId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(newPassword, 12)
    await prisma.gymUser.update({ where: { id: userId }, data: { password: hashed } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[settings/password POST]', error.message, error.stack)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
