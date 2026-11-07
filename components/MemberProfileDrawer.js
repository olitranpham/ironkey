'use client'

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Phone, KeyRound, History, User, ShieldAlert, DoorOpen, UserCheck, ChevronDown, Loader2 } from 'lucide-react'
import { formatPhone } from '@/lib/phone'
import { fillSuggestedPin } from '@/lib/suggestPin'
import { formatMembershipTypeDisplay } from '@/lib/membershipCategory'
import { AgreementSection } from '@/components/AgreementSection'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TEXT = {
  ACTIVE:    'text-emerald-500',
  FROZEN:    'text-blue-400',
  CANCELED: 'text-zinc-500',
  OVERDUE:   'text-red-400',
}

// Price ID(s) for Hydra's bundled Student/Military/Police/EMT membership
// product (currently "student membership" — renamed from its original name,
// hence matching by ID rather than name so future renames can't break this).
const HYDRA_STUDENT_MILITARY_EMT_PRICE_IDS = new Set(['price_1TctZyAHpnGUkbkCdCs8HAL3'])

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_LABEL = {
  joined:                  'joined',
  reactivated:             'reactivated',
  frozen:                  'frozen',
  unfrozen:                'unfrozen',
  cancellation_scheduled:  'cancellation scheduled',
  cancellation_reversed:   'cancellation reversed',
  canceled:                'canceled',
}

function fmtStatus(status) {
  return status === 'CANCELED' ? 'canceled' : (status?.toLowerCase() ?? '—')
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
}

function fmtDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')
  return `${date} at ${time}`
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

// ── Shared sub-components ─────────────────────────────────────────────────────

export function DrawerSection({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={11} className="text-neutral-500" />
        <p className="text-[11px] font-semibold tracking-widest text-neutral-500">{title.toUpperCase()}</p>
      </div>
      <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

export function DrawerField({ label, value, mono = false, children }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-zinc-400 shrink-0">{label}</span>
      {children ?? (
        <span className={`text-xs text-white text-right ml-4 truncate max-w-[240px] ${mono ? 'font-mono text-[11px]' : ''}`}>
          {value || '—'}
        </span>
      )}
    </div>
  )
}

// Full-screen image preview — replaces opening the data: URL in a new tab,
// which Chrome blocks (renders a blank tab) for data: URIs.
function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,.85)' }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="close"
        className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
      >
        <X size={24} />
      </button>
      <img
        src={src}
        alt="student id"
        style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

// ── Drawer content ────────────────────────────────────────────────────────────

// ── Change membership (Stripe-backed; requires billing.act) ───────────────────
const money = (cents, currency = 'usd') =>
  cents == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
const per = o => (o?.interval ? `/${o.intervalCount > 1 ? `${o.intervalCount} ` : ''}${o.interval}` : '')

function MembershipTypeControl({ member, gymSlug, onPlanChanged }) {
  const [allowed, setAllowed] = useState(false)
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

  // Only users with billing.act get the control (no Stripe call here)
  useEffect(() => {
    fetch(`/api/${gymSlug}/me`, { headers: auth() })
      .then(r => (r.ok ? r.json() : null))
      .then(me => setAllowed(Boolean(me?.permissions?.includes('billing.act'))))
      .catch(() => setAllowed(false))
  }, [gymSlug])

  // Reset when a different member is shown
  useEffect(() => { setOpen(false); setChoice(null); setMessage(null); setDone(false) }, [member.id])

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

function DrawerContent({ member, gymSlug, membershipBorder, onClose, onStatusChange, onSaveAccessCode, onSaveField, onDeleteCode, onRemoveMember, onReverseCancel, onPlanChanged, updating, simplified }) {
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '')

  // Student graduation tracking — gated by gym + membershipType.
  // Triumph/Oasis have a standalone "Student" plan; Hydra bundles
  // Student/Military/EMT into one plan and needs a category picker first.
  const membershipTypeLower = (member.membershipType || '').toLowerCase()
  const isStandaloneStudentPlan = (gymSlug === 'triumph-barbell' || gymSlug === 'oasis-boston')
    && membershipTypeLower.includes('student')
  // Keyed off the price ID rather than the product/membershipType name — a
  // staff rename of this product (it was "Student/Military/Police/EMT
  // Membership", now "student membership") previously made this silently
  // stop matching. Add the new price ID here if Hydra ever adds another
  // tier to this same bundled product.
  const isHydraBundledPlan = gymSlug === 'hydra-athletic-co'
    && HYDRA_STUDENT_MILITARY_EMT_PRICE_IDS.has(member.priceId)
  const [codeInput,    setCodeInput]    = useState(member.accessCode ?? '')
  const [savingCode,   setSavingCode]   = useState(false)
  const [deletingCode, setDeletingCode] = useState(false)
  const [events,       setEvents]       = useState(null)  // null = loading, [] = loaded empty
  const [visits,       setVisits]       = useState(null)  // null = loading, [] = loaded empty

  const [nameInput,    setNameInput]    = useState(`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim())
  const [savingName,   setSavingName]   = useState(false)
  const [emailInput,   setEmailInput]   = useState(member.email ?? '')
  const [savingEmail,  setSavingEmail]  = useState(false)
  const [phoneInput,   setPhoneInput]   = useState(member.phone ?? '')
  const [savingPhone,  setSavingPhone]  = useState(false)

  const [dobInput,     setDobInput]     = useState(member.dateOfBirth ?? '')
  const [savingDob,    setSavingDob]    = useState(false)
  const [addressInput, setAddressInput] = useState(member.address ?? '')
  const [savingAddr,   setSavingAddr]   = useState(false)

  const [ecNameInput,  setEcNameInput]  = useState(member.emergencyContactName  ?? '')
  const [savingEcName, setSavingEcName] = useState(false)
  const [ecPhoneInput,   setEcPhoneInput]   = useState(member.emergencyContactPhone        ?? '')
  const [savingEcPhone,  setSavingEcPhone]  = useState(false)
  const [ecRelInput,     setEcRelInput]     = useState(member.emergencyContactRelationship ?? '')
  const [savingEcRel,    setSavingEcRel]    = useState(false)

  const isMinor = Boolean(member.isMinor || member.guardianName)
  const [guardianNameInput,  setGuardianNameInput]  = useState(member.guardianName  ?? '')
  const [savingGuardianName, setSavingGuardianName] = useState(false)
  const [guardianEmailInput,  setGuardianEmailInput]  = useState(member.guardianEmail  ?? '')
  const [savingGuardianEmail, setSavingGuardianEmail] = useState(false)
  const [guardianPhoneInput,  setGuardianPhoneInput]  = useState(member.guardianPhone  ?? '')
  const [savingGuardianPhone, setSavingGuardianPhone] = useState(false)
  const [guardianRelInput,    setGuardianRelInput]    = useState(member.guardianRelationship ?? '')
  const [savingGuardianRel,   setSavingGuardianRel]   = useState(false)

  const [gradSemesterInput, setGradSemesterInput] = useState(member.gradSemester ?? '')
  const [savingGradSemester, setSavingGradSemester] = useState(false)
  const [gradYearInput,     setGradYearInput]     = useState(member.gradYear != null ? String(member.gradYear) : '')
  const [savingGradYear,    setSavingGradYear]    = useState(false)
  const [studentCategoryInput, setStudentCategoryInput] = useState(member.studentCategory ?? '')
  const [savingCategory,       setSavingCategory]       = useState(false)

  // studentIdImage is deliberately left out of the /all list response (it's
  // a base64 photo, not something to ship in bulk to every list load), so it
  // isn't present on the `member` prop — fetch the single member record
  // (which does include it) whenever the drawer opens for someone new.
  const [studentIdImage,         setStudentIdImage]         = useState(null)
  const [studentIdLightboxOpen,  setStudentIdLightboxOpen]  = useState(false)
  // Assigned personal trainer, from the same single-member fetch (undefined = loading)
  const [assignedTrainer, setAssignedTrainer] = useState(undefined)
  // Signed agreement, from the same single-member fetch (undefined = loading)
  const [agreement, setAgreement] = useState(undefined)

  // Door-access provider — defaults to 'SEAM' so every existing gym renders
  // exactly as before while this resolves. Gym-level, not member-level, so
  // it's keyed only on gymSlug, not member.id.
  const [accessProvider, setAccessProvider] = useState('SEAM')
  const [resendingInvite, setResendingInvite] = useState(false)
  const [kisiStatus, setKisiStatus] = useState(null) // { kisiUserId, kisiRoleAssignmentId } | null while loading

  // Keep codeInput in sync when the member prop changes (different member opened,
  // or same member's accessCode updated by parent after a successful save).
  useEffect(() => {
    setNameInput(`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim())
    setEmailInput(member.email ?? '')
    setPhoneInput(member.phone ?? '')
    setCodeInput(member.accessCode ?? '')
    setDobInput(member.dateOfBirth ?? '')
    setAddressInput(member.address ?? '')
    setEcNameInput(member.emergencyContactName         ?? '')
    setEcPhoneInput(member.emergencyContactPhone        ?? '')
    setEcRelInput(member.emergencyContactRelationship  ?? '')
    setGuardianNameInput(member.guardianName ?? '')
    setGuardianEmailInput(member.guardianEmail ?? '')
    setGuardianPhoneInput(member.guardianPhone ?? '')
    setGuardianRelInput(member.guardianRelationship ?? '')
    setGradSemesterInput(member.gradSemester ?? '')
    setGradYearInput(member.gradYear != null ? String(member.gradYear) : '')
    setStudentCategoryInput(member.studentCategory ?? '')
  }, [member.id, member.firstName, member.lastName, member.email, member.phone,
      member.accessCode, member.dateOfBirth, member.address,
      member.emergencyContactName, member.emergencyContactPhone, member.emergencyContactRelationship,
      member.guardianName, member.guardianEmail, member.guardianPhone, member.guardianRelationship,
      member.gradSemester, member.gradYear, member.studentCategory])

  // Fetch membership history whenever the member changes (skip in simplified mode)
  useEffect(() => {
    if (simplified || !gymSlug || !member.id) return
    setEvents(null)
    const token = localStorage.getItem('ik_token')
    fetch(`/api/${gymSlug}/members/${member.id}/events`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async r => {
        if (!r.ok) {
          console.error('[MemberProfileDrawer] events fetch failed status=%d memberId=%s', r.status, member.id)
          return { events: [] }
        }
        return r.json()
      })
      .then(({ events }) => {
        console.log('[MemberProfileDrawer] events loaded memberId=%s count=%d', member.id, events?.length ?? 0)
        setEvents(events ?? [])
      })
      .catch(err => {
        console.error('[MemberProfileDrawer] events fetch threw memberId=%s', member.id, err)
        setEvents([])
      })
  }, [member.id, gymSlug, simplified])

  // Fetch the gym's door-access provider once per gym — toggles whether this
  // drawer shows a PIN editor (Seam) or a Kisi invite status/resend button.
  useEffect(() => {
    if (!gymSlug) return
    const token = localStorage.getItem('ik_token')
    fetch(`/api/${gymSlug}/gym`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => setAccessProvider(data?.gym?.accessProvider ?? 'SEAM'))
      .catch(() => setAccessProvider('SEAM'))
  }, [gymSlug])

  // Fetch the full member record for studentIdImage (and, for a Kisi gym,
  // invite status) whenever the member changes (skip in simplified mode) —
  // see note on the state above.
  useEffect(() => {
    if (simplified || !gymSlug || !member.id) return
    setStudentIdImage(null)
    setKisiStatus(null)
    setAssignedTrainer(undefined)
    setAgreement(undefined)
    const token = localStorage.getItem('ik_token')
    fetch(`/api/${gymSlug}/members/${member.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setStudentIdImage(data?.member?.studentIdImage ?? null)
        setAssignedTrainer(data?.member ? (data.member.assignedTrainer ?? null) : undefined)
        setAgreement(data?.member ? {
          signatureName: data.member.agreementSignatureName ?? null,
          signedAt:      data.member.agreementSignedAt ?? null,
          text:          data.member.agreementText ?? null,
          version:       data.member.agreementVersion ?? null,
          source:        data.member.agreementSource ?? null,
          gymName:       data.gymName ?? null,
        } : undefined)
        setKisiStatus({
          kisiUserId:           data?.member?.kisiUserId ?? null,
          kisiRoleAssignmentId: data?.member?.kisiRoleAssignmentId ?? null,
        })
      })
      .catch(err => {
        console.error('[MemberProfileDrawer] student id fetch threw memberId=%s', member.id, err)
        setStudentIdImage(null)
        setKisiStatus({ kisiUserId: null, kisiRoleAssignmentId: null })
      })
  }, [member.id, gymSlug, simplified])

  // Fetch door-entry visit history whenever the member changes (skip in simplified mode)
  useEffect(() => {
    if (simplified || !gymSlug || !member.id) return
    setVisits(null)
    const token = localStorage.getItem('ik_token')
    fetch(`/api/${gymSlug}/members/${member.id}/visits`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async r => {
        if (!r.ok) {
          console.error('[MemberProfileDrawer] visits fetch failed status=%d memberId=%s', r.status, member.id)
          return { visits: [] }
        }
        return r.json()
      })
      .then(({ visits }) => {
        setVisits(visits ?? [])
      })
      .catch(err => {
        console.error('[MemberProfileDrawer] visits fetch threw memberId=%s', member.id, err)
        setVisits([])
      })
  }, [member.id, gymSlug, simplified])

  async function handleCodeSave() {
    if (!onSaveAccessCode) return
    setSavingCode(true)
    await onSaveAccessCode(member.id, codeInput.trim())
    setSavingCode(false)
  }

  async function handleResendInvite() {
    if (!onSaveField) return
    setResendingInvite(true)
    await onSaveField(member.id, { resendKisiInvite: true })
    setResendingInvite(false)
  }

  async function handleNameSave() {
    if (!onSaveField) return
    const parts     = nameInput.trim().split(/\s+/)
    const firstName = parts[0] ?? ''
    const lastName  = parts.slice(1).join(' ')
    setSavingName(true)
    await onSaveField(member.id, { firstName, lastName })
    setSavingName(false)
  }

  async function handleEmailSave() {
    if (!onSaveField) return
    setSavingEmail(true)
    await onSaveField(member.id, { email: emailInput.trim() })
    setSavingEmail(false)
  }

  async function handlePhoneSave() {
    if (!onSaveField) return
    setSavingPhone(true)
    await onSaveField(member.id, { phone: phoneInput.trim() })
    setSavingPhone(false)
  }

  async function handleDobSave() {
    if (!onSaveField) return
    setSavingDob(true)
    await onSaveField(member.id, { dateOfBirth: dobInput.trim() })
    setSavingDob(false)
  }

  async function handleAddrSave() {
    if (!onSaveField) return
    setSavingAddr(true)
    await onSaveField(member.id, { address: addressInput.trim() })
    setSavingAddr(false)
  }

  async function handleEcNameSave() {
    if (!onSaveField) return
    setSavingEcName(true)
    await onSaveField(member.id, { emergencyContactName: ecNameInput.trim() })
    setSavingEcName(false)
  }

  async function handleEcPhoneSave() {
    if (!onSaveField) return
    setSavingEcPhone(true)
    await onSaveField(member.id, { emergencyContactPhone: ecPhoneInput.trim() })
    setSavingEcPhone(false)
  }

  async function handleEcRelSave() {
    if (!onSaveField) return
    setSavingEcRel(true)
    await onSaveField(member.id, { emergencyContactRelationship: ecRelInput.trim() })
    setSavingEcRel(false)
  }

  async function handleGuardianNameSave() {
    if (!onSaveField) return
    setSavingGuardianName(true)
    await onSaveField(member.id, { guardianName: guardianNameInput.trim() })
    setSavingGuardianName(false)
  }

  async function handleGuardianEmailSave() {
    if (!onSaveField) return
    setSavingGuardianEmail(true)
    await onSaveField(member.id, { guardianEmail: guardianEmailInput.trim() })
    setSavingGuardianEmail(false)
  }

  async function handleGuardianPhoneSave() {
    if (!onSaveField) return
    setSavingGuardianPhone(true)
    await onSaveField(member.id, { guardianPhone: guardianPhoneInput.trim() })
    setSavingGuardianPhone(false)
  }

  async function handleGuardianRelSave() {
    if (!onSaveField) return
    setSavingGuardianRel(true)
    await onSaveField(member.id, { guardianRelationship: guardianRelInput.trim() })
    setSavingGuardianRel(false)
  }

  async function handleGradSemesterSave() {
    if (!onSaveField) return
    setSavingGradSemester(true)
    await onSaveField(member.id, { gradSemester: gradSemesterInput })
    setSavingGradSemester(false)
  }

  async function handleGradYearSave() {
    if (!onSaveField) return
    setSavingGradYear(true)
    await onSaveField(member.id, { gradYear: gradYearInput === '' ? null : parseInt(gradYearInput, 10) })
    setSavingGradYear(false)
  }

  async function handleCategorySave() {
    if (!onSaveField) return
    setSavingCategory(true)
    await onSaveField(member.id, { studentCategory: studentCategoryInput })
    setSavingCategory(false)
  }

  async function handleDeleteCode() {
    if (!onDeleteCode) return
    setDeletingCode(true)
    await onDeleteCode()
    setDeletingCode(false)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
        <p className="text-sm font-semibold text-white">member profile</p>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* Avatar + name + status */}
        <div className="flex flex-col items-center text-center gap-2 pt-1 pb-2">
          <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-black font-bold text-lg tracking-tight select-none">
              {initials || '?'}
            </span>
          </div>
          <p className="text-white font-semibold text-base leading-tight">
            {member.firstName} {member.lastName}
          </p>
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

        {/* Contact */}
        <DrawerSection icon={Phone} title="contact">
          <DrawerField label="name">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
              />
              {onSaveField && (
                <button
                  onClick={handleNameSave}
                  disabled={savingName || nameInput.trim() === `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingName ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>
          <DrawerField label="email">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
              />
              {onSaveField && (
                <button
                  onClick={handleEmailSave}
                  disabled={savingEmail || emailInput.trim().toLowerCase() === (member.email ?? '').toLowerCase()}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingEmail ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>
          <DrawerField label="phone">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="tel"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                onBlur={e => setPhoneInput(formatPhone(e.target.value))}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
              />
              {onSaveField && (
                <button
                  onClick={handlePhoneSave}
                  disabled={savingPhone || phoneInput.trim() === (member.phone ?? '')}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingPhone ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>
        </DrawerSection>

        {/* Personal info */}
        <DrawerSection icon={User} title="personal info">
          {/* Date of birth */}
          <DrawerField label="date of birth">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="date"
                value={dobInput}
                onChange={e => setDobInput(e.target.value)}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36"
              />
              {onSaveField && (
                <button
                  onClick={handleDobSave}
                  disabled={savingDob || dobInput.trim() === (member.dateOfBirth ?? '')}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingDob ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>

          {/* Address */}
          <DrawerField label="address">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={addressInput}
                onChange={e => setAddressInput(e.target.value)}
                placeholder="123 main st, boston, ma"
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-44 truncate"
              />
              {onSaveField && (
                <button
                  onClick={handleAddrSave}
                  disabled={savingAddr || addressInput.trim() === (member.address ?? '')}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingAddr ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>

          {/* How did you hear about us — read-only */}
          <DrawerField label="how did you hear about us?">
            <span className="text-xs text-white ml-4">{member.hearAboutUs || '—'}</span>
          </DrawerField>
        </DrawerSection>

        {/* Emergency Contact */}
        <DrawerSection icon={ShieldAlert} title="emergency contact">
          <DrawerField label="name">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={ecNameInput}
                onChange={e => setEcNameInput(e.target.value)}
                placeholder="jane smith"
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
              />
              {onSaveField && (
                <button
                  onClick={handleEcNameSave}
                  disabled={savingEcName || ecNameInput.trim() === (member.emergencyContactName ?? '')}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingEcName ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>
          <DrawerField label="phone">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="tel"
                value={ecPhoneInput}
                onChange={e => setEcPhoneInput(e.target.value)}
                onBlur={e => setEcPhoneInput(formatPhone(e.target.value))}
                placeholder="(555) 000-0000"
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
              />
              {onSaveField && (
                <button
                  onClick={handleEcPhoneSave}
                  disabled={savingEcPhone || ecPhoneInput.trim() === (member.emergencyContactPhone ?? '')}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingEcPhone ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>
          <DrawerField label="relationship">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={ecRelInput}
                onChange={e => setEcRelInput(e.target.value)}
                placeholder="spouse, parent, friend…"
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
              />
              {onSaveField && (
                <button
                  onClick={handleEcRelSave}
                  disabled={savingEcRel || ecRelInput.trim() === (member.emergencyContactRelationship ?? '')}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingEcRel ? '…' : 'save'}
                </button>
              )}
            </div>
          </DrawerField>
        </DrawerSection>

        {/* Guardian — minors only. The guardian is the account holder: they
            signed the waiver on the member's behalf and hold the payment
            method, so staff need this visible separately from the member's
            own (nonexistent, for a minor) contact info. */}
        {isMinor && (
          <DrawerSection icon={UserCheck} title="guardian">
            <DrawerField label="name">
              <div className="flex items-center gap-2 ml-4">
                <input
                  type="text"
                  value={guardianNameInput}
                  onChange={e => setGuardianNameInput(e.target.value)}
                  placeholder="john smith"
                  className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
                />
                {onSaveField && (
                  <button
                    onClick={handleGuardianNameSave}
                    disabled={savingGuardianName || guardianNameInput.trim() === (member.guardianName ?? '')}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {savingGuardianName ? '…' : 'save'}
                  </button>
                )}
              </div>
            </DrawerField>
            <DrawerField label="email">
              <div className="flex items-center gap-2 ml-4">
                <input
                  type="email"
                  value={guardianEmailInput}
                  onChange={e => setGuardianEmailInput(e.target.value)}
                  className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
                />
                {onSaveField && (
                  <button
                    onClick={handleGuardianEmailSave}
                    disabled={savingGuardianEmail || guardianEmailInput.trim().toLowerCase() === (member.guardianEmail ?? '').toLowerCase()}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {savingGuardianEmail ? '…' : 'save'}
                  </button>
                )}
              </div>
            </DrawerField>
            <DrawerField label="phone">
              <div className="flex items-center gap-2 ml-4">
                <input
                  type="tel"
                  value={guardianPhoneInput}
                  onChange={e => setGuardianPhoneInput(e.target.value)}
                  onBlur={e => setGuardianPhoneInput(formatPhone(e.target.value))}
                  className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
                />
                {onSaveField && (
                  <button
                    onClick={handleGuardianPhoneSave}
                    disabled={savingGuardianPhone || guardianPhoneInput.trim() === (member.guardianPhone ?? '')}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {savingGuardianPhone ? '…' : 'save'}
                  </button>
                )}
              </div>
            </DrawerField>
            <DrawerField label="relationship">
              <div className="flex items-center gap-2 ml-4">
                <input
                  type="text"
                  value={guardianRelInput}
                  onChange={e => setGuardianRelInput(e.target.value)}
                  placeholder="parent, legal guardian, etc."
                  className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 truncate"
                />
                {onSaveField && (
                  <button
                    onClick={handleGuardianRelSave}
                    disabled={savingGuardianRel || guardianRelInput.trim() === (member.guardianRelationship ?? '')}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {savingGuardianRel ? '…' : 'save'}
                  </button>
                )}
              </div>
            </DrawerField>
          </DrawerSection>
        )}

        {/* Membership */}
        <DrawerSection icon={KeyRound} title="membership">
          {simplified
            ? <DrawerField label="type" value={formatMembershipTypeDisplay(member.membershipType) || '—'} />
            : <MembershipTypeControl member={member} gymSlug={gymSlug} onPlanChanged={onPlanChanged} />}

          {/* Hydra's bundled Student/Military/EMT plan — category picker first */}
          {isHydraBundledPlan && (
            <DrawerField label="category">
              <div className="flex items-center gap-2 ml-4">
                <select
                  value={studentCategoryInput}
                  onChange={e => setStudentCategoryInput(e.target.value)}
                  className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-neutral-500"
                >
                  <option value="">—</option>
                  <option value="Student">student</option>
                  <option value="Military">military</option>
                  <option value="EMT">emt</option>
                </select>
                {onSaveField && (
                  <button
                    onClick={handleCategorySave}
                    disabled={savingCategory || studentCategoryInput === (member.studentCategory ?? '')}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {savingCategory ? '…' : 'save'}
                  </button>
                )}
              </div>
            </DrawerField>
          )}

          {/* Graduation tracking — standalone student plans (Triumph/Oasis), or
              Hydra's bundled plan once "Student" is picked as the category */}
          {(isStandaloneStudentPlan || (isHydraBundledPlan && studentCategoryInput === 'Student')) && (
            <>
              <DrawerField label="graduating semester">
                <div className="flex items-center gap-2 ml-4">
                  <select
                    value={gradSemesterInput}
                    onChange={e => setGradSemesterInput(e.target.value)}
                    className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-neutral-500"
                  >
                    <option value="">—</option>
                    <option value="Fall">fall</option>
                    <option value="Spring">spring</option>
                    <option value="Summer">summer</option>
                  </select>
                  {onSaveField && (
                    <button
                      onClick={handleGradSemesterSave}
                      disabled={savingGradSemester || gradSemesterInput === (member.gradSemester ?? '')}
                      className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      {savingGradSemester ? '…' : 'save'}
                    </button>
                  )}
                </div>
              </DrawerField>
              <DrawerField label="graduating year">
                <div className="flex items-center gap-2 ml-4">
                  <input
                    type="number"
                    min={new Date().getFullYear()}
                    max={new Date().getFullYear() + 6}
                    value={gradYearInput}
                    onChange={e => setGradYearInput(e.target.value)}
                    placeholder="——"
                    className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-20 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {onSaveField && (
                    <button
                      onClick={handleGradYearSave}
                      disabled={savingGradYear || gradYearInput === (member.gradYear != null ? String(member.gradYear) : '')}
                      className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                      {savingGradYear ? '…' : 'save'}
                    </button>
                  )}
                </div>
              </DrawerField>
            </>
          )}

          {/* Student ID photo — only present once a student plan buyer has
              actually uploaded one; nothing renders otherwise. */}
          {studentIdImage && (
            <DrawerField label="student id">
              <button type="button" onClick={() => setStudentIdLightboxOpen(true)} className="ml-4">
                <img
                  src={studentIdImage}
                  alt="student id"
                  className="w-10 h-10 rounded object-cover border border-neutral-700 hover:border-neutral-500 transition-colors"
                />
              </button>
            </DrawerField>
          )}
          {studentIdLightboxOpen && (
            <ImageLightbox src={studentIdImage} onClose={() => setStudentIdLightboxOpen(false)} />
          )}

          {assignedTrainer !== undefined && (
            <DrawerField label="trainer" value={assignedTrainer?.name ?? 'none assigned'} />
          )}

          {/* Signed membership agreement — a typed signature, or a
              checkbox-era acceptance backfilled from Stripe + git history */}
          {agreement !== undefined && (
            <div className="px-3 py-3 bg-[#1c1c1c]">
              <AgreementSection
                onFile={Boolean(agreement.signatureName) || agreement.source === 'checkbox_backfill'}
                gymName={agreement.gymName}
                personName={`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()}
                signatureName={agreement.signatureName}
                signedAt={agreement.signedAt}
                signedByGuardian={Boolean(member.isMinor)}
                text={agreement.text}
                version={agreement.version}
                source={agreement.source}
              />
            </div>
          )}

          {/* Access — Kisi gyms get an invite-status row instead of a PIN editor */}
          {accessProvider === 'KISI' ? (
            <DrawerField label="access">
              <div className="flex items-center gap-2 ml-4">
                <span className="text-xs text-white">
                  access via kisi app
                  {kisiStatus && (
                    <span className="text-neutral-500">
                      {' — '}
                      {!kisiStatus.kisiUserId
                        ? 'not yet invited'
                        : kisiStatus.kisiRoleAssignmentId ? 'active' : 'invited, access pending'}
                    </span>
                  )}
                </span>
                {onSaveField && (
                  <button
                    onClick={handleResendInvite}
                    disabled={resendingInvite}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {resendingInvite ? '…' : 'resend invite'}
                  </button>
                )}
              </div>
            </DrawerField>
          ) : (
            <DrawerField label="access code">
              <div className="flex items-center gap-2 ml-4">
                <input
                  type="text"
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="——"
                  maxLength={6}
                  className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-20 font-mono"
                />
                <button
                  onClick={() => fillSuggestedPin(gymSlug, setCodeInput)}
                  className="text-[10px] px-2 py-1 rounded bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                >
                  gen
                </button>
                {onSaveAccessCode && (
                  <button
                    onClick={handleCodeSave}
                    disabled={savingCode || codeInput.trim() === (member.accessCode ?? '')}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {savingCode ? '…' : 'save'}
                  </button>
                )}
              </div>
            </DrawerField>
          )}

          {/* Flex check-ins — oasis-boston only */}
          {gymSlug === 'oasis-boston' && member.membershipType?.toLowerCase().includes('flex') && (
            <DrawerField label="check-ins this month">
              {(() => {
                const used      = member.flexCheckInsThisMonth ?? 0
                const atLimit   = used >= 5
                return (
                  <span className={`text-xs font-semibold ml-4 ${atLimit ? 'text-amber-400' : 'text-white'}`}>
                    {used} / 5
                  </span>
                )
              })()}
            </DrawerField>
          )}
        </DrawerSection>

        {/* Membership history — hidden in simplified mode */}
        {!simplified && <DrawerSection icon={History} title="history">
          {events === null ? (
            <div className="px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-neutral-600">loading…</span>
            </div>
          ) : events.length === 0 ? (
            <div className="px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-neutral-600">no history recorded</span>
            </div>
          ) : events.map(ev => (
            <div key={ev.id} className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-white">{EVENT_LABEL[ev.type] ?? ev.type}</span>
              <span className="text-xs text-neutral-500 ml-4 shrink-0">{fmtDate(ev.date)}</span>
            </div>
          ))}
        </DrawerSection>}

        {/* Visit history — every door entry for this member's access code, hidden in simplified mode */}
        {!simplified && <DrawerSection icon={DoorOpen} title="visits">
          {visits === null ? (
            <div className="px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-neutral-600">loading…</span>
            </div>
          ) : visits.length === 0 ? (
            <div className="px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-neutral-600">no visits recorded</span>
            </div>
          ) : visits.map(v => (
            <div key={v.id} className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-white">entered</span>
              <span className="text-xs text-neutral-500 ml-4 shrink-0">{fmtDateTime(v.createdAt) ?? '—'}</span>
            </div>
          ))}
        </DrawerSection>}

      </div>

      {/* Action buttons */}
      {onDeleteCode ? (
        <div className="shrink-0 px-5 py-4 border-t border-neutral-800">
          <button
            onClick={handleDeleteCode}
            disabled={deletingCode}
            className="w-full py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
          >
            {deletingCode ? 'removing…' : 'delete code'}
          </button>
        </div>
      ) : (onStatusChange || onRemoveMember || onReverseCancel) && (
        <div className="shrink-0 px-5 py-4 border-t border-neutral-800 space-y-2">
          {onStatusChange && member.status !== 'CANCELED' && (
            <>
              {(member.status === 'ACTIVE' || member.status === 'OVERDUE') && (
                <>
                  <button
                    onClick={() => onStatusChange(member.id, 'FROZEN')}
                    disabled={updating}
                    className="w-full py-2 rounded-lg text-sm font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 transition-colors"
                  >
                    freeze membership
                  </button>
                  {!member.cancelScheduled && (
                    <button
                      onClick={() => onStatusChange(member.id, 'CANCELED')}
                      disabled={updating}
                      className="w-full py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                    >
                      cancel membership
                    </button>
                  )}
                </>
              )}
              {member.status === 'FROZEN' && (
                <button
                  onClick={() => onStatusChange(member.id, 'ACTIVE')}
                  disabled={updating}
                  className="w-full py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                >
                  resume membership
                </button>
              )}
            </>
          )}
          {/* FROZEN members never get reverse-cancel — freezing and canceling
              are handled as separate, non-overlapping states here. Only
              ACTIVE/OVERDUE members with an open cancellation window qualify. */}
          {onReverseCancel && member.status !== 'FROZEN' && member.cancelScheduled && cancelWindowOpen(member) && (
            <button
              onClick={onReverseCancel}
              disabled={updating}
              className="w-full py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              reverse cancellation
            </button>
          )}
          {onRemoveMember && (
            <button
              onClick={onRemoveMember}
              disabled={updating}
              className="w-full py-2 rounded-lg text-sm font-medium bg-neutral-500/10 text-neutral-400 hover:bg-neutral-500/20 disabled:opacity-40 transition-colors"
            >
              remove member
            </button>
          )}
        </div>
      )}

    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MemberProfileDrawer({
  member,
  open,
  gymSlug,
  membershipBorder,
  onClose,
  onStatusChange,
  onSaveAccessCode,
  onSaveField,
  onDeleteCode,
  onRemoveMember,
  onReverseCancel,
  onPlanChanged,
  updating = false,
  simplified = false,
}) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <div
      className={`fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4 transition-opacity duration-200 ${
        open ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[500px] flex flex-col bg-[#171717] rounded-2xl shadow-2xl overflow-hidden"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {member && (
          <DrawerContent
            member={member}
            gymSlug={gymSlug}
            membershipBorder={membershipBorder}
            onClose={onClose}
            onStatusChange={onStatusChange}
            onSaveAccessCode={onSaveAccessCode}
            onSaveField={onSaveField}
            onDeleteCode={onDeleteCode}
            onRemoveMember={onRemoveMember}
            onReverseCancel={onReverseCancel}
            onPlanChanged={onPlanChanged}
            updating={updating}
            simplified={simplified}
          />
        )}
      </div>
    </div>
  )
}
