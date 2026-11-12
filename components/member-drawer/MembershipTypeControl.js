'use client'

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Loader2 } from 'lucide-react'
import { DrawerField } from '@/components/DrawerParts'
import { formatMembershipTypeDisplay } from '@/lib/membershipCategory'
import { money, INPUT_CLS, SAVE_CLS } from '@/components/member-drawer/fields'

// ── Change membership (Stripe-backed; requires billing.act) ───────────────────
const per = o => (o?.interval ? `/${o.intervalCount > 1 ? `${o.intervalCount} ` : ''}${o.interval}` : '')

// `allowed` — the viewer has billing.act (MemberDrawer reads it from /me once).
// `onSaveType(type)` — saves a free-text type; used for subscriptions created
// outside Ironkey, whose plan can't be changed here (staff mirror Stripe).
export default function MembershipTypeControl({ member, gymSlug, allowed, onPlanChanged, onSaveType }) {
  const [typeInput,  setTypeInput]  = useState(member.membershipType ?? '')
  const [savingType, setSavingType] = useState(false)
  const [plan,    setPlan]    = useState(null)      // GET .../plan result
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)     // dropdown under the value
  const [choice,  setChoice]  = useState(null)      // option chosen → confirm step
  const [saving,  setSaving]  = useState(false)
  const [message, setMessage] = useState(null)      // confirm-step error, or success text
  const [done,    setDone]    = useState(false)
  const [reload,  setReload]  = useState(0)
  const wrapRef    = useRef(null)   // the type value (trigger) — menu anchors to it
  const menuRef    = useRef(null)   // the portaled menu
  const [menuPos, setMenuPos] = useState(null)   // fixed-position style for the menu
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('ik_token')}` })
  const typeLabel = formatMembershipTypeDisplay(member.membershipType) || '—'

  // Reset when a different member is shown
  useEffect(() => { setOpen(false); setChoice(null); setMessage(null); setDone(false) }, [member.id])
  useEffect(() => { setTypeInput(member.membershipType ?? '') }, [member.id, member.membershipType])

  // Eligibility: one read-only subscription check per opened member
  useEffect(() => {
    setPlan(null)
    if (!allowed || member.status === 'CANCELED') return
    let cancelled = false
    setLoading(true)
    fetch(`/api/${gymSlug}/members/${member.id}/plan`, { headers: auth() })
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (!cancelled) setPlan(json) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [allowed, gymSlug, member.id, member.status, reload])

  // Close the dropdown on outside click / Escape (the menu lives in a portal,
  // so "inside" means the trigger OR the menu)
  useEffect(() => {
    if (!open) return
    const onDown = e => {
      if (wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey  = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  // Position the portaled menu (fixed, right-aligned, 4px from the value).
  // Opens upward when there isn't room below; height is capped to the space
  // available so it scrolls instead of leaving the viewport.
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return }
    const GAP = 4, MARGIN = 8
    function place() {
      const anchor = wrapRef.current?.getBoundingClientRect()
      if (!anchor) return
      const menuH = menuRef.current?.scrollHeight ?? 0
      const below = window.innerHeight - anchor.bottom - GAP - MARGIN
      const above = anchor.top - GAP - MARGIN
      const up    = menuH > below && above > below
      setMenuPos({
        position:  'fixed',
        right:     Math.max(MARGIN, window.innerWidth - anchor.right),
        ...(up ? { bottom: window.innerHeight - anchor.top + GAP } : { top: anchor.bottom + GAP }),
        maxHeight: Math.max(80, up ? above : below),
      })
    }
    place()
    // capture: true also catches scrolling inside the drawer's own scroll container
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open, plan])

  const external    = plan?.canChange === false && plan.reason === 'external_subscription'
  const interactive = allowed && member.status !== 'CANCELED' && (plan?.canChange || external)

  async function save() {
    setSaving(true); setMessage(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/members/${member.id}/plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ priceId: choice.priceId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'stripe rejected the change')   // e.g. the Stripe error message
      onPlanChanged?.(json.member)
      setChoice(null)
      setMessage(json.warning || 'membership changed. the new price starts at the next renewal.')
      setDone(true)
      setReload(n => n + 1)   // refresh options for the new current plan
    } catch (err) {
      setMessage(err.message)
    } finally {
      setSaving(false)
    }
  }

  const when = plan?.effectiveAt ? new Date(plan.effectiveAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase() : 'the next renewal'
  const btn  = 'text-[11px] px-2.5 py-1 rounded-md border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 disabled:opacity-40 transition-colors'

  // Subscription created outside Ironkey: free-text type, edited to match Stripe
  if (external && onSaveType && member.status !== 'CANCELED') {
    return (
      <>
        <DrawerField label="type">
          <div className="flex items-center gap-2 ml-4">
            <input type="text" value={typeInput} onChange={e => setTypeInput(e.target.value)} className={`${INPUT_CLS} w-36 truncate`} />
            <button
              onClick={async () => { setSavingType(true); await onSaveType(typeInput.trim()); setSavingType(false) }}
              disabled={savingType || typeInput.trim() === (member.membershipType ?? '')}
              className={SAVE_CLS}
            >
              {savingType ? '…' : 'save'}
            </button>
          </div>
        </DrawerField>
        <p className="px-3 py-2 bg-[#1c1c1c] text-[11px] text-neutral-500">this subscription was created outside ironkey — change the plan in stripe, then update the type here to match.</p>
      </>
    )
  }

  return (
    <>
      <DrawerField label="type">
        <div ref={wrapRef} className="relative ml-4 flex justify-end min-w-0">
          {interactive ? (
            <button
              type="button"
              onClick={() => { setOpen(o => !o); setDone(false); setMessage(null) }}
              className="inline-flex items-center gap-1 text-xs text-white text-right truncate max-w-[240px] hover:text-zinc-200 transition-colors"
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              <span className="truncate">{typeLabel}</span>
              <ChevronDown size={12} className={`shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-white text-right truncate max-w-[240px]">
              <span className="truncate">{typeLabel}</span>
              {loading && <Loader2 size={12} className="shrink-0 text-zinc-500 animate-spin" />}
            </span>
          )}

        </div>
      </DrawerField>

      {/* Portaled so the section card's overflow-hidden / rounded corners can't clip it */}
      {open && interactive && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={menuPos ?? { position: 'fixed', top: -9999, right: 0, visibility: 'hidden' }}
          className="z-[60] min-w-[220px] max-w-[280px] overflow-y-auto rounded-lg border border-neutral-700 bg-[#252525] shadow-xl py-1"
        >
          {external ? (
            <p className="px-3 py-2 text-[11px] text-amber-400">{plan.message}</p>
          ) : (
            plan.options.map(o => (
              <button
                key={o.priceId}
                type="button"
                role="option"
                onClick={() => { setChoice(o); setOpen(false); setMessage(null) }}
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-white/5"
              >
                <span className="truncate">{(o.name ?? '').toLowerCase()}</span>
                <span className="shrink-0 text-zinc-500">{money(o.amount, o.currency)}{per(o)}</span>
              </button>
            ))
          )}
        </div>,
        document.body,
      )}

      {choice && plan?.canChange && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3 space-y-2 mt-1">
          <p className="text-xs text-neutral-300">
            {(plan.current.name ?? member.membershipType ?? '').toLowerCase()} {money(plan.current.amount, plan.current.currency)}{per(plan.current)}
            {' → '}
            <span className="text-white font-semibold">{(choice.name ?? '').toLowerCase()} {money(choice.amount, choice.currency)}{per(choice)}</span>
          </p>
          <p className="text-[11px] text-neutral-500">
            takes effect at the next renewal ({when}). no proration, nothing is charged now.
            {plan.paused ? ' billing stays paused while the member is frozen.' : ''}
          </p>
          {message && <p className="text-[11px] text-red-400">{message}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving} className={btn}>{saving ? 'changing…' : 'confirm change'}</button>
            <button type="button" onClick={() => { setChoice(null); setMessage(null) }} disabled={saving} className="text-[11px] text-neutral-500 hover:text-neutral-300">cancel</button>
          </div>
        </div>
      )}
      {done && message && <p className="text-[11px] text-emerald-400 mt-1">{message}</p>}
    </>
  )
}
