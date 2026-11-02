// Calendar months in the gym's own timezone (America/New_York unless the gym
// says otherwise). Shared by the revenue page and the guest passes page so a
// purchase lands in the same month on both — Railway runs in UTC, so a
// late-evening ET purchase on the last of the month would otherwise move to
// the next month.

export const DEFAULT_GYM_TIME_ZONE = 'America/New_York'

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  return Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
}

/**
 * Midnight on the 1st of `year`-`month` (0-indexed; 12 rolls into the next
 * year) in `timeZone`, as a UTC epoch second.
 */
export function monthStart(year, month, timeZone = DEFAULT_GYM_TIME_ZONE) {
  const utcGuess = Date.UTC(year, month, 1)
  const parts = zonedParts(utcGuess, timeZone)
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  const offsetMs = asUTC - utcGuess
  return Math.floor((utcGuess - offsetMs) / 1000)
}

/**
 * 'YYYY-MM' of `date` in `timeZone`, or null for a missing/invalid date.
 *
 * @param {Date | string | number | null | undefined} date
 * @param {string} [timeZone]
 * @returns {string | null}
 */
export function monthKey(date, timeZone = DEFAULT_GYM_TIME_ZONE) {
  if (date == null) return null
  const d = new Date(date)
  if (isNaN(d.getTime())) return null
  const parts = zonedParts(d, timeZone)
  return `${parts.year}-${parts.month}`
}
