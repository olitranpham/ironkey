import prisma from '@/lib/prisma'
import { can } from '@/lib/permissions'

/**
 * True when the caller may only touch their own trainer's sessions
 * (has pt.manage_own but not pt.manage_all).
 * @param {{ user: object }} ctx
 */
export function ptOwnOnly(ctx) {
  return !can(ctx.user, 'pt.manage_all')
}

/**
 * Check that a session's trainer and members all belong to this gym.
 * Pass only the fields being written (undefined = not checked).
 * @returns {Promise<string | null>} error message, or null if valid
 */
export async function validateSessionRefs(gymId, { trainerId, memberIds }) {
  if (trainerId !== undefined) {
    const trainer = await prisma.personalTrainer.findFirst({ where: { id: trainerId, gymId }, select: { id: true } })
    if (!trainer) return 'Trainer not found'
  }
  if (memberIds !== undefined) {
    if (!Array.isArray(memberIds)) return 'memberIds must be an array'
    const ids = [...new Set(memberIds)]
    const found = await prisma.member.count({ where: { id: { in: ids }, gymId } })
    if (found !== ids.length) return 'Member not found'
  }
  return null
}
