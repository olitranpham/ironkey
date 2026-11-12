// Overdue-balance copy, by who's reading it. Client-safe (no prisma/stripe) so
// the member portal and the staff screens share one source.
//   member — the member's own portal (and the API's 403 error text)
//   admin  — staff views of a member (members modal, dashboard profile)

/**
 * @param {{ viewer?: 'member'|'admin', amountDueFmt?: string|null }} [options]
 */
export function overdueMessage({ viewer = 'member', amountDueFmt = null } = {}) {
  if (viewer === 'admin') {
    const balance = amountDueFmt ? `an overdue balance of ${amountDueFmt}` : 'an overdue balance'
    return `this member has ${balance}. please contact them to resolve it before freezing or canceling their membership.`
  }
  return 'you have an overdue balance. pay it to freeze or cancel your membership.'
}
