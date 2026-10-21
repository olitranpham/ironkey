import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withGymContext } from '@/lib/auth/gymContext'

/** Every permission a GymUser can hold. Unknown strings in permAdd/permRemove are ignored. */
export const PERMISSIONS = [
  'members.view',
  'members.edit',
  'members.delete',
  'members.freeze',
  'members.cancel',
  'billing.view',
  'billing.act',
  'products.manage',
  'inventory.manage',
  'door.view',
  'door.manage',
  'guestpasses.manage',
  'guestpasses.delete',
  'pt.manage_all',
  'pt.manage_own',
  'email.send',
  'staff.manage',
  'settings.manage',
]

const KNOWN = new Set(PERMISSIONS)

/** Defaults per role. OWNER is not listed — it always has every permission. */
export const ROLE_DEFAULTS = {
  ADMIN: [
    'members.view', 'members.edit', 'members.freeze', 'members.cancel',
    'billing.view', 'products.manage', 'inventory.manage',
    'door.view', 'door.manage', 'guestpasses.manage', 'guestpasses.delete',
    'pt.manage_all', 'email.send',
  ],
  STAFF: [
    'members.view', 'members.edit', 'members.freeze',
    'door.view', 'door.manage', 'guestpasses.manage', 'pt.manage_all',
  ],
  TRAINER: [
    'members.view', 'pt.manage_own',
  ],
}

/**
 * (role defaults ∪ permAdd) − permRemove, restricted to known permissions.
 * OWNER always gets every permission regardless of overrides.
 * @param {{ role: string, permAdd?: string[], permRemove?: string[] }} user
 * @returns {string[]} in PERMISSIONS order
 */
export function effectivePermissions(user) {
  if (!user) return []
  if (user.role === 'OWNER') return [...PERMISSIONS]

  const granted = new Set([...(ROLE_DEFAULTS[user.role] ?? []), ...(user.permAdd ?? [])])
  for (const p of user.permRemove ?? []) granted.delete(p)
  return PERMISSIONS.filter(p => granted.has(p))
}

/**
 * @param {object} user
 * @param {string} perm
 * @returns {boolean}
 */
export function can(user, perm) {
  if (!KNOWN.has(perm)) return false
  return effectivePermissions(user).includes(perm)
}

/**
 * Gym context + permission gate for route handlers.
 * `perm` may be a single permission or an array (any-of).
 *
 *   const { ctx, errorResponse } = await requirePermission(request, gymSlug, 'members.view')
 *   if (errorResponse) return errorResponse
 *
 * @param {Request} request
 * @param {string} gymSlug
 * @param {string | string[]} perm
 * @returns {Promise<{ ctx?: { gym: object, user: object }, errorResponse?: NextResponse }>}
 */
export async function requirePermission(request, gymSlug, perm) {
  const { ctx, errorResponse } = await withGymContext(request, gymSlug)
  if (errorResponse) return { errorResponse }

  const perms = Array.isArray(perm) ? perm : [perm]
  if (!perms.some(p => can(ctx.user, p))) {
    return { errorResponse: forbidden() }
  }
  return { ctx }
}

/** 403 JSON response used for permission failures inside handlers. */
export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * Member IDs a TRAINER may see: every member in any PTSession (past or
 * upcoming) whose trainerId is the user's linked PersonalTrainer.
 * TRAINER is always scoped regardless of permAdd. A TRAINER with no linked
 * trainer gets an empty set. Non-trainers → null (unscoped).
 *
 * @param {{ gym: { id: string }, user: { role: string, personalTrainerId?: string | null } }} ctx
 * @returns {Promise<Set<string> | null>}
 */
export async function trainerMemberScope(ctx) {
  if (ctx.user.role !== 'TRAINER') return null
  if (!ctx.user.personalTrainerId) return new Set()

  const rows = await prisma.pTSessionMember.findMany({
    where:    { session: { trainerId: ctx.user.personalTrainerId, gymId: ctx.gym.id } },
    select:   { memberId: true },
    distinct: ['memberId'],
  })
  return new Set(rows.map(r => r.memberId))
}

/** Fields a TRAINER may see on a member record. */
export const TRAINER_MEMBER_FIELDS = ['id', 'firstName', 'lastName', 'email', 'phone', 'status', 'membershipType']

/** Reduce a member object to TRAINER_MEMBER_FIELDS. */
export function trainerMemberView(member) {
  const out = {}
  for (const k of TRAINER_MEMBER_FIELDS) if (k in member) out[k] = member[k]
  return out
}
