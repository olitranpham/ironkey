import prisma from '@/lib/prisma'

// Members in these statuses are NOT leads.
export const MEMBER_STATUSES_NOT_LEADS = ['ACTIVE', 'FROZEN', 'OVERDUE']
export const LEAD_STATUSES = ['new', 'contacted', 'converted']

// Uses granted by a pack, for the historical visit estimate
const PACK_SIZE = { SINGLE: 1, THREE_PACK: 3, FIVE_PACK: 5, TEN_PACK: 10, VALUE: 5, DELUXE: 10 }

const minDate = ds => ds.filter(Boolean).reduce((a, d) => (!a || d < a ? d : a), null)
const maxDate = ds => ds.filter(Boolean).reduce((a, d) => (!a || d > a ? d : a), null)

/**
 * Visits for one pass.
 *  - Passes created before check-in tracking started at this gym: estimate =
 *    pack size − passesLeft (the purchase and every check-in each used one).
 *  - Passes created after: 1 (the purchase-day use) + GuestCheckIn rows.
 */
function visitsForPass(pass, trackingStart) {
  const legacy = !trackingStart || pass.createdAt < trackingStart
  if (legacy) {
    const size = PACK_SIZE[pass.passType] ?? 1
    return Math.max(0, size - (pass.passesLeft ?? 0))
  }
  return 1 + pass._count.checkIns
}

/**
 * Leads for a gym: guest profiles with at least one pass at this gym whose
 * email doesn't match an ACTIVE/FROZEN/OVERDUE member here. Profiles whose
 * Lead row is already "converted" stay listed (they'd otherwise vanish the
 * moment they join). Profiles without an email are listed but can't be sent.
 *
 * @param {string} gymId
 * @returns {Promise<object[]>} sorted by last visit, newest first
 */
export async function listLeads(gymId) {
  const [members, guests, firstCheckIn] = await Promise.all([
    prisma.member.findMany({
      where:  { gymId, status: { in: MEMBER_STATUSES_NOT_LEADS } },
      select: { email: true },
    }),
    prisma.guest.findMany({
      where:  { passes: { some: { gymId } } },
      select: {
        id: true, name: true, email: true, phone: true,
        passes: {
          where:  { gymId },
          select: {
            id: true, passType: true, passesLeft: true, amountPaid: true, createdAt: true, usedAt: true,
            _count: { select: { checkIns: true } },
            checkIns: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        leads: { where: { gymId }, select: { status: true, contactedAt: true, convertedAt: true, notes: true } },
      },
    }),
    // Check-in tracking start at this gym = its first GuestCheckIn row
    prisma.guestCheckIn.findFirst({ where: { gymId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ])

  const memberEmails = new Set(members.map(m => (m.email ?? '').trim().toLowerCase()).filter(Boolean))
  const trackingStart = firstCheckIn?.createdAt ?? null

  return guests
    .map(g => {
      const lead      = g.leads[0] ?? null
      const status    = lead?.status ?? 'new'
      const email     = g.email?.trim().toLowerCase() || null
      const isMember  = email ? memberEmails.has(email) : false
      if (isMember && status !== 'converted') return null

      const paid      = g.passes.map(p => p.amountPaid).filter(a => a != null)
      return {
        guestProfileId: g.id,
        name:           g.name,
        email,
        phone:          g.phone ?? null,
        firstVisit:     minDate(g.passes.map(p => p.createdAt)),
        lastVisit:      maxDate(g.passes.flatMap(p => [p.createdAt, p.usedAt, p.checkIns[0]?.createdAt])),
        visitCount:     g.passes.reduce((n, p) => n + visitsForPass(p, trackingStart), 0),
        passesBought:   g.passes.length,
        // cents; null ("—") when every pass predates amountPaid tracking
        totalSpent:     paid.length ? paid.reduce((a, b) => a + b, 0) : null,
        status,
        contactedAt:    lead?.contactedAt ?? null,
        convertedAt:    lead?.convertedAt ?? null,
        notes:          lead?.notes ?? null,
        canSend:        Boolean(email),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.lastVisit?.getTime() ?? 0) - (a.lastVisit?.getTime() ?? 0))
}

/**
 * The guest profile, if it has at least one pass at this gym (the auth
 * boundary for acting on a lead from this gym's portal).
 */
export async function findGymLeadProfile(gymId, guestProfileId) {
  return prisma.guest.findFirst({
    where:  { id: guestProfileId, passes: { some: { gymId } } },
    select: { id: true, name: true, email: true, phone: true },
  })
}
