'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw, X, KeyRound, Phone, CreditCard, AlertTriangle } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = ['all', 'active', 'frozen', 'canceled', 'overdue']

const STATUS_PILL = {
  ACTIVE:    'bg-emerald-500/15 text-emerald-400',
  FROZEN:    'bg-sky-500/15 text-sky-400',
  CANCELLED: 'bg-neutral-500/15 text-neutral-400',
  OVERDUE:   'bg-red-500/15 text-red-400',
}

const TYPE_BADGE = {
  FOUNDING: 'bg-blue-500/15 text-blue-400',
  GENERAL:  'bg-neutral-500/15 text-neutral-400',
  STUDENT:  'bg-amber-500/15 text-amber-400',
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500',   'bg-cyan-500', 'bg-orange-500',  'bg-indigo-500',
]

const CONFIRM_COPY = {
  freeze: {
    title:   'freeze membership?',
    bullets: [
      'access will be removed immediately',
      'maximum freeze duration is 6 months',
      'you can resume the membership at any time',
    ],
    cta:     'yes, freeze',
    ctaCls:  'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20',
  },
  cancel: {
    title:   'cancel membership?',
    bullets: [
      'a 30-day notice policy applies',
      'the member retains access through their notice period',
      'this action cannot be easily undone',
    ],
    cta:     'yes, cancel',
    ctaCls:  'bg-red-500/10 text-red-400 hover:bg-red-500/20',
  },
  resume: {
    title:   'resume membership?',
    bullets: [
      'the member will regain immediate access',
      'their membership will return to active status',
    ],
    cta:     'yes, resume',
    ctaCls:  'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  },
  overdue: {
    title:   'mark as overdue?',
    bullets: [
      'the member will appear on the overdue payments page',
      'their access is not affected until you cancel',
    ],
    cta:     'yes, mark overdue',
    ctaCls:  'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtStatus(status) {
  return status === 'CANCELLED' ? 'canceled' : status.toLowerCase()
}

function avatarBg(id = '') {
  const n = [...id].reduce((s, c) => s + c.charCodeAt(0), 0)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const { gymSlug } = useParams()

  const [members,   setMembers]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [fetchErr,  setFetchErr]  = useState(null)
  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState('all')

  // Slide-out panel
  const [selectedMember, setSelectedMember] = useState(null)
  const [panelOpen,      setPanelOpen]      = useState(false)
  const closeTimer = useRef(null)

  // Confirm modal
  const [confirmModal,  setConfirmModal]  = useState(null) // { action, member }
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/all`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { members } = await res.json()
      setMembers(members)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load members')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // ── Panel helpers ────────────────────────────────────────────────────────

  function openPanel(member) {
    setSelectedMember(member)
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedMember(null), 220)
  }

  // ── Action helpers ───────────────────────────────────────────────────────

  function requestAction(action, member, e) {
    e.stopPropagation()
    setActionError(null)
    setConfirmModal({ action, member })
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
      const { member: updated } = await res.json()
      // Update list + open panel if this member is selected
      setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev)
      setConfirmModal(null)
    } catch {
      setActionError('something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const STATUS_ORDER = { ACTIVE: 0, FROZEN: 1, CANCELLED: 2, OVERDUE: 3 }

  const counts = {
    all:       members.length,
    active:    members.filter(m => m.status === 'ACTIVE').length,
    overdue:   members.filter(m => m.status === 'OVERDUE').length,
    frozen:    members.filter(m => m.status === 'FROZEN').length,
    canceled:  members.filter(m => m.status === 'CANCELLED').length,
  }

  const visible = members
    .filter(m => {
      const tabStatus = activeTab === 'canceled' ? 'cancelled' : activeTab
      const matchTab = activeTab === 'all' || m.status.toLowerCase() === tabStatus.toLowerCase()
      const q = search.trim().toLowerCase()
      const matchSearch = !q ||
        `${m.firstName} ${m.lastName} ${m.email} ${m.phone ?? ''}`.toLowerCase().includes(q)
      return matchTab && matchSearch
    })
    .sort((a, b) => {
      if (activeTab === 'all')       return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
      if (activeTab === 'frozen')    return new Date(b.dateFrozen   ?? 0) - new Date(a.dateFrozen   ?? 0)
      if (activeTab === 'canceled') return new Date(b.dateCanceled ?? 0) - new Date(a.dateCanceled ?? 0)
      return 0
    })

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-white">members</h1>
          {!loading && (
            <span className="text-xs text-neutral-600 tabular-nums">{members.length}</span>
          )}
        </div>
        <button
          onClick={fetchMembers}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          refresh
        </button>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col p-5 gap-4 overflow-hidden min-h-0">

        {/* Search bar */}
        <div className="shrink-0 relative w-full sm:w-80">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="search name, email, phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1c1c1c] border border-neutral-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
          />
        </div>

        {/* Table card */}
        <div className="flex-1 flex flex-col bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden min-h-0">

          {/* Tabs */}
          <div className="flex border-b border-neutral-800 px-4 shrink-0">
            {TABS.map(tab => (
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
                <span className={`ml-1.5 text-[10px] tabular-nums ${activeTab === tab ? 'text-neutral-400' : 'text-neutral-700'}`}>
                  {counts[tab] ?? 0}
                </span>
              </button>
            ))}
          </div>

          {/* Table body */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 gap-2">
                <RefreshCw size={16} className="text-neutral-600 animate-spin" />
                <span className="text-sm text-neutral-600">loading…</span>
              </div>
            ) : fetchErr ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <p className="text-sm text-red-400">{fetchErr}</p>
                <button onClick={fetchMembers} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                  retry
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-neutral-600">no members match</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#1c1c1c] z-10">
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">name</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">type</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">status</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">joined</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(m => (
                    <tr
                      key={m.id}
                      onClick={() => openPanel(m)}
                      className="border-b border-neutral-800/40 hover:bg-white/[0.025] transition-colors cursor-pointer"
                    >
                      {/* Name + avatar */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${avatarBg(m.id)}`}>
                            <span className="text-white font-semibold text-[10px] select-none">
                              {(m.firstName?.[0] ?? '') + (m.lastName?.[0] ?? '')}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-white font-medium text-sm truncate">{m.firstName} {m.lastName}</p>
                            <p className="text-neutral-500 text-[11px] truncate">{m.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[m.membershipType] ?? TYPE_BADGE.GENERAL}`}>
                          {(m.membershipType ?? 'GENERAL').toLowerCase()}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[m.status]}`}>
                          {fmtStatus(m.status)}
                        </span>
                      </td>

                      {/* Joined */}
                      <td className="px-5 py-3 text-neutral-600 text-xs whitespace-nowrap">
                        {fmtDate(m.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          {(m.status === 'ACTIVE' || m.status === 'OVERDUE') && (
                            <>
                              <button
                                onClick={e => requestAction('freeze', m, e)}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
                              >
                                freeze
                              </button>
                              <button
                                onClick={e => requestAction('cancel', m, e)}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                              >
                                cancel
                              </button>
                            </>
                          )}
                          {m.status === 'FROZEN' && (
                            <button
                              onClick={e => requestAction('resume', m, e)}
                              className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              resume
                            </button>
                          )}
                          {m.status === 'CANCELLED' && (
                            <span className="text-[11px] text-neutral-700">—</span>
                          )}
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

      {/* ── Slide-out overlay ─────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      />

      {/* ── Member profile panel ──────────────────────────────────────────── */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[380px] bg-[#171717] border-l border-neutral-800 z-50 flex flex-col shadow-2xl transition-transform duration-200 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedMember && (
          <MemberPanel
            member={selectedMember}
            onClose={closePanel}
            onAction={(action, member) => { setActionError(null); setConfirmModal({ action, member }) }}
            actionLoading={actionLoading}
          />
        )}
      </div>

      {/* ── Confirm modal ─────────────────────────────────────────────────── */}
      {confirmModal && (
        <ConfirmModal
          action={confirmModal.action}
          member={confirmModal.member}
          loading={actionLoading}
          error={actionError}
          onConfirm={confirmAction}
          onClose={() => { setConfirmModal(null); setActionError(null) }}
        />
      )}

    </div>
  )
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ action, member, loading, error, onConfirm, onClose }) {
  const copy = CONFIRM_COPY[action]
  if (!copy) return null

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={!loading ? onClose : undefined} />

      {/* Card */}
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">

        {/* Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-neutral-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{copy.title}</p>
            <p className="text-xs text-neutral-500">{member.firstName} {member.lastName}</p>
          </div>
        </div>

        {/* Bullets */}
        <ul className="space-y-1.5 mb-5">
          {copy.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-neutral-400">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-600 shrink-0" />
              {b}
            </li>
          ))}
        </ul>

        {/* Error */}
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
          >
            cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors ${copy.ctaCls}`}
          >
            {loading ? 'please wait…' : copy.cta}
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Member profile panel ──────────────────────────────────────────────────────

function PanelSection({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={11} className="text-neutral-600" />
        <p className="text-[11px] font-semibold tracking-widest text-neutral-600">{title}</p>
      </div>
      <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function PanelField({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-neutral-500 shrink-0">{label}</span>
      <span className={`text-xs text-white text-right ml-4 truncate max-w-[200px] ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '—'}
      </span>
    </div>
  )
}

function MemberPanel({ member, onClose, onAction, actionLoading }) {
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '')
  const color    = avatarBg(member.id)

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
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Avatar + name + badges */}
        <div className="flex flex-col items-center text-center gap-3 pt-1 pb-2">
          <div className={`w-[60px] h-[60px] rounded-full flex items-center justify-center shrink-0 ${color}`}>
            <span className="text-white font-bold text-lg tracking-tight select-none">
              {initials || '?'}
            </span>
          </div>
          <div>
            <p className="text-white font-semibold text-base leading-tight">
              {member.firstName} {member.lastName}
            </p>
            <p className="text-neutral-500 text-xs mt-0.5">member</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${STATUS_PILL[member.status]}`}>
              {fmtStatus(member.status)}
            </span>
            <span className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${TYPE_BADGE[member.membershipType] ?? TYPE_BADGE.GENERAL}`}>
              {(member.membershipType ?? 'GENERAL').toLowerCase()}
            </span>
          </div>
        </div>

        {/* Contact */}
        <PanelSection icon={Phone} title="contact">
          <PanelField label="email" value={member.email} />
          <PanelField label="phone" value={member.phone} />
        </PanelSection>

        {/* Membership */}
        <PanelSection icon={KeyRound} title="membership">
          <PanelField label="type"      value={(member.membershipType ?? 'GENERAL').toLowerCase()} />
          <PanelField label="access id" value={member.accessCode} mono />
          <PanelField label="joined"    value={fmtDate(member.createdAt)} />
          {member.status === 'FROZEN'    && <PanelField label="frozen"    value={fmtDate(member.dateFrozen)} />}
          {member.status === 'CANCELLED' && <PanelField label="canceled" value={fmtDate(member.dateCanceled)} />}
        </PanelSection>

        {/* Stripe */}
        {(member.stripeCustomerId || member.stripeSubscriptionId) && (
          <PanelSection icon={CreditCard} title="stripe">
            <PanelField label="customer id"     value={member.stripeCustomerId}     mono />
            <PanelField label="subscription id" value={member.stripeSubscriptionId} mono />
          </PanelSection>
        )}

      </div>

      {/* Action buttons */}
      {member.status !== 'CANCELLED' && (
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
              <button
                onClick={() => onAction('cancel', member)}
                disabled={actionLoading}
                className="w-full py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                cancel membership
              </button>
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
        </div>
      )}

    </div>
  )
}
