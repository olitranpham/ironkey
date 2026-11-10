// Which lock-code PINs the door-access page may write back to Member.accessCode.
// Only an unambiguous exact-name match whose PIN nobody else holds, for a
// non-canceled member who has no PIN or whose PIN isn't on the lock —
// anything else is a conflict for staff to resolve, and nothing is written.

/** Lowercase, accents stripped, whitespace collapsed. */
export function normalizeFullName(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * @param {object} params
 * @param {{ name?: string|null, code?: string|number|null }[]} params.lockCodes  every code on the gym's lock(s), managed and unmanaged
 * @param {{ id: string, firstName: string, lastName?: string|null, accessCode?: string|null, status?: string }[]} params.members  all members at the gym
 * @param {{ id: string, accessCode?: string|null }[]} params.guests  guest profiles linked to the gym
 * @returns {{ writes: { memberId: string, pin: string, codeName: string }[], conflicts: { memberId: string, pin: string, codeName: string, reason: string }[] }}
 */
export function planAccessCodeSync({ lockCodes, members, guests }) {
  const pinOf = v => (v == null ? null : String(v).trim() || null)
  const onLock = new Set(lockCodes.map(c => pinOf(c.code)).filter(Boolean))

  const membersByName = new Map()
  for (const m of members) {
    const key = normalizeFullName(`${m.firstName} ${m.lastName ?? ''}`)
    if (!key) continue
    membersByName.set(key, [...(membersByName.get(key) ?? []), m])
  }
  const codesByName = new Map()
  for (const c of lockCodes) {
    const key = normalizeFullName(c.name)
    if (!key || !pinOf(c.code)) continue
    codesByName.set(key, [...(codesByName.get(key) ?? []), c])
  }

  const writes = [], conflicts = []
  for (const [key, codes] of codesByName) {
    const named = membersByName.get(key)
    if (!named) continue                       // no member has exactly this name
    for (const c of codes) {
      const pin = pinOf(c.code)
      for (const m of named) {
        if (pinOf(m.accessCode) === pin) continue   // already this member's PIN
        const conflict = reason => conflicts.push({ memberId: m.id, pin, codeName: c.name, reason })
        if (m.status === 'CANCELED') { conflict('member is canceled'); continue }
        if (codes.length !== 1) { conflict(`${codes.length} lock codes have this member's exact name`); continue }
        if (named.length !== 1) { conflict(`${named.length} members have this code's exact name`); continue }
        const current = pinOf(m.accessCode)
        if (current && onLock.has(current)) { conflict("member's current PIN is already on the lock"); continue }
        const otherMember = members.find(o => o.id !== m.id && pinOf(o.accessCode) === pin)
        if (otherMember) { conflict(`PIN belongs to member ${otherMember.id}`); continue }
        const guest = guests.find(g => pinOf(g.accessCode) === pin)
        if (guest) { conflict(`PIN belongs to guest ${guest.id}`); continue }
        writes.push({ memberId: m.id, pin, codeName: c.name })
      }
    }
  }
  return { writes, conflicts }
}
