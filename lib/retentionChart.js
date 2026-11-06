// Membership retention chart data (dashboard).
//
// One point per month from the earliest member's createdAt to the current
// month. Each point is keyed by 'YYYY-MM': the chart's x-axis is categorical,
// so month-name-only keys ('jan') made two Januaries (a gym with members
// from more than a year back, e.g. Oasis from jan 2025) indistinguishable.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Axis tick for a 'YYYY-MM' key: the month, with the year on january ("jan '26"). */
export function retentionTick(key) {
  const [y, m] = String(key).split('-').map(Number)
  if (!y || !m) return ''
  return m === 1 ? `jan '${String(y).slice(-2)}` : MONTHS[m - 1]
}

// Each member enters the cohort from their createdAt date. For each month we
// then check whether they had been cancelled or frozen BY that month's end,
// so a member who joined in Jan and cancelled in Apr shows as active in Jan–Mar
// and cancelled from Apr onwards — rather than only appearing after cancellation.
export function buildRetentionData(members, now = new Date()) {
  if (!members.length) return []

  const earliest = members.reduce((min, m) => {
    const d = new Date(m.createdAt)
    return d < min ? d : min
  }, new Date(members[0].createdAt))

  // Start at the 1st of the earliest member's month
  const startYear   = earliest.getFullYear()
  const startMonth  = earliest.getMonth()
  const totalMonths = (now.getFullYear() - startYear) * 12 + (now.getMonth() - startMonth) + 1

  return Array.from({ length: totalMonths }, (_, i) => {
    const d          = new Date(startYear, startMonth + i, 1)
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)

    let active = 0, frozen = 0, canceled = 0

    for (const m of members) {
      if (new Date(m.createdAt) > endOfMonth) continue  // hadn't joined yet

      // For canceled members without a dateCanceled, fall back to createdAt so
      // they still register in the canceled bucket rather than the active bucket.
      const effectiveCancelDate = m.status === 'CANCELED'
        ? new Date(m.dateCanceled ?? m.createdAt)
        : null
      const canceledByThen = effectiveCancelDate && effectiveCancelDate <= endOfMonth
      // For frozen members without a dateFrozen, fall back to createdAt.
      // Only treat as frozen-by-then if the member is still frozen today;
      // if they've since re-activated we don't have an unfreeze date to go on.
      const effectiveFreezeDate = m.status === 'FROZEN'
        ? new Date(m.dateFrozen ?? m.createdAt)
        : null
      const frozenByThen = effectiveFreezeDate && effectiveFreezeDate <= endOfMonth

      if (canceledByThen)    canceled++
      else if (frozenByThen) frozen++
      else                   active++
    }

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return {
      key,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      month: MONTHS[d.getMonth()],
      active,
      frozen,
      canceled,
    }
  })
}
