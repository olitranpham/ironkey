// Door-access hours for time-bound guest codes. A gym with accessHoursStart /
// accessHoursEnd set (e.g. "09:00" / "21:00", in the gym's own timezone) gets
// guest codes valid only inside those hours on one day; a gym with them null
// keeps the rolling 24-hour window. accessLastEntry (e.g. "20:00", optional)
// moves purchases after it to the next day. Member codes are not affected.

import { DEFAULT_GYM_TIME_ZONE } from '@/lib/etMonth'

const DAY_MS  = 24 * 60 * 60 * 1000
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "21:00" → 1260 (minutes after midnight); null if not a valid HH:MM. */
export function parseHHMM(value) {
  const m = HHMM_RE.exec(String(value ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * The gym's daily access hours in minutes after local midnight, or null for
 * 24/7 (either field unset or invalid, or end not after start). lastEntry is
 * the purchase cutoff — the closing time when unset or outside the hours.
 *
 * @param {{ accessHoursStart?: string|null, accessHoursEnd?: string|null, accessLastEntry?: string|null }} gym
 * @returns {{ start: number, end: number, lastEntry: number } | null}
 */
export function accessHours(gym) {
  const start = parseHHMM(gym?.accessHoursStart)
  const end   = parseHHMM(gym?.accessHoursEnd)
  if (start == null || end == null || end <= start) return null
  const lastEntry = parseHHMM(gym?.accessLastEntry)
  return { start, end, lastEntry: lastEntry != null && lastEntry > start && lastEntry < end ? lastEntry : end }
}

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, Number(x.value)]))
  return { year: p.year, month: p.month, day: p.day, minutes: p.hour * 60 + p.minute }
}

/** UTC instant of wall-clock `minutes` after midnight on year-month-day in `timeZone` (DST-safe). */
function zonedTime(year, month, day, minutes, timeZone) {
  const wallAsUTC = Date.UTC(year, month - 1, day, 0, minutes)
  let guess = wallAsUTC
  // Two passes settle the offset across a DST boundary
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone)
    guess += wallAsUTC - Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes)
  }
  return new Date(guess)
}

/**
 * Window for a guest code issued at `at`:
 *  - no access hours → [at, at + 24h]
 *  - before opening  → today's opening–closing
 *  - during hours    → [at, today's closing]
 *  - after closing, or after last entry (purchases) → tomorrow's opening–closing
 * Kiosk check-ins pass { lastEntry: false }: a guest checking in at the door
 * before closing gets the rest of today.
 *
 * @param {{ accessHoursStart?: string|null, accessHoursEnd?: string|null, accessLastEntry?: string|null, timezone?: string|null }} gym
 * @param {Date} [at]
 * @param {{ lastEntry?: boolean }} [options]
 * @returns {{ startsAt: Date, endsAt: Date }}
 */
export function accessWindow(gym, at = new Date(), { lastEntry = true } = {}) {
  const hours = accessHours(gym)
  if (!hours) return { startsAt: at, endsAt: new Date(at.getTime() + DAY_MS) }

  const tz  = gym.timezone || DEFAULT_GYM_TIME_ZONE
  const now = zonedParts(at, tz)
  let { year, month, day } = now
  if (now.minutes >= (lastEntry ? hours.lastEntry : hours.end)) {
    // Tomorrow's local date (noon UTC avoids DST edge cases)
    const t = zonedParts(new Date(Date.UTC(year, month - 1, day, 12) + DAY_MS), 'UTC')
    ;({ year, month, day } = t)
  }
  const opens  = zonedTime(year, month, day, hours.start, tz)
  const closes = zonedTime(year, month, day, hours.end, tz)
  return { startsAt: opens > at ? opens : at, endsAt: closes }
}

/** True when `at` is inside the gym's access hours (always true for 24/7 gyms). */
export function isWithinAccessHours(gym, at = new Date()) {
  const hours = accessHours(gym)
  if (!hours) return true
  const { minutes } = zonedParts(at, gym.timezone || DEFAULT_GYM_TIME_ZONE)
  return minutes >= hours.start && minutes < hours.end
}

/** 540 → "9am", 1290 → "9:30pm" */
function clockLabel(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60
  const h12 = h % 12 || 12
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`
}

/** "hydra athletic co" → "hydra" — the short name used in guest-facing hours copy. */
function shortGymName(gym) {
  return String(gym?.name ?? '').trim().split(/\s+/)[0]?.toLowerCase() || 'the gym'
}

/** "hydra's open 9am–9pm" — null for 24/7 gyms. */
function openHoursLabel(gym) {
  const hours = accessHours(gym)
  return hours ? `${shortGymName(gym)}'s open ${clockLabel(hours.start)}–${clockLabel(hours.end)}` : null
}

/**
 * Guest-facing note about when a code issued at `at` and ending at `endsAt`
 * works, or null for 24/7 gyms. Pass `deferredOnly` to get null when the code
 * works right away (the checkout page only warns about deferred windows).
 *
 * @param {object} gym
 * @param {{ at: Date, endsAt: Date }} window
 * @param {{ deferredOnly?: boolean }} [options]
 * @returns {string | null}
 */
export function accessNotice(gym, { at, endsAt }, { deferredOnly = false } = {}) {
  const hours = accessHours(gym)
  if (!hours) return null
  const tz      = gym.timezone || DEFAULT_GYM_TIME_ZONE
  const issued  = zonedParts(at, tz)
  const ends    = zonedParts(endsAt, tz)
  const sameDay = issued.year === ends.year && issued.month === ends.month && issued.day === ends.day
  const deferred = !sameDay || issued.minutes < hours.start
  const range   = `${clockLabel(hours.start)}–${clockLabel(hours.end)}`
  if (deferred) return `${openHoursLabel(gym)}. your code will work ${range} ${sameDay ? 'today' : 'tomorrow'}`
  return deferredOnly ? null : `${openHoursLabel(gym)}. your code works now until ${clockLabel(hours.end)} today`
}

/** Kiosk refusal outside hours: "hydra's open 9am–9pm. come back during open hours" */
export function closedMessage(gym) {
  return `${openHoursLabel(gym)}. come back during open hours`
}
