'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import { overdueMessage } from '@/lib/overdueMessage'
import { requestError } from '@/lib/requestError'

// Freeze / resume / cancel / reverse-cancel / remove for one member — the
// single flow every staff page uses through MemberDrawer. Each action is
// confirmed in-app; a 403 { overdue } from freeze/cancel switches the dialog
// to the overdue step, where OWNER/ADMIN (canOverride) can retry with
// override: true. The routes do the real checks and the audit entries.

export const ACTION_COPY = {
  freeze: {
    title:   'freeze membership?',
    bullets: [
      'access will be removed immediately',
      'maximum freeze duration is 6 months',
      'you can resume the membership at any time',
    ],
    cta:         'yes, freeze',
    ctaCls:      'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20',
    overrideCta: 'freeze anyway',
  },
  cancel: {
    title:   'cancel membership?',
    bullets: [
      'the member stays active until their billing period ends',
      'their door access is preserved until stripe confirms cancellation',
      'a cancellation scheduled event will be logged today',
    ],
    cta:         'yes, cancel',
    ctaCls:      'bg-red-500/10 text-red-400 hover:bg-red-500/20',
    overrideCta: 'cancel membership anyway',
  },
  resume: {
    title:   'resume membership?',
    bullets: [
      'the member will regain immediate access',
      'their membership will return to active status',
    ],
    cta:    'yes, resume',
    ctaCls: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  },
  'reverse-cancel': {
    title:   'reverse cancellation?',
    bullets: [
      'only works if their billing period hasn’t ended yet',
      'their membership stays active on its normal schedule',
      'their door code is reissued only if it was already revoked — otherwise it’s untouched',
    ],
    cta:    'yes, reverse cancellation',
    ctaCls: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  },
  remove: {
    title:   'remove member?',
    bullets: [
      'their record will be permanently deleted',
      'their door code will be removed from the lock',
      'this action cannot be undone',
    ],
    cta:    'yes, remove',
    ctaCls: 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
  },
}

/**
 * @param {{ gymSlug: string, onUpdated?: (member: object) => void, onRemoved?: (memberId: string) => void }} options
 * @returns {{ start: (action: string, member: object) => void, dialog: JSX.Element|null, busy: boolean, notice: string|null, clearNotice: () => void }}
 */
export function useMemberActions({ gymSlug, onUpdated, onRemoved }) {
  const [pending, setPending] = useState(null)   // { action, member, stage: 'confirm'|'overdue', amountDueFmt, canOverride }
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState(null)
  const [notice,  setNotice]  = useState(null)   // success text (reverse-cancel door code result)

  function start(action, member) {
    if (!ACTION_COPY[action]) return
    setError(null)
    setNotice(null)
    setPending({ action, member, stage: 'confirm' })
  }

  function close() {
    if (busy) return
    setPending(null)
    setError(null)
  }

  async function run({ override = false } = {}) {
    const { action, member } = pending
    setBusy(true)
    setError(null)
    try {
      const token = localStorage.getItem('ik_token')

      if (action === 'remove') {
        const res = await fetch(`/api/${gymSlug}/members/${member.id}`, {
          method:  'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(requestError(res, await res.json().catch(() => ({}))))
        setPending(null)
        onRemoved?.(member.id)
        return
      }

      const res  = await fetch(`/api/${gymSlug}/${action}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ memberId: member.id, ...(override ? { override: true } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      // Overdue → blocked; OWNER/ADMIN may explicitly override (audited)
      if (res.status === 403 && json.overdue) {
        setPending({ action, member, stage: 'overdue', amountDueFmt: json.amountDueFmt, canOverride: Boolean(json.canOverride) })
        return
      }
      if (!res.ok) throw new Error(requestError(res, json))
      if (json.member) onUpdated?.(json.member)
      if (json.error === 'stripe_dashboard_sub') {
        setError(json.message)   // keep the dialog open so the owner sees why
        return
      }
      setPending(null)
      if (action === 'reverse-cancel') {
        setNotice(json.codeReissued
          ? `cancellation reversed — their old code was revoked, new code: ${json.accessCode}`
          : 'cancellation reversed — their existing door code is unaffected')
      }
    } catch (err) {
      setError(err.message || 'something went wrong — please try again')
    } finally {
      setBusy(false)
    }
  }

  let dialog = null
  if (pending && typeof document !== 'undefined') {
    const copy    = ACTION_COPY[pending.action]
    const overdue = pending.stage === 'overdue'
    const name    = `${pending.member.firstName ?? ''} ${pending.member.lastName ?? ''}`.trim()
    dialog = createPortal(
      <ConfirmModal
        title={overdue ? 'overdue balance' : copy.title}
        subtitle={name || null}
        error={error}
        loading={busy}
        confirmLabel={overdue ? copy.overrideCta : copy.cta}
        confirmClassName={overdue ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : copy.ctaCls}
        onConfirm={overdue && !pending.canOverride ? undefined : () => run({ override: overdue })}
        onClose={close}
      >
        {overdue ? (
          <p className="text-amber-300">{overdueMessage({ viewer: 'admin', amountDueFmt: pending.amountDueFmt })}</p>
        ) : (
          <ul className="space-y-1.5">
            {copy.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-600 shrink-0" />
                {b}
              </li>
            ))}
          </ul>
        )}
      </ConfirmModal>,
      document.body,
    )
  }

  return { start, dialog, busy, notice, clearNotice: () => setNotice(null) }
}
