import { randomInt } from 'crypto'
import prisma from '@/lib/prisma'

/** Every gym currently uses 4-digit codes (1000–9999); there is no per-gym setting. */
export const DEFAULT_PIN_LENGTH = 4
export const MAX_PIN_ATTEMPTS   = 20

/**
 * Gyms whose locks a guest's (global) code can be live on: every gym the
 * guest has a pass or waiver at.
 * @param {string} guestId
 * @returns {Promise<string[]>}
 */
export async function guestGymIds(guestId) {
  const [passes, waivers] = await Promise.all([
    prisma.guestVisit.findMany({ where: { guestProfileId: guestId }, select: { gymId: true }, distinct: ['gymId'] }),
    prisma.guestWaiver.findMany({ where: { guestProfileId: guestId }, select: { gymId: true } }),
  ])
  return [...new Set([...passes, ...waivers].map(r => r.gymId))]
}

/**
 * Every door code already in use at the given gym(s).
 *  - Members: any non-null accessCode, regardless of status — frozen/canceled
 *    members get their stored code back on resume / reverse-cancel.
 *  - Guests: profile codes of guests with a pass or waiver at these gyms
 *    (guest codes are stored on the shared profile and reused everywhere).
 *  - Partner (REP Gym Pass) check-ins at these gyms.
 * The record being edited (excludeMemberId / excludeGuestId) is left out.
 *
 * @param {string | string[]} gymIds
 * @param {{ excludeMemberId?: string, excludeGuestId?: string }} [options]
 * @returns {Promise<Set<string>>}
 */
export async function takenPins(gymIds, { excludeMemberId = null, excludeGuestId = null } = {}) {
  const ids = [...new Set([].concat(gymIds).filter(Boolean))]
  if (ids.length === 0) return new Set()

  const [members, guests, repCheckins] = await Promise.all([
    prisma.member.findMany({
      where:  { gymId: { in: ids }, accessCode: { not: null }, ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}) },
      select: { accessCode: true },
    }),
    prisma.guest.findMany({
      where:  {
        accessCode: { not: null },
        ...(excludeGuestId ? { id: { not: excludeGuestId } } : {}),
        OR: [{ passes: { some: { gymId: { in: ids } } } }, { waivers: { some: { gymId: { in: ids } } } }],
      },
      select: { accessCode: true },
    }),
    prisma.repGymPassCheckin.findMany({
      where:  { gymId: { in: ids } },
      select: { accessCode: true },
    }),
  ])
  return new Set([...members, ...guests, ...repCheckins].map(r => String(r.accessCode).trim()))
}

/** Gyms to check for a code at `gymId`, widened to all of the guest's gyms when guestId is given. */
async function scopeGyms(gymId, guestId) {
  return guestId ? [gymId, ...(await guestGymIds(guestId))] : [gymId]
}

/**
 * A random numeric PIN of `length` digits (no leading zero) that no member,
 * guest or partner check-in uses at this gym — or, for a guest (`guestId`), at
 * any gym that guest has passes/waivers at — and that isn't in `seamCodes`
 * (pass the lock's code list when the caller already fetched it) or `exclude`.
 *
 * @param {string} gymId
 * @param {number} [length]
 * @param {{ seamCodes?: Iterable<string>, exclude?: Iterable<string>, guestId?: string }} [options]
 * @returns {Promise<string>}
 * @throws if no free PIN is found within MAX_PIN_ATTEMPTS tries
 */
export async function generateUniquePin(gymId, length = DEFAULT_PIN_LENGTH, { seamCodes = [], exclude = [], guestId = null } = {}) {
  if (!gymId) throw new Error('generateUniquePin: gymId is required')
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new Error(`generateUniquePin: invalid length ${length}`)
  }

  const taken = await takenPins(await scopeGyms(gymId, guestId), { excludeGuestId: guestId })
  for (const c of seamCodes) if (c != null) taken.add(String(c).trim())
  for (const c of exclude)   if (c != null) taken.add(String(c).trim())

  const min = 10 ** (length - 1)
  const max = 10 ** length
  for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt++) {
    const candidate = String(randomInt(min, max))
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`generateUniquePin: no free ${length}-digit PIN found for gym ${gymId} after ${MAX_PIN_ATTEMPTS} attempts`)
}

/**
 * True if `pin` collides with any code generateUniquePin would exclude —
 * ignoring the record being edited (memberId or guestId). For a guest the
 * check spans every gym the guest has passes/waivers at.
 *
 * @param {string} gymId
 * @param {string} pin
 * @param {{ memberId?: string, guestId?: string }} [options]
 * @returns {Promise<boolean>}
 */
export async function isPinInUse(gymId, pin, { memberId = null, guestId = null } = {}) {
  const value = String(pin ?? '').trim()
  if (!value) return false
  const taken = await takenPins(await scopeGyms(gymId, guestId), { excludeMemberId: memberId, excludeGuestId: guestId })
  return taken.has(value)
}

/** Standard 409 body for a manually entered code that collides. */
export const PIN_IN_USE_ERROR = 'code already in use'
