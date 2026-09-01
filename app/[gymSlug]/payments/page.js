'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw, AlertTriangle, X, Phone, User, KeyRound, ShieldAlert, History, CreditCard } from 'lucide-react'
import { DrawerSection, DrawerField } from '@/components/MemberProfileDrawer'
import { formatPhone } from '@/lib/phone'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = ['active', 'frozen', 'canceled']
// "paused" maps to FROZEN; "active" includes ACTIVE + OVERDUE
const TAB_STATUSES = {
  all:      null,
  active:   ['ACTIVE', 'OVERDUE'],
  frozen:   ['FROZEN'],
  canceled: ['CANCELED'],
}

const CONFIRM_COPY = {
  freeze: {
    title:  'freeze membership?',
    bullets: ['access will be removed immediately', 'maximum freeze duration is 6 months'],
    cta: 'yes, freeze', ctaCls: 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20',
  },
  cancel: {
    title:  'cancel membership?',
    bullets: ['a 30-day notice policy applies', 'member retains access through notice period', 'this action cannot be easily undone'],
    cta: 'yes, cancel', ctaCls: 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
  },
  resume: {
    title:  'resume membership?',
    bullets: ['the member will regain immediate access', 'membership returns to active status'],
    cta: 'yes, resume', ctaCls: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  },
  'reverse-cancel': {
    title:  'reverse cancellation?',
    bullets: ['the scheduled cancellation will be lifted', 'access will be re-provisioned if it was revoked'],
    cta: 'yes, reverse', ctaCls: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { gymSlug } = useParams()
  const [members,    setMembers]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState(null)
  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState('active')

  const [selectedMember, setSelectedMember] = useState(null)
  const [panelOpen,      setPanelOpen]      = useState(false)
  const closeTimer = useRef(null)

  const [confirmModal,  setConfirmModal]  = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)

  useEffect(() => {
    document.body.style.overflow = panelOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [panelOpen])

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const headers = { Authorization: `Bearer ${token}` }

      const membersRes = await fetch(`/api/${gymSlug}/all`, { headers })

      if (!membersRes.ok) throw new Error(`${membersRes.status}`)
      const { members } = await membersRes.json()

      setMembers(members)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load members')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // ── Panel helpers ─────────────────────────────────────────────────────────
  function openPanel(member) {
    setSelectedMember(member)
    setPanelOpen(true)
  }
  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedMember(null), 220)
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const visible = members
    .filter(m => {
      const statuses = TAB_STATUSES[activeTab]
      const matchTab    = activeTab === 'canceled'
        ? (m.status === 'CANCELED' || ((m.status === 'ACTIVE' || m.status === 'OVERDUE') && m.cancelScheduled === true))
        : activeTab === 'frozen'
          ? statuses.includes(m.status)
          : (!statuses || statuses.includes(m.status)) && !m.cancelScheduled
      const q           = search.trim().toLowerCase()
      const matchSearch = !q || `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)
      return matchTab && matchSearch
    })
    .sort((a, b) => {
      const order = { ACTIVE: 0, OVERDUE: 1, FROZEN: 2, CANCELED: 3 }
      return (order[a.status] ?? 9) - (order[b.status] ?? 9)
    })

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleSaveField(memberId, fields) {
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/members/${memberId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(fields),
      })
      if (!res.ok) throw new Error('Failed')
      const { member: updated } = await res.json()
      setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev)
    } catch { /* non-fatal */ }
  }

  async function confirmAction() {
    const { action, member } = confirmModal
    setActionLoading(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/${action}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ memberId: member.id }),
      })
      if (!res.ok) throw new Error('Request failed')
      const json = await res.json()
      const { member: updated } = json
      setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev)
      if (json.error === 'stripe_dashboard_sub') {
        setActionError(json.message)
        // Leave modal open so the owner sees the message
      } else {
        setConfirmModal(null)
      }
    } catch {
      setActionError('something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">payments</h1>
      </header>

      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Search */}
        <div className="shrink-0">
          <div className="relative w-full sm:w-80">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              type="text"
              placeholder="search name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-neutral-700/50 border border-neutral-600/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
            />
          </div>
        </div>

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">

          {/* Tabs */}
          <div className="flex border-b border-neutral-800 px-4 shrink-0">
            {STATUS_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2.5 px-2.5 mr-1 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-white text-white'
                    : 'border-transparent text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="md:flex-1 md:overflow-y-auto overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 gap-2">
                <RefreshCw size={16} className="text-neutral-600 animate-spin" />
                <span className="text-sm text-neutral-600">loading…</span>
              </div>
            ) : fetchErr ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <p className="text-sm text-red-400">{fetchErr}</p>
                <button onClick={fetchMembers} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-neutral-600">no members match</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {visible.map((m, i) => (
                    <tr
                      key={m.id}
                      onClick={() => openPanel(m)}
                      className={`group hover:bg-white/5 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                    >
                      {/* Name + email + avatar */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                            <span className="text-black font-medium text-[10px] select-none">
                              {(m.firstName?.[0] ?? '') + (m.lastName?.[0] ?? '')}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-white text-sm leading-tight">{m.firstName} {m.lastName}</p>
                          </div>
                        </div>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* ── Payment detail panel ──────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4 transition-opacity duration-200 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      >
        <div
          className="w-full max-w-[500px] flex flex-col bg-[#171717] rounded-2xl shadow-2xl overflow-hidden"
          style={{ maxHeight: '85vh' }}
          onClick={e => e.stopPropagation()}
        >
          {selectedMember && (
            <PaymentPanel
              member={selectedMember}
              gymSlug={gymSlug}
              onClose={closePanel}
              onSaveField={handleSaveField}
              onAction={(action, member) => { setActionError(null); setConfirmModal({ action, member }) }}
              actionLoading={actionLoading}
            />
          )}
        </div>
      </div>

      {/* ── Confirm modal ──────────────────────────────────────────────────── */}
      {confirmModal && (() => {
        const copy = CONFIRM_COPY[confirmModal.action]
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={!actionLoading ? () => setConfirmModal(null) : undefined} />
            <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{copy.title}</p>
                  <p className="text-xs text-neutral-500">{confirmModal.member.firstName} {confirmModal.member.lastName}</p>
                </div>
              </div>
              <ul className="space-y-1.5 mb-5">
                {copy.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-neutral-400">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-600 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
              {actionError && <p className="text-xs text-red-400 mb-3">{actionError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmModal(null)}
                  disabled={actionLoading}
                  className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
                >
                  cancel
                </button>
                <button
                  onClick={confirmAction}
                  disabled={actionLoading}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors ${copy.ctaCls}`}
                >
                  {actionLoading ? 'please wait…' : copy.cta}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}

// ── Payment detail panel ──────────────────────────────────────────────────────

const EVENT_LABEL = {
  joined:                 'joined',
  reactivated:            'reactivated',
  frozen:                 'frozen',
  unfrozen:               'unfrozen',
  cancellation_scheduled: 'cancellation scheduled',
  canceled:               'canceled',
}

function fmtEvDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
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

const SAVE_BTN = 'text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0'
const INPUT    = 'bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 truncate'

function PaymentPanel({ member, gymSlug, onClose, onAction, onSaveField, actionLoading }) {
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '')

  // ── field state ──────────────────────────────────────────────────────────────
  const [nameInput,           setNameInput]           = useState(`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim())
  const [emailInput,          setEmailInput]          = useState(member.email                            ?? '')
  const [phoneInput,          setPhoneInput]          = useState(member.phone                            ?? '')
  const [dobInput,            setDobInput]            = useState(member.dateOfBirth                      ?? '')
  const [addressInput,        setAddressInput]        = useState(member.address                          ?? '')
  const [ecNameInput,         setEcNameInput]         = useState(member.emergencyContactName             ?? '')
  const [ecPhoneInput,        setEcPhoneInput]        = useState(member.emergencyContactPhone            ?? '')
  const [ecRelInput,          setEcRelInput]          = useState(member.emergencyContactRelationship     ?? '')
  const [membershipTypeInput, setMembershipTypeInput] = useState(member.membershipType                   ?? '')
  const [subIdInput,          setSubIdInput]          = useState(member.stripeSubscriptionId             ?? '')
  const [custIdInput,         setCustIdInput]         = useState(member.stripeCustomerId                 ?? '')

  // ── saving state ─────────────────────────────────────────────────────────────
  const [savingName,           setSavingName]           = useState(false)
  const [savingEmail,          setSavingEmail]          = useState(false)
  const [savingPhone,          setSavingPhone]          = useState(false)
  const [savingDob,            setSavingDob]            = useState(false)
  const [savingAddr,           setSavingAddr]           = useState(false)
  const [savingEcName,         setSavingEcName]         = useState(false)
  const [savingEcPhone,        setSavingEcPhone]        = useState(false)
  const [savingEcRel,          setSavingEcRel]          = useState(false)
  const [savingMembershipType, setSavingMembershipType] = useState(false)
  const [savingSubId,          setSavingSubId]          = useState(false)
  const [savingCustId,         setSavingCustId]         = useState(false)

  // ── history ──────────────────────────────────────────────────────────────────
  const [events, setEvents] = useState(null)

  // Reset inputs when member changes
  useEffect(() => {
    setNameInput(`${member.firstName ?? ''} ${member.lastName ?? ''}`.trim())
    setEmailInput(member.email                            ?? '')
    setPhoneInput(member.phone                            ?? '')
    setDobInput(member.dateOfBirth                        ?? '')
    setAddressInput(member.address                        ?? '')
    setEcNameInput(member.emergencyContactName            ?? '')
    setEcPhoneInput(member.emergencyContactPhone          ?? '')
    setEcRelInput(member.emergencyContactRelationship     ?? '')
    setMembershipTypeInput(member.membershipType          ?? '')
    setSubIdInput(member.stripeSubscriptionId             ?? '')
    setCustIdInput(member.stripeCustomerId                ?? '')
  }, [member.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!gymSlug || !member.id) return
    setEvents(null)
    const token = localStorage.getItem('ik_token')
    fetch(`/api/${gymSlug}/members/${member.id}/events`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .catch(() => setEvents([]))
  }, [member.id, gymSlug])

  // ── save helpers ─────────────────────────────────────────────────────────────
  async function save(fields, setSaving) {
    if (!onSaveField) return
    setSaving(true)
    await onSaveField(member.id, fields)
    setSaving(false)
  }

  async function handleNameSave() {
    const parts     = nameInput.trim().split(/\s+/)
    const firstName = parts[0] ?? ''
    const lastName  = parts.slice(1).join(' ')
    await save({ firstName, lastName }, setSavingName)
  }

  const fullName = `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
        <p className="text-sm font-semibold text-white">member profile</p>
        <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* Avatar + name */}
        <div className="flex flex-col items-center text-center gap-2 pt-1 pb-2">
          <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-black font-bold text-lg tracking-tight select-none">{initials || '?'}</span>
          </div>
          <p className="text-white font-semibold text-base leading-tight">{member.firstName} {member.lastName}</p>
          {member.cancelScheduled && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                cancellation scheduled{member.cancelEffectiveDate ? ` — ${fmtEvDate(member.cancelEffectiveDate)}` : ''}
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
              <input type="text" value={nameInput} onChange={e => setNameInput(e.target.value)} className={`${INPUT} w-36`} />
              <button onClick={handleNameSave} disabled={savingName || nameInput.trim() === fullName} className={SAVE_BTN}>
                {savingName ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
          <DrawerField label="email">
            <div className="flex items-center gap-2 ml-4">
              <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)} className={`${INPUT} w-36`} />
              <button onClick={() => save({ email: emailInput.trim() }, setSavingEmail)} disabled={savingEmail || emailInput.trim().toLowerCase() === (member.email ?? '').toLowerCase()} className={SAVE_BTN}>
                {savingEmail ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
          <DrawerField label="phone">
            <div className="flex items-center gap-2 ml-4">
              <input type="tel" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} onBlur={e => setPhoneInput(formatPhone(e.target.value))} className={`${INPUT} w-36`} />
              <button onClick={() => save({ phone: phoneInput.trim() }, setSavingPhone)} disabled={savingPhone || phoneInput.trim() === (member.phone ?? '')} className={SAVE_BTN}>
                {savingPhone ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
        </DrawerSection>

        {/* Personal info */}
        <DrawerSection icon={User} title="personal info">
          <DrawerField label="date of birth">
            <div className="flex items-center gap-2 ml-4">
              <input type="date" value={dobInput} onChange={e => setDobInput(e.target.value)} className={`${INPUT} w-36`} />
              <button onClick={() => save({ dateOfBirth: dobInput.trim() }, setSavingDob)} disabled={savingDob || dobInput.trim() === (member.dateOfBirth ?? '')} className={SAVE_BTN}>
                {savingDob ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
          <DrawerField label="address">
            <div className="flex items-center gap-2 ml-4">
              <input type="text" value={addressInput} onChange={e => setAddressInput(e.target.value)} placeholder="123 main st…" className={`${INPUT} w-44`} />
              <button onClick={() => save({ address: addressInput.trim() }, setSavingAddr)} disabled={savingAddr || addressInput.trim() === (member.address ?? '')} className={SAVE_BTN}>
                {savingAddr ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
        </DrawerSection>

        {/* Emergency contact */}
        <DrawerSection icon={ShieldAlert} title="emergency contact">
          <DrawerField label="name">
            <div className="flex items-center gap-2 ml-4">
              <input type="text" value={ecNameInput} onChange={e => setEcNameInput(e.target.value)} placeholder="jane smith" className={`${INPUT} w-36`} />
              <button onClick={() => save({ emergencyContactName: ecNameInput.trim() }, setSavingEcName)} disabled={savingEcName || ecNameInput.trim() === (member.emergencyContactName ?? '')} className={SAVE_BTN}>
                {savingEcName ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
          <DrawerField label="phone">
            <div className="flex items-center gap-2 ml-4">
              <input type="tel" value={ecPhoneInput} onChange={e => setEcPhoneInput(e.target.value)} onBlur={e => setEcPhoneInput(formatPhone(e.target.value))} placeholder="(555) 000-0000" className={`${INPUT} w-36`} />
              <button onClick={() => save({ emergencyContactPhone: ecPhoneInput.trim() }, setSavingEcPhone)} disabled={savingEcPhone || ecPhoneInput.trim() === (member.emergencyContactPhone ?? '')} className={SAVE_BTN}>
                {savingEcPhone ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
          <DrawerField label="relationship">
            <div className="flex items-center gap-2 ml-4">
              <input type="text" value={ecRelInput} onChange={e => setEcRelInput(e.target.value)} placeholder="spouse, parent…" className={`${INPUT} w-36`} />
              <button onClick={() => save({ emergencyContactRelationship: ecRelInput.trim() }, setSavingEcRel)} disabled={savingEcRel || ecRelInput.trim() === (member.emergencyContactRelationship ?? '')} className={SAVE_BTN}>
                {savingEcRel ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
        </DrawerSection>

        {/* Membership */}
        <DrawerSection icon={KeyRound} title="membership">
          <DrawerField label="type">
            <div className="flex items-center gap-2 ml-4">
              <input type="text" value={membershipTypeInput} onChange={e => setMembershipTypeInput(e.target.value)} className={`${INPUT} w-36`} />
              <button onClick={() => save({ membershipType: membershipTypeInput.trim() }, setSavingMembershipType)} disabled={savingMembershipType || membershipTypeInput.trim() === (member.membershipType ?? '')} className={SAVE_BTN}>
                {savingMembershipType ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
        </DrawerSection>

        {/* Billing */}
        <DrawerSection icon={CreditCard} title="billing">
          <DrawerField label="subscription">
            <div className="flex items-center gap-2 ml-4">
              <input type="text" value={subIdInput} onChange={e => setSubIdInput(e.target.value)} className={`${INPUT} w-36 font-mono text-[11px]`} />
              <button onClick={() => save({ stripeSubscriptionId: subIdInput.trim() }, setSavingSubId)} disabled={savingSubId || subIdInput.trim() === (member.stripeSubscriptionId ?? '')} className={SAVE_BTN}>
                {savingSubId ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
          <DrawerField label="customer">
            <div className="flex items-center gap-2 ml-4">
              <input type="text" value={custIdInput} onChange={e => setCustIdInput(e.target.value)} className={`${INPUT} w-36 font-mono text-[11px]`} />
              <button onClick={() => save({ stripeCustomerId: custIdInput.trim() }, setSavingCustId)} disabled={savingCustId || custIdInput.trim() === (member.stripeCustomerId ?? '')} className={SAVE_BTN}>
                {savingCustId ? '…' : 'save'}
              </button>
            </div>
          </DrawerField>
        </DrawerSection>

        {/* History */}
        <DrawerSection icon={History} title="history">
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
              <span className="text-xs text-neutral-500 ml-4 shrink-0">{fmtEvDate(ev.date)}</span>
            </div>
          ))}
        </DrawerSection>

      </div>

      {/* Action buttons */}
      {member.status !== 'CANCELED' && (
        <div className="shrink-0 px-5 py-4 border-t border-neutral-800 space-y-2">
          {(member.status === 'ACTIVE' || member.status === 'OVERDUE') && (
            <>
              <button
                onClick={() => onAction('freeze', member)}
                disabled={actionLoading}
                className="w-full py-2 rounded-lg text-sm font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 transition-colors"
              >
                freeze membership
              </button>
              {!member.cancelScheduled && (
                <button
                  onClick={() => onAction('cancel', member)}
                  disabled={actionLoading}
                  className="w-full py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                >
                  cancel membership
                </button>
              )}
            </>
          )}
          {member.status === 'FROZEN' && (
            <button
              onClick={() => onAction('resume', member)}
              disabled={actionLoading}
              className="w-full py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              resume membership
            </button>
          )}
          {/* FROZEN members never get reverse-cancel — freezing and canceling
              are handled as separate, non-overlapping states here. Only
              ACTIVE/OVERDUE members with an open cancellation window qualify. */}
          {member.status !== 'FROZEN' && member.cancelScheduled && cancelWindowOpen(member) && (
            <button
              onClick={() => onAction('reverse-cancel', member)}
              disabled={actionLoading}
              className="w-full py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              reverse cancellation
            </button>
          )}
        </div>
      )}
    </div>
  )
}
