'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw, AlertTriangle } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PLAN_AMOUNT = { FOUNDING: 50, GENERAL: 65, STUDENT: 55 }

const PLAN_BADGE = {
  FOUNDING: 'bg-blue-500/15 text-blue-400',
  GENERAL:  'bg-neutral-500/15 text-neutral-400',
  STUDENT:  'bg-amber-500/15 text-amber-400',
}

const STATUS_PILL = {
  ACTIVE:    'bg-emerald-500/15 text-emerald-400',
  FROZEN:    'bg-sky-500/15 text-sky-400',
  CANCELLED: 'bg-neutral-500/15 text-neutral-400',
  OVERDUE:   'bg-red-500/15 text-red-400',
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500',   'bg-cyan-500', 'bg-orange-500',  'bg-indigo-500',
]

const TYPE_FILTERS = ['all', 'founding', 'general', 'student']

const STATUS_TABS = ['all', 'active', 'paused', 'cancelled']
// "paused" maps to FROZEN; "active" includes ACTIVE + OVERDUE
const TAB_STATUSES = {
  all:       null,
  active:    ['ACTIVE', 'OVERDUE'],
  paused:    ['FROZEN'],
  cancelled: ['CANCELLED'],
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function avatarBg(id = '') {
  const n = [...id].reduce((s, c) => s + c.charCodeAt(0), 0)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { gymSlug } = useParams()

  const [members,    setMembers]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState(null)
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [activeTab,  setActiveTab]  = useState('all')

  const [confirmModal,  setConfirmModal]  = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
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

  // ── Counts for tabs ───────────────────────────────────────────────────────
  const tabCounts = {
    all:       members.length,
    active:    members.filter(m => ['ACTIVE', 'OVERDUE'].includes(m.status)).length,
    paused:    members.filter(m => m.status === 'FROZEN').length,
    cancelled: members.filter(m => m.status === 'CANCELLED').length,
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
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">payments</h1>
        <button
          onClick={fetchMembers}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          refresh
        </button>
      </header>

      <main className="flex-1 flex flex-col p-5 gap-4 overflow-hidden min-h-0">

        {/* Search + type filter */}
        <div className="shrink-0 flex items-center gap-3">
          <div className="relative w-80">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              type="text"
              placeholder="search name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#1c1c1c] border border-neutral-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
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
        <div className="flex-1 flex flex-col bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden min-h-0">

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
                <span className={`ml-1.5 text-[10px] tabular-nums ${activeTab === tab ? 'text-neutral-400' : 'text-neutral-700'}`}>
                  {tabCounts[tab] ?? 0}
                </span>
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
                <thead className="sticky top-0 bg-[#1c1c1c] z-10">
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">member</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">plan</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">amount</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">status</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(m => (
                    <tr key={m.id} className="border-b border-neutral-800/40 hover:bg-white/[0.025] transition-colors">

                      {/* Member */}
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

                      {/* Plan */}
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${PLAN_BADGE[m.membershipType] ?? PLAN_BADGE.GENERAL}`}>
                          {(m.membershipType ?? 'GENERAL').toLowerCase()}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-3 text-white text-xs tabular-nums">
                        ${PLAN_AMOUNT[m.membershipType] ?? '—'}<span className="text-neutral-600">/mo</span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[m.status]}`}>
                          {m.status.toLowerCase()}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {(m.status === 'ACTIVE' || m.status === 'OVERDUE') && (
                            <>
                              <button
                                onClick={() => { setActionError(null); setConfirmModal({ action: 'freeze', member: m }) }}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
                              >
                                freeze
                              </button>
                              <button
                                onClick={() => { setActionError(null); setConfirmModal({ action: 'cancel', member: m }) }}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                              >
                                cancel
                              </button>
                            </>
                          )}
                          {m.status === 'FROZEN' && (
                            <button
                              onClick={() => { setActionError(null); setConfirmModal({ action: 'resume', member: m }) }}
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
