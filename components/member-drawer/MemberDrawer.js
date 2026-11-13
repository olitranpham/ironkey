'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { useMemberActions } from '@/components/MemberActions'
import { requestError } from '@/lib/requestError'
import OverviewTab from '@/components/member-drawer/OverviewTab'
import AccessTab from '@/components/member-drawer/AccessTab'
import PaymentsTab from '@/components/member-drawer/PaymentsTab'
import { fmtDate } from '@/components/member-drawer/fields'

// Tabs and the permission each needs. A tab the viewer can't use is hidden
// entirely; with only overview left, so is the tab bar.
const TABS = [
  { key: 'overview', label: 'overview', perm: null },
  { key: 'access',   label: 'access',   perm: 'door.view' },
  { key: 'payments', label: 'payments', perm: 'members.edit' },
]

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('ik_token')}` })

// One /me and one /gym request per gym per page load, shared by every drawer open
const meCache  = new Map()
const gymCache = new Map()
function cached(cache, key, load) {
  if (!cache.has(key)) cache.set(key, load().catch(err => { cache.delete(key); throw err }))
  return cache.get(key)
}

// Days remaining until cancelEffectiveDate — null when there's no date to
// count down from (e.g. no Stripe subscription was linked at cancel time).
function daysUntilCancel(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

// A member is still reversible while cancelEffectiveDate hasn't passed yet —
// or indefinitely if there's no date to compare against.
function cancelWindowOpen(member) {
  if (!member.cancelEffectiveDate) return true
  return new Date(member.cancelEffectiveDate).getTime() > Date.now()
}

/**
 * The one member profile drawer for every staff page.
 *
 * @param {{
 *   gymSlug: string,
 *   memberId: string|null,          // null → closed
 *   initialTab?: 'overview'|'access'|'payments',
 *   seed?: object,                  // the page's list row (has list-only fields, e.g. flexCheckInsThisMonth)
 *   onClose: () => void,
 *   onTabChange?: (tab: string) => void,
 *   onMemberUpdated?: (member: object) => void,
 *   onMemberRemoved?: (memberId: string) => void,
 *   onDeleteCode?: () => Promise<void>,
 * }} props
 */
export default function MemberDrawer({ gymSlug, memberId, initialTab = 'overview', seed, onClose, onTabChange, onMemberUpdated, onMemberRemoved, onDeleteCode }) {
  const open = Boolean(memberId)
  const [member, setMember]   = useState(null)
  const [perms, setPerms]     = useState(null)    // Set of the viewer's permissions
  const [accessProvider, setAccessProvider] = useState('SEAM')
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [tab, setTab] = useState(initialTab)
  const shownId = useRef(null)

  // Keep the last member on screen while the drawer fades out. A list row
  // that arrives after the full record only fills in fields it's missing.
  useEffect(() => {
    if (!memberId) return
    if (shownId.current !== memberId) {
      shownId.current = memberId
      setMember(seed ? { ...seed } : null)
      setLoadError(null)
      setSaveError(null)
    } else if (seed) {
      setMember(prev => ({ ...seed, ...(prev ?? {}) }))
    }
  }, [memberId, seed])

  useEffect(() => { if (open) setTab(initialTab) }, [open, initialTab])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!gymSlug) return
    cached(meCache, gymSlug, () => fetch(`/api/${gymSlug}/me`, { headers: auth() }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))))
      .then(me => setPerms(new Set(me?.permissions ?? [])))
      .catch(() => setPerms(new Set()))
    cached(gymCache, gymSlug, () => fetch(`/api/${gymSlug}/gym`, { headers: auth() }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))))
      .then(data => setAccessProvider(data?.gym?.accessProvider ?? 'SEAM'))
      .catch(() => setAccessProvider('SEAM'))
  }, [gymSlug])

  // The full record (student id photo, agreement, trainer, Kisi ids) on top of the list row
  useEffect(() => {
    if (!memberId || !gymSlug) return
    let cancelled = false
    fetch(`/api/${gymSlug}/members/${memberId}`, { headers: auth() })
      .then(async r => {
        const json = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(requestError(r, json))
        return json
      })
      .then(json => { if (!cancelled) setMember(prev => ({ ...(prev ?? {}), ...json.member, gymName: json.gymName ?? null, loadedFull: true })) })
      .catch(err => { if (!cancelled) setLoadError(err.message) })
    return () => { cancelled = true }
  }, [memberId, gymSlug])

  const applyUpdate = useCallback(updated => {
    setMember(prev => (prev?.id === updated.id ? { ...prev, ...updated } : prev))
    onMemberUpdated?.(updated)
  }, [onMemberUpdated])

  // PATCH the member; returns { error } so a row can show it inline
  const save = useCallback(async fields => {
    setSaveError(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/members/${member.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body:    JSON.stringify(fields),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(requestError(res, json))
      if (json.member) applyUpdate(json.member)
      return {}
    } catch (err) {
      const message = err.message || 'could not save changes'
      if (!('accessCode' in fields)) setSaveError(message)   // the PIN row shows its own error
      return { error: message }
    }
  }, [gymSlug, member?.id, applyUpdate])

  const actions = useMemberActions({
    gymSlug,
    onUpdated: applyUpdate,
    onRemoved: id => { onMemberRemoved?.(id); onClose() },
  })

  const visibleTabs = perms ? TABS.filter(t => !t.perm || perms.has(t.perm)) : TABS.slice(0, 1)
  const activeTab   = visibleTabs.some(t => t.key === tab) ? tab : 'overview'
  function selectTab(key) {
    setTab(key)
    onTabChange?.(key)
  }

  const can = p => Boolean(perms?.has(p))
  const initials = member ? (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '') : ''

  return (
    <>
    <div
      className={`fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[500px] flex flex-col bg-[#171717] rounded-2xl shadow-2xl overflow-hidden"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {member && (
          <div className="flex flex-col flex-1 min-h-0">

            {/* Header */}
            <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
              <p className="text-sm font-semibold text-white">member profile</p>
              <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors">
                <X size={15} />
              </button>
            </div>

            {/* Tabs — hidden when overview is the only one */}
            {visibleTabs.length > 1 && (
              <div className="flex gap-1 px-5 pt-3 shrink-0 border-b border-neutral-800">
                {visibleTabs.map(t => (
                  <button
                    key={t.key}
                    onClick={() => selectTab(t.key)}
                    className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === t.key ? 'border-white text-white' : 'border-transparent text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ WebkitOverflowScrolling: 'touch' }}>

              {/* Avatar + name + cancellation */}
              <div className="flex flex-col items-center text-center gap-2 pt-1 pb-2">
                <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
                  <span className="text-black font-bold text-lg tracking-tight select-none">{initials || '?'}</span>
                </div>
                <p className="text-white font-semibold text-base leading-tight">{member.firstName} {member.lastName}</p>
                {member.cancelScheduled && (
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      cancellation scheduled{member.cancelEffectiveDate ? ` — ${fmtDate(member.cancelEffectiveDate)}` : ''}
                    </span>
                    {member.cancelEffectiveDate && (() => {
                      const days = daysUntilCancel(member.cancelEffectiveDate)
                      return (
                        <span className="text-[10px] text-neutral-500">
                          {days <= 0 ? 'cancellation takes effect today' : `${days} day${days === 1 ? '' : 's'} until cancellation`}
                        </span>
                      )
                    })()}
                  </div>
                )}
              </div>

              {loadError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{loadError}</p>}
              {saveError && (
                <div className="flex items-center justify-between gap-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <span>{saveError}</span>
                  <button onClick={() => setSaveError(null)} className="text-red-400/70 hover:text-red-400 shrink-0">dismiss</button>
                </div>
              )}
              {actions.notice && (
                <div className="flex items-center justify-between gap-3 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  <span>{actions.notice}</span>
                  <button onClick={actions.clearNotice} className="text-emerald-400/70 hover:text-emerald-400 shrink-0">dismiss</button>
                </div>
              )}

              {activeTab === 'overview' && (
                <OverviewTab member={member} gymSlug={gymSlug} perms={perms ?? new Set()} save={can('members.edit') ? save : undefined} onPlanChanged={applyUpdate} />
              )}
              {activeTab === 'access' && (
                <AccessTab
                  member={member}
                  gymSlug={gymSlug}
                  accessProvider={accessProvider}
                  save={can('members.edit') ? save : undefined}
                  onDeleteCode={accessProvider === 'KISI' ? undefined : onDeleteCode}
                />
              )}
              {activeTab === 'payments' && (
                <PaymentsTab member={member} gymSlug={gymSlug} perms={perms ?? new Set()} save={save} />
              )}
            </div>

            {/* Membership actions — overview tab, each button gated by its permission */}
            {activeTab === 'overview' && <ActionButtons member={member} can={can} busy={actions.busy} start={actions.start} />}
          </div>
        )}
      </div>
    </div>
    {/* Outside the overlay: portal events still bubble through React, and the overlay closes on click */}
    {actions.dialog}
    </>
  )
}

function ActionButtons({ member, can, busy, start }) {
  const live      = member.status === 'ACTIVE' || member.status === 'OVERDUE'
  const freeze    = can('members.freeze') && live
  const cancel    = can('members.cancel') && live && !member.cancelScheduled
  const resume    = can('members.freeze') && member.status === 'FROZEN'
  // FROZEN members never get reverse-cancel — freezing and canceling are
  // separate, non-overlapping states. Only ACTIVE/OVERDUE members with an
  // open cancellation window qualify.
  const reverse   = can('members.cancel') && member.status !== 'FROZEN' && member.cancelScheduled && cancelWindowOpen(member)
  const remove    = can('members.delete')
  if (!(freeze || cancel || resume || reverse || remove)) return null

  const btn = 'w-full py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors'
  return (
    <div className="shrink-0 px-5 py-4 border-t border-neutral-800 space-y-2">
      {freeze  && <button onClick={() => start('freeze', member)} disabled={busy} className={`${btn} bg-sky-500/10 text-sky-400 hover:bg-sky-500/20`}>freeze membership</button>}
      {cancel  && <button onClick={() => start('cancel', member)} disabled={busy} className={`${btn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>cancel membership</button>}
      {resume  && <button onClick={() => start('resume', member)} disabled={busy} className={`${btn} bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20`}>resume membership</button>}
      {reverse && <button onClick={() => start('reverse-cancel', member)} disabled={busy} className={`${btn} bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20`}>reverse cancellation</button>}
      {remove  && <button onClick={() => start('remove', member)} disabled={busy} className={`${btn} bg-neutral-500/10 text-neutral-400 hover:bg-neutral-500/20`}>remove member</button>}
    </div>
  )
}
