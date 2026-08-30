'use client'

import { useState, useEffect } from 'react'
import { X, Phone, KeyRound, History, User, ShieldAlert, DoorOpen, UserCheck } from 'lucide-react'
import { formatPhone } from '@/lib/phone'
import { formatMembershipTypeDisplay } from '@/lib/membershipCategory'

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

// ── Drawer content ────────────────────────────────────────────────────────────

function DrawerContent({ member, gymSlug, membershipBorder, onClose, onStatusChange, onSaveAccessCode, onSaveField, onDeleteCode, onRemoveMember, onReverseCancel, updating, simplified }) {
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
          <DrawerField label="type" value={formatMembershipTypeDisplay(member.membershipType) || '—'} />

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

          {/* Access code — inline editor */}
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
                onClick={() => setCodeInput(String(Math.floor(1000 + Math.random() * 9000)))}
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
          {/* Independent of status — reverse-cancel stays available for any
              still-in-window canceled member, including FROZEN, not just
              ACTIVE/OVERDUE. */}
          {onReverseCancel && member.cancelScheduled && cancelWindowOpen(member) && (
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
            updating={updating}
            simplified={simplified}
          />
        )}
      </div>
    </div>
  )
}
