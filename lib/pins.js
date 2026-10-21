import { randomInt } from 'crypto'
import prisma from '@/lib/prisma'

/** Every gym currently uses 4-digit codes (1000–9999); there is no per-gym setting. */
export const DEFAULT_PIN_LENGTH = 4
export const MAX_PIN_ATTEMPTS   = 20

/**
 * Every door code already in use at a gym.
 *  - Members: any non-null accessCode, regardless of status — frozen/canceled
 *    members get their stored code back on resume / reverse-cancel.
 *  - Guests: profile codes of guests with a pass or waiver at this gym
 *    (guest codes are stored on the shared profile and reused).
 *  - Partner (REP Gym Pass) check-ins at this gym.
 * @param {string} gymId
 * @returns {Promise<Set<string>>}
 */
export async function takenPins(gymId) {
  const [members, guests, repCheckins] = await Promise.all([
    prisma.member.findMany({
      where:  { gymId, accessCode: { not: null } },
      select: { accessCode: true },
    }),
    prisma.guest.findMany({
      where:  {
        accessCode: { not: null },
        OR: [{ passes: { some: { gymId } } }, { waivers: { some: { gymId } } }],
      },
      select: { accessCode: true },
    }),
    prisma.repGymPassCheckin.findMany({
      where:  { gymId },
      select: { accessCode: true },
    }),
  ])
  return new Set([...members, ...guests, ...repCheckins].map(r => String(r.accessCode).trim()))
}

/**
 * A random numeric PIN of `length` digits (no leading zero) that no member,
 * guest or partner check-in at this gym uses, and that isn't in `seamCodes`
 * (pass the lock's code list when the caller already fetched it) or `exclude`.
 *
 * @param {string} gymId
 * @param {number} [length]
 * @param {{ seamCodes?: Iterable<string>, exclude?: Iterable<string> }} [options]
 * @returns {Promise<string>}
 * @throws if no free PIN is found within MAX_PIN_ATTEMPTS tries
 */
export async function generateUniquePin(gymId, length = DEFAULT_PIN_LENGTH, { seamCodes = [], exclude = [] } = {}) {
  if (!gymId) throw new Error('generateUniquePin: gymId is required')
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new Error(`generateUniquePin: invalid length ${length}`)
  }

  const taken = await takenPins(gymId)
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
