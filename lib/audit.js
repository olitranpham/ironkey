import prisma from '@/lib/prisma'

/**
 * Record an AuditLog row without blocking the request. Failures are logged,
 * never thrown. Never put secrets, API keys or full door PINs in `meta`.
 *
 * @param {{ gym: { id: string }, user?: { id: string } | null, impersonatedBy?: string | null }} ctx —
 *   the request's gym context (or an equivalent { gym, user } built by hand,
 *   e.g. in the Stripe OAuth callback). ctx.impersonatedBy is copied into meta.
 * @param {string} action      — e.g. 'member.freeze'
 * @param {string} targetType  — e.g. 'Member'
 * @param {string | null} [targetId]
 * @param {object | null} [meta]
 */
export function writeAudit(ctx, action, targetType, targetId = null, meta = null) {
  const fullMeta = ctx.impersonatedBy ? { ...(meta ?? {}), impersonatedBy: ctx.impersonatedBy } : meta

  prisma.auditLog
    .create({
      data: {
        gymId:   ctx.gym.id,
        actorId: ctx.user?.id ?? null,
        action,
        targetType,
        targetId: targetId ?? null,
        ...(fullMeta ? { meta: fullMeta } : {}),
      },
    })
    .catch(err => console.error('[audit] write failed: action=%s error=%s', action, err.message))
}
