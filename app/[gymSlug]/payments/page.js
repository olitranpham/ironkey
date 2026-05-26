'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw, AlertTriangle, X, CreditCard, Phone } from 'lucide-react'
import { getGymTheme } from '@/lib/gymThemes'

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_FILTERS = ['all', 'founding', 'general', 'student']

const STATUS_TABS = ['active', 'frozen', 'canceled']
// "paused" maps to FROZEN; "active" includes ACTIVE + OVERDUE
const TAB_STATUSES = {
  all:      null,
  active:   ['ACTIVE', 'OVERDUE'],
  frozen:   ['FROZEN'],
  canceled: ['CANCELLED'],
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
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { gymSlug } = useParams()
  const { membershipBorder } = getGymTheme(gymSlug)

  const [members,    setMembers]    = useState([])
  const [priceMap,   setPriceMap]   = useState({})
  const [priceIdMap, setPriceIdMap] = useState({})
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState(null)
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [activeTab,  setActiveTab]  = useState('active')

  const [selectedMember, setSelectedMember] = useState(null)
  const [panelOpen,      setPanelOpen]      = useState(false)
  const closeTimer = useRef(null)

  const [confirmModal,  setConfirmModal]  = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const headers = { Authorization: `Bearer ${token}` }

      const [membersRes, subsRes] = await Promise.all([
        fetch(`/api/${gymSlug}/all`,                    { headers }),
        fetch(`/api/${gymSlug}/stripe/subscriptions`,   { headers }),
      ])

      if (!membersRes.ok) throw new Error(`${membersRes.status}`)
      const { members } = await membersRes.json()
      const subsJson    = subsRes.ok ? await subsRes.json() : {}

      setMembers(members)
      setPriceMap(subsJson.subscriptions ?? {})
      setPriceIdMap(subsJson.prices      ?? {})
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
      const matchTab  = !statuses || statuses.includes(m.status)
      const matchType = typeFilter === 'all' || m.membershipType.toLowerCase() === typeFilter
      const q         = search.trim().toLowerCase()
      const matchSearch = !q || `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)
      return matchTab && matchType && matchSearch
    })
    .sort((a, b) => {
      const order = { ACTIVE: 0, OVERDUE: 1, FROZEN: 2, CANCELLED: 3 }
      return (order[a.status] ?? 9) - (order[b.status] ?? 9)
    })

  // ── Actions ───────────────────────────────────────────────────────────────
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
      setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev)
      setConfirmModal(null)
    } catch {
      setActionError('something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">payments</h1>
      </header>

      <main className="flex-1 flex flex-col p-5 gap-4 overflow-hidden min-h-0">

        {/* Search + type filter */}
        <div className="shrink-0 flex flex-wrap items-center gap-3">
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
          {/* Membership type filter pills */}
          <div className="flex items-center gap-1.5">
            {TYPE_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === f
                    ? 'bg-white/10 text-white'
                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Table card */}
        <div className="flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden min-h-0">

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
          <div className="flex-1 overflow-y-auto">
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

      {/* ── Overlay ───────────────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      />

      {/* ── Payment detail panel ──────────────────────────────────────────── */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[360px] bg-[#171717] border-l border-neutral-800 z-50 flex flex-col shadow-2xl transition-transform duration-200 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedMember && (
          <PaymentPanel
            member={selectedMember}
            priceMap={priceMap}
            priceIdMap={priceIdMap}
            onClose={closePanel}
            onAction={(action, member) => { setActionError(null); setConfirmModal({ action, member }) }}
            actionLoading={actionLoading}
          />
        )}
      </div>

      {/* ── Confirm modal ──────────────────────────────────────────────────── */}
      {confirmModal && (() => {
        const copy = CONFIRM_COPY[confirmModal.action]
        return (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
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

function PaymentPanel({ member, priceMap, priceIdMap, onClose, onAction, actionLoading }) {
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '')
  const entry    = priceMap[member.stripeSubscriptionId] ?? priceIdMap[member.priceId]

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
        <p className="text-sm font-semibold text-white">payment details</p>
        <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Avatar + name */}
        <div className="flex flex-col items-center text-center gap-2 pt-1 pb-2">
          <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-black font-bold text-lg tracking-tight select-none">{initials || '?'}</span>
          </div>
          <p className="text-white font-semibold text-base leading-tight">{member.firstName} {member.lastName}</p>
        </div>

        {/* Contact */}
        <PSection icon={Phone} title="contact">
          <PField label="email" value={member.email} />
          <PField label="phone" value={member.phone} />
        </PSection>

        {/* Billing */}
        <PSection icon={CreditCard} title="billing">
          <PField label="plan"   value={(member.membershipType ?? 'GENERAL').toLowerCase()} />
          <PField label="amount" value={entry ? `$${entry.amount}/${entry.interval}` : '—'} />
        </PSection>

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

function PSection({ icon: Icon, title, children }) {
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

function PField({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-zinc-400 shrink-0">{label}</span>
      <span className="text-xs text-white text-right ml-4 truncate max-w-[240px]">{value || '—'}</span>
    </div>
  )
}
