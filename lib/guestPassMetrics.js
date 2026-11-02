import { monthKey, DEFAULT_GYM_TIME_ZONE } from './etMonth.js'
import { packSizeForPass } from './gymPassTypes.js'

// GuestCheckIn rows exist only from this day (gym-local) on — commit 24372d8
// added them. Usage before it was never recorded, so "passes used" for any
// month that starts earlier is unknown, not zero.
export const GUEST_CHECKIN_LOGGING_STARTED = '2026-10-30'

const emptyMetrics = () => ({
  purchases:     0,   // GuestPass rows
  passesSold:    0,   // sum of pack sizes
  paid:          0,   // amountPaid > 0
  promo:         0,   // amountPaid === 0 (100% promo code)
  unknownAmount: 0,   // amountPaid not recorded (older passes)
  revenueCents:  0,   // sum of amountPaid
  passesUsed:    0,   // GuestCheckIn rows; null when not tracked for the whole period
})

/**
 * Guest pass metrics per purchase month ('YYYY-MM', gym-local) plus `all`.
 *
 * @param {{ createdAt: Date|string, passType: string, packSize: number|null, amountPaid: number|null }[]} passes
 * @param {{ createdAt: Date|string }[]} checkIns
 * @param {string} [timeZone]
 * @returns {Record<string, ReturnType<typeof emptyMetrics>>}
 */
export function guestPassMetrics(passes, checkIns, timeZone = DEFAULT_GYM_TIME_ZONE) {
  const byMonth = { all: emptyMetrics() }
  const bucket  = key => (byMonth[key] ??= emptyMetrics())

  for (const pass of passes) {
    const key = monthKey(pass.createdAt, timeZone)
    for (const m of key ? [bucket(key), byMonth.all] : [byMonth.all]) {
      m.purchases  += 1
      m.passesSold += packSizeForPass(pass)
      if (pass.amountPaid == null) m.unknownAmount += 1
      else {
        m.revenueCents += pass.amountPaid
        if (pass.amountPaid > 0) m.paid += 1
        else                     m.promo += 1
      }
    }
  }
  for (const checkIn of checkIns) {
    const key = monthKey(checkIn.createdAt, timeZone)
    if (key) bucket(key).passesUsed += 1
    byMonth.all.passesUsed += 1
  }

  // A month (or all time) that starts before logging began has no usage data
  const earliest = Object.keys(byMonth).filter(k => k !== 'all').sort()[0]
  for (const [key, m] of Object.entries(byMonth)) {
    const start = key === 'all' ? (earliest ?? '9999-12') : key
    if (`${start}-01` < GUEST_CHECKIN_LOGGING_STARTED) m.passesUsed = null
  }
  return byMonth
}
