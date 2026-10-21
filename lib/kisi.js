import { redactJsonText } from './redact'

const KISI_API = 'https://api.kisi.io'

// Hard allowlist — grantAccess/revokeAccess (via the group check below) will
// only ever create a role assignment in one of a gym's own two
// Ironkey-managed groups (gym.kisiMemberGroupId / gym.kisiWeekendGroupId).
// These specific IDs are blocked explicitly, in addition to the allowlist,
// so a future bug that widens the allowlist can't silently start touching
// them: 280519 is DNA's Ownership group, 202923/202924/383448 are
// Glofox-managed groups this integration must never write to.
const FORBIDDEN_GROUP_IDS = new Set(['280519', '202923', '202924', '383448'])

function assertGroupAllowed(gym, groupId) {
  const groupIdStr = String(groupId)
  if (FORBIDDEN_GROUP_IDS.has(groupIdStr)) {
    throw new Error(`[kisi] refusing to touch forbidden group ${groupId} (Ownership/Glofox)`)
  }
  const allowed = new Set([gym.kisiMemberGroupId, gym.kisiWeekendGroupId].filter(Boolean).map(String))
  if (!allowed.has(groupIdStr)) {
    throw new Error(`[kisi] refusing to touch group ${groupId} — not one of gym ${gym.id}'s configured groups (${[...allowed].join(', ') || 'none configured'})`)
  }
}

/**
 * Fetch wrapper for the Kisi API — handles auth and 429 rate-limit backoff.
 * Retries up to 5 times, honoring Retry-After when present (falls back to
 * exponential backoff starting at 2s if the header is missing).
 */
async function kisiFetch(gym, path, options = {}, attempt = 1) {
  const res = await fetch(`${KISI_API}${path}`, {
    ...options,
    headers: {
      Authorization:  `KISI-LOGIN ${gym.kisiApiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (res.status === 429 && attempt <= 5) {
    const retryAfterSecs = Number(res.headers.get('retry-after')) || 2 ** attempt
    console.warn('[kisi] 429 rate limited on %s — retrying in %ds (attempt %d/5)', path, retryAfterSecs, attempt)
    await new Promise(r => setTimeout(r, retryAfterSecs * 1000))
    return kisiFetch(gym, path, options, attempt + 1)
  }

  return res
}

/**
 * Finds a Kisi user by email, creating one if none exists. Never deletes or
 * modifies an existing user. Returns `created: true` only when a brand-new
 * Kisi account was just made — callers use that to decide whether this
 * person has ever seen a Kisi notification before (see `notify` on
 * grantAccess).
 *
 * @param {object} gym   Gym row with kisiApiKey
 * @param {string} email
 * @param {string} name
 * @returns {Promise<{ kisiUserId: string, created: boolean }>}
 */
export async function findOrCreateUser(gym, email, name) {
  const normalizedEmail = email.trim().toLowerCase()

  const listRes = await kisiFetch(gym, `/users?filter[email]=${encodeURIComponent(normalizedEmail)}`, { method: 'GET' })
  if (!listRes.ok) {
    const text = await listRes.text()
    throw new Error(`[kisi] findOrCreateUser: list failed status=${listRes.status} body=${text}`)
  }
  const listBody = await listRes.json()
  const found = (Array.isArray(listBody) ? listBody : listBody?.data ?? [])[0]
  if (found) {
    console.log('[kisi] findOrCreateUser: found existing user id=%s email=%s', found.id, normalizedEmail)
    return { kisiUserId: String(found.id), created: false }
  }

  const createRes = await kisiFetch(gym, '/users', {
    method: 'POST',
    body:   JSON.stringify({ email: normalizedEmail, name }),
  })
  if (!createRes.ok) {
    const text = await createRes.text()
    throw new Error(`[kisi] findOrCreateUser: create failed status=${createRes.status} body=${text}`)
  }
  const created = await createRes.json()
  console.log('[kisi] findOrCreateUser: created new user id=%s email=%s', created.id, normalizedEmail)
  return { kisiUserId: String(created.id), created: true }
}

/**
 * Grants access by creating a role assignment in one of the gym's own two
 * Ironkey-managed groups. Refuses (throws) if groupId isn't exactly
 * gym.kisiMemberGroupId or gym.kisiWeekendGroupId.
 *
 * @param {object} gym
 * @param {string} kisiUserId
 * @param {string} groupId
 * @param {object} [opts]
 * @param {string}  [opts.validUntil]  ISO timestamp — time-bound grant (unused for member/weekend groups today, reserved for future guest-pass work)
 * @param {boolean} [opts.notify]      Only true for a user's first-ever grant (see findOrCreateUser's `created`) — default false
 * @returns {Promise<string>} the new role_assignment id
 */
export async function grantAccess(gym, kisiUserId, groupId, { validUntil = null, notify = false } = {}) {
  assertGroupAllowed(gym, groupId)

  const body = {
    role_id:  'group_basic',
    group_id: groupId,
    user_id:  kisiUserId,
    notify,
  }
  if (validUntil) body.valid_until = validUntil

  const res = await kisiFetch(gym, '/role_assignments', {
    method: 'POST',
    body:   JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[kisi] grantAccess: failed status=${res.status} body=${text}`)
  }
  const assignment = await res.json()
  console.log('[kisi] grantAccess: created role_assignment id=%s user=%s group=%s notify=%s', assignment.id, kisiUserId, groupId, notify)
  return String(assignment.id)
}

/**
 * Revokes a single role assignment by id. Never touches the underlying
 * Kisi user. A 404 (already gone) is treated as success.
 *
 * @param {object} gym
 * @param {string} roleAssignmentId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function revokeAccess(gym, roleAssignmentId) {
  if (!roleAssignmentId) return { ok: true }

  const res = await kisiFetch(gym, `/role_assignments/${roleAssignmentId}`, { method: 'DELETE' })
  if (res.ok || res.status === 404) {
    console.log('[kisi] revokeAccess: removed role_assignment id=%s (status=%d)', roleAssignmentId, res.status)
    return { ok: true }
  }
  const text = await res.text()
  console.error('[kisi] revokeAccess: failed id=%s status=%d body=%j', roleAssignmentId, res.status, redactJsonText(text))
  return { ok: false }
}

/**
 * Lists door-unlock events for the gym's place, optionally scoped to one
 * Kisi user. NOTE: the exact /events filter query-param shape below was not
 * part of the confirmed/tested Kisi surface (only auth, users, and
 * role_assignments were verified live against DNA's org) — verify this
 * against Kisi's current API reference before relying on it.
 *
 * @param {object} gym
 * @param {string} [since]        ISO timestamp lower bound
 * @param {string} [kisiUserId]   scope to one user
 * @returns {Promise<Array>} raw Kisi event objects
 */
export async function listEvents(gym, since, kisiUserId = null) {
  const params = new URLSearchParams()
  params.set('filter[place_id]', gym.kisiPlaceId)
  if (since)      params.set('filter[created_at][gte]', since)
  if (kisiUserId) params.set('filter[user_id]', kisiUserId)

  const res = await kisiFetch(gym, `/events?${params.toString()}`, { method: 'GET' })
  if (!res.ok) {
    const text = await res.text()
    console.error('[kisi] listEvents: failed status=%d body=%j', res.status, redactJsonText(text))
    return []
  }
  const body = await res.json()
  return Array.isArray(body) ? body : body?.data ?? []
}

/**
 * Ensures a member has exactly one active Kisi role assignment, in the
 * correct group for their current membershipType — used at every call site
 * where a member is created or has their billing/membershipType updated
 * (the platform webhook's signup branch, and the members upsert route), so
 * re-running this for the same member is always safe and never creates a
 * duplicate assignment.
 *
 *  - No existing kisiUserId         → find-or-create the Kisi user, grant
 *                                      into the target group; notify only
 *                                      if the Kisi account was brand new.
 *  - Existing kisiUserId, but the
 *    target group differs from the
 *    one their old membershipType
 *    implied (a tier change)        → revoke the old assignment, grant a
 *                                      new one in the new group.
 *  - Existing kisiUserId, same
 *    group, no assignment on file
 *    (e.g. frozen and never
 *    resumed cleanly)               → grant fresh, no revoke needed.
 *  - Existing kisiUserId, same
 *    group, assignment on file      → no-op.
 *
 * @param {object} gym
 * @param {object} params
 * @param {{kisiUserId: ?string, kisiRoleAssignmentId: ?string, membershipType: ?string}|null} params.existingMember  null for a brand-new member
 * @param {string} params.email
 * @param {string} params.name
 * @param {string} params.membershipType  the member's current (just-updated) membershipType
 * @returns {Promise<{kisiUserId: string, kisiRoleAssignmentId: string}|null>} null if the gym has no group configured for this membershipType
 */
export async function ensureKisiMembership(gym, { existingMember, email, name, membershipType }) {
  const targetGroupId = groupIdForMembershipType(gym, membershipType)
  if (!targetGroupId) {
    console.warn('[kisi] ensureKisiMembership: no group configured for membershipType=%s gym=%s — skipping', membershipType, gym.id)
    return null
  }

  if (existingMember?.kisiUserId) {
    const oldGroupId   = groupIdForMembershipType(gym, existingMember.membershipType)
    const tierChanged  = oldGroupId !== targetGroupId

    if (tierChanged && existingMember.kisiRoleAssignmentId) {
      await revokeAccess(gym, existingMember.kisiRoleAssignmentId)
    }
    if (tierChanged || !existingMember.kisiRoleAssignmentId) {
      const roleAssignmentId = await grantAccess(gym, existingMember.kisiUserId, targetGroupId, { notify: false })
      return { kisiUserId: existingMember.kisiUserId, kisiRoleAssignmentId: roleAssignmentId }
    }
    return { kisiUserId: existingMember.kisiUserId, kisiRoleAssignmentId: existingMember.kisiRoleAssignmentId }
  }

  const { kisiUserId, created } = await findOrCreateUser(gym, email, name)
  const roleAssignmentId = await grantAccess(gym, kisiUserId, targetGroupId, { notify: created })
  return { kisiUserId, kisiRoleAssignmentId: roleAssignmentId }
}

/**
 * Pure helper — which of the gym's two groups a member belongs in, based on
 * their membershipType. Shared by every call site that grants or re-grants
 * access, so "weekend → kisiWeekendGroupId, everything else →
 * kisiMemberGroupId" is decided in exactly one place.
 *
 * @param {object} gym
 * @param {string} membershipType
 * @returns {string|null} the target group id, or null if the gym has no groups configured
 */
export function groupIdForMembershipType(gym, membershipType) {
  const isWeekend = (membershipType ?? '').toUpperCase() === 'WEEKEND'
  return isWeekend ? (gym.kisiWeekendGroupId ?? null) : (gym.kisiMemberGroupId ?? null)
}
