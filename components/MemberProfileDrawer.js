'use client'

import { useState, useEffect } from 'react'
import { X, Phone, KeyRound, History, User, ShieldAlert } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TEXT = {
  ACTIVE:    'text-emerald-500',
  FROZEN:    'text-blue-400',
  CANCELLED: 'text-zinc-500',
  OVERDUE:   'text-red-400',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_LABEL = {
  joined:      'joined',
  reactivated: 'reactivated',
  frozen:      'frozen',
  unfrozen:    'unfrozen',
  cancelled:   'cancelled',
}

function fmtStatus(status) {
  return status === 'CANCELLED' ? 'canceled' : (status?.toLowerCase() ?? '—')
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
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

function DrawerContent({ member, gymSlug, membershipBorder, onClose, onStatusChange, onSaveAccessCode, onSaveField, onDeleteCode, onRemoveMember, updating, simplified }) {
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '')
  const [codeInput,    setCodeInput]    = useState(member.accessCode ?? '')
  const [savingCode,   setSavingCode]   = useState(false)
  const [deletingCode, setDeletingCode] = useState(false)
  const [events,       setEvents]       = useState(null)  // null = loading, [] = loaded empty

  const [dobInput,     setDobInput]     = useState(member.dateOfBirth ?? '')
  const [savingDob,    setSavingDob]    = useState(false)
  const [addressInput, setAddressInput] = useState(member.address ?? '')
  const [savingAddr,   setSavingAddr]   = useState(false)

  const [ecNameInput,  setEcNameInput]  = useState(member.emergencyContactName  ?? '')
  const [savingEcName, setSavingEcName] = useState(false)
  const [ecPhoneInput, setEcPhoneInput] = useState(member.emergencyContactPhone ?? '')
  const [savingEcPhone, setSavingEcPhone] = useState(false)

  // Keep codeInput in sync when the member prop changes (different member opened,
  // or same member's accessCode updated by parent after a successful save).
  useEffect(() => {
    setCodeInput(member.accessCode ?? '')
    setDobInput(member.dateOfBirth ?? '')
    setAddressInput(member.address ?? '')
    setEcNameInput(member.emergencyContactName  ?? '')
    setEcPhoneInput(member.emergencyContactPhone ?? '')
  }, [member.id, member.accessCode, member.dateOfBirth, member.address, member.emergencyContactName, member.emergencyContactPhone])

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

  async function handleCodeSave() {
    if (!onSaveAccessCode) return
    setSavingCode(true)
    await onSaveAccessCode(member.id, codeInput.trim())
    setSavingCode(false)
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

  async function handleDeleteCode() {
    if (!onDeleteCode) return
    setDeletingCode(true)
    await onDeleteCode()
    setDeletingCode(false)
  }

  return (
    <div className="flex flex-col h-full">

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
        </div>

        {/* Contact */}
        <DrawerSection icon={Phone} title="contact">
          <DrawerField label="email" value={member.email} />
          <DrawerField label="phone" value={member.phone} />
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
        </DrawerSection>

        {/* Membership */}
        <DrawerSection icon={KeyRound} title="membership">
          <DrawerField label="type" value={member.membershipType?.toLowerCase() || '—'} />

          {/* Access code — inline editor */}
          <DrawerField label="access code">
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="——"
                maxLength={6}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white text-right placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-20 font-mono"
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

          <DrawerField label="joined" value={fmtDate(member.createdAt)} />
          {member.status === 'FROZEN'    && <DrawerField label="frozen"   value={fmtDate(member.dateFrozen)} />}
          {member.status === 'CANCELLED' && <DrawerField label="canceled" value={fmtDate(member.dateCanceled)} />}

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
      ) : (onStatusChange || onRemoveMember) && (
        <div className="shrink-0 px-5 py-4 border-t border-neutral-800 space-y-2">
          {onStatusChange && member.status !== 'CANCELLED' && (
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
                  <button
                    onClick={() => onStatusChange(member.id, 'CANCELLED')}
                    disabled={updating}
                    className="w-full py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                  >
                    cancel membership
                  </button>
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
  updating = false,
  simplified = false,
}) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/60 z-30 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 right-0 w-full sm:w-[420px] bg-[#171717] border-l border-neutral-800 z-40 flex flex-col shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
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
            updating={updating}
            simplified={simplified}
          />
        )}
      </div>
    </>
  )
}
