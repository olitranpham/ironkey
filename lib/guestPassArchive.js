// Guest-pass archive rule, shared by the guest passes list and its export.
// A guest (or unlinked pass) is archived for a gym when its most recent
// activity there is older than this. Computed per request — never stored —
// so a returning guest is back in the active list on their next purchase or
// check-in.

export const ARCHIVE_AFTER_MONTHS = 6

/** Latest of the given dates (Date | null), or null. */
export function latest(...dates) {
  let max = null
  for (const d of dates) if (d && (!max || d > max)) max = d
  return max
}

/** (lastActivity) => archived?, against a cutoff of ARCHIVE_AFTER_MONTHS ago. */
export function archivePredicate(now = new Date()) {
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_AFTER_MONTHS)
  return lastActivity => !lastActivity || lastActivity < cutoff
}
