'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import {
  RefreshCw,
  Activity,
  Search,
  TrendingUp,
  ArrowUpRight,
  X,
  Mail,
  Phone,
  KeyRound,
  CreditCard,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

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

function fmtStatus(status) {
  return status === 'CANCELLED' ? 'canceled' : status.toLowerCase()
}

function avatarBg(id = '') {
  const n = [...(id ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sinceLabel(date) {
  if (!date) return '—'
  const s = Math.floor((Date.now() - date) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

function sinceISO(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// Returns the most relevant date for a member row based on status
function statusDate(m) {
  if (m.status === 'FROZEN')    return m.dateFrozen   ?? m.createdAt
  if (m.status === 'CANCELLED') return m.dateCanceled ?? m.createdAt
  return m.createdAt
}

// Returns the column label for the date based on the active tab
function dateLabelFor(tab) {
  if (tab === 'frozen')   return 'frozen'
  if (tab === 'canceled') return 'canceled'
  return 'joined'
}

// Builds last-7-months chart data from the loaded members array.
function buildChartData(members) {
  const plotDate = (m) => {
    if (m.status === 'FROZEN')    return new Date(m.dateFrozen   ?? m.createdAt)
    if (m.status === 'CANCELLED') return new Date(m.dateCanceled ?? m.createdAt)
    return new Date(m.createdAt)
  }

  const now = new Date()
  return Array.from({ length: 7 }, (_, i) => {
    const d          = new Date(now.getFullYear(), now.getMonth() - (6 - i), 1)
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
    const cohort     = members.filter(m => plotDate(m) <= endOfMonth)
    return {
      month:    d.toLocaleDateString('en-US', { month: 'short' }),
      active:   cohort.filter(m => m.status === 'ACTIVE').length,
      frozen:   cohort.filter(m => m.status === 'FROZEN').length,
      canceled: cohort.filter(m => m.status === 'CANCELLED').length,
    }
  })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { gymSlug } = useParams()

  const [members,  setMembers]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [syncing,  setSyncing]  = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [fetchErr, setFetchErr] = useState(null)

  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState('all')

  const [doorEvents,        setDoorEvents]        = useState([])
  const [doorEventsLoading, setDoorEventsLoading] = useState(true)
  const [doorEventsError,   setDoorEventsError]   = useState(null)

  const [selectedMember, setSelectedMember] = useState(null)
  const [panelOpen,      setPanelOpen]      = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const timerRef     = useRef(null)
  const doorTimerRef = useRef(null)
  const closeTimer   = useRef(null)

  function openPanel(member) {
    setSelectedMember(member)
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedMember(null), 220)
  }

  async function handleStatusChange(memberId, newStatus) {
    setUpdatingStatus(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/members/${memberId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      const { member: updated } = await res.json()
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === memberId ? { ...prev, ...updated } : prev)
    } catch {
      // non-fatal — leave UI as-is
    } finally {
      setUpdatingStatus(false)
    }
  }

  // ── Fetch ───────────────────────────────────────────────────────────────

  const load = useCallback(async ({ manual = false } = {}) => {
    if (manual) setSyncing(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/all`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { members } = await res.json()
      setMembers(members)
      setLastSync(Date.now())
      setFetchErr(null)
    } catch {
      setFetchErr('Could not load members — retrying in 30s')
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [gymSlug])

  useEffect(() => {
    load()
    timerRef.current = setInterval(() => load(), 30_000)
    return () => clearInterval(timerRef.current)
  }, [load])

  const loadDoorEvents = useCallback(async () => {
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/seam/events`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { events } = await res.json()
      setDoorEvents(events)
      setDoorEventsError(null)
    } catch {
      setDoorEventsError('could not load door events')
    } finally {
      setDoorEventsLoading(false)
    }
  }, [gymSlug])

  useEffect(() => {
    loadDoorEvents()
    doorTimerRef.current = setInterval(() => loadDoorEvents(), 60_000)
    return () => clearInterval(doorTimerRef.current)
  }, [loadDoorEvents])

  // ── Derived ─────────────────────────────────────────────────────────────

  const counts = {
    all:      members.length,
    active:   members.filter(m => m.status === 'ACTIVE').length,
    frozen:   members.filter(m => m.status === 'FROZEN').length,
    canceled: members.filter(m => m.status === 'CANCELLED').length,
    overdue:  members.filter(m => m.status === 'OVERDUE').length,
  }

  const STATUS_ORDER = { ACTIVE: 0, OVERDUE: 1, FROZEN: 2, CANCELLED: 3 }

  const visible = members
    .filter(m => {
      const tabStatus = activeTab === 'canceled' ? 'cancelled' : activeTab
      const matchTab = activeTab === 'all' || m.status.toLowerCase() === tabStatus
      const q = search.trim().toLowerCase()
      const matchSearch = !q ||
        `${m.firstName} ${m.lastName} ${m.email} ${m.phone ?? ''}`.toLowerCase().includes(q)
      return matchTab && matchSearch
    })
    .sort((a, b) => {
      if (activeTab === 'all')      return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
      if (activeTab === 'frozen')   return new Date(b.dateFrozen   ?? 0) - new Date(a.dateFrozen   ?? 0)
      if (activeTab === 'canceled') return new Date(b.dateCanceled ?? 0) - new Date(a.dateCanceled ?? 0)
      return 0
    })

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-screen" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">dashboard</h1>

        <div className="flex items-center gap-4">
          {/* Sync indicator */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                syncing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'
              }`}
            />
            <span className="text-xs text-neutral-500">
              {syncing ? 'syncing…' : `synced ${sinceLabel(lastSync)}`}
            </span>
          </div>

          {/* Sync button */}
          <button
            onClick={() => load({ manual: true })}
            disabled={syncing || loading}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
            sync
          </button>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col p-4 md:p-5 pb-4 md:pb-5 gap-4 overflow-y-auto lg:overflow-hidden min-h-0">

        {loading ? (
          <LoadingState />
        ) : fetchErr ? (
          <ErrorState message={fetchErr} onRetry={() => load({ manual: true })} />
        ) : (
          <>
            {/* Metric cards — always 4 across, shrink proportionally */}
            <div className="grid grid-cols-4 gap-4 shrink-0">
              <MetricCard label="active members" value={counts.active}   color="text-emerald-400" border="border-emerald-900/30" />
              <MetricCard label="frozen"         value={counts.frozen}   color="text-sky-400"     border="border-sky-900/30" />
              <MetricCard label="canceled"       value={counts.canceled} color="text-neutral-400" border="border-neutral-700/50" />
              <MetricCard label="overdue"        value={counts.overdue}  color="text-red-400"     border="border-red-900/30" />
            </div>

            {/* Mid row — stacks vertically on mobile, side by side on lg+ */}
            <div className="flex flex-col lg:flex-row gap-4 shrink-0 lg:h-[340px]">
              <MemberDirectory
                members={visible}
                counts={counts}
                search={search}
                setSearch={setSearch}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onRowClick={openPanel}
                className="flex-1 h-[340px] lg:h-full"
              />
              <DoorActivity
                events={doorEvents}
                loading={doorEventsLoading}
                error={doorEventsError}
                className="lg:w-72 h-[340px] lg:h-full"
              />
            </div>

            {/* Retention chart — fills remaining space */}
            <RetentionChart data={buildChartData(members)} className="flex-1 min-h-[200px]" />
          </>
        )}

      </main>

      {/* ── Slide-out overlay ────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      />

      {/* ── Member profile panel ─────────────────────────────────────────── */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[380px] bg-[#171717] border-l border-neutral-800 z-50 flex flex-col shadow-2xl transition-transform duration-200 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedMember && (
          <MemberPanel
            member={selectedMember}
            onClose={closePanel}
            onStatusChange={handleStatusChange}
            updating={updatingStatus}
          />
        )}
      </div>

    </div>
  )
}

// ── Loading / error states ────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <RefreshCw size={20} className="text-neutral-600 animate-spin" />
      <p className="text-sm text-neutral-600">loading members…</p>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-sm text-red-400">{message}</p>
      <button
        onClick={onRetry}
        className="text-xs text-neutral-400 hover:text-white border border-neutral-700 rounded-lg px-3 py-1.5 transition-colors"
      >
        retry now
      </button>
    </div>
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, color, delta, border = 'border-neutral-800' }) {
  return (
    <div className={`w-full min-w-0 overflow-hidden bg-[#1c1c1c] rounded-xl border ${border} px-3 py-3`}>
      <p className="text-[9px] sm:text-[11px] font-semibold tracking-widest text-neutral-500 mb-1 sm:mb-2 truncate">{label}</p>
      <div className="flex items-end justify-between">
        <p className={`text-xl sm:text-3xl font-bold tracking-tight ${color}`}>{value}</p>
        {delta && (
          <span className="hidden sm:flex items-center gap-0.5 text-[11px] text-emerald-500 mb-1">
            <ArrowUpRight size={12} />
            {delta}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Member directory ──────────────────────────────────────────────────────────

function MemberDirectory({ members, counts, search, setSearch, activeTab, setActiveTab, onRowClick, className = '' }) {
  return (
    <div className={`bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden flex flex-col ${className}`}>

      {/* Header row */}
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-neutral-800">
        <h2 className="text-sm font-semibold text-white shrink-0">member directory</h2>
        <div className="relative w-56">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="search name, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#252525] border border-neutral-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800 px-4">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`
              py-2.5 px-2.5 mr-1 text-xs font-medium border-b-2 transition-colors
              ${activeTab === tab
                ? 'border-white text-white'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }
            `}
          >
            {tab}
            <span className={`ml-1.5 text-[10px] tabular-nums ${activeTab === tab ? 'text-neutral-400' : 'text-neutral-700'}`}>
              {counts[tab]}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-y-auto flex-1">
        {members.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-neutral-600">
            no members match
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#1c1c1c] z-10">
              <tr className="text-left border-b border-neutral-800">
                <th className="px-5 py-2.5 text-[11px] font-semibold text-neutral-500 tracking-wider">name</th>
                <th className="px-5 py-2.5 text-[11px] font-semibold text-neutral-500 tracking-wider">type</th>
                <th className="px-5 py-2.5 text-[11px] font-semibold text-neutral-500 tracking-wider">status</th>
                <th className="px-5 py-2.5 text-[11px] font-semibold text-neutral-500 tracking-wider">{dateLabelFor(activeTab)}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => onRowClick(m)}
                  className="border-b border-neutral-800/40 hover:bg-white/[0.025] transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3 text-white font-medium whitespace-nowrap">
                    {m.firstName} {m.lastName}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[m.membershipType] ?? TYPE_BADGE.GENERAL}`}>
                      {(m.membershipType ?? 'GENERAL').toLowerCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[m.status]}`}>
                      {fmtStatus(m.status)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-neutral-600 text-xs whitespace-nowrap">
                    {fmtDate(statusDate(m))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Door activity panel ───────────────────────────────────────────────────────

function DoorActivity({ events, loading, error, className = '' }) {
  return (
    <div className={`bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-neutral-800">
        <Activity size={13} className="text-neutral-400" />
        <h2 className="text-sm font-semibold text-white">door activity</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] text-emerald-500 font-medium">live</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto divide-y divide-neutral-800/50">
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <RefreshCw size={14} className="text-neutral-600 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-24 px-4 text-center">
            <p className="text-[11px] text-neutral-600">{error}</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <p className="text-[11px] text-neutral-600">no events in the last 24h</p>
          </div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${ev.ok ? 'bg-emerald-500' : 'bg-red-500'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white font-medium truncate">{ev.name}</p>
                <p className="text-[11px] text-neutral-500">{ev.event}</p>
              </div>
              <span className="text-[11px] text-neutral-600 shrink-0">{sinceISO(ev.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Retention chart ───────────────────────────────────────────────────────────

const CUSTOM_TOOLTIP = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1c1c1c] border border-neutral-800 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-neutral-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="leading-5">
          {p.name}: <span className="font-semibold text-white">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

function RetentionChart({ data, className = '' }) {
  return (
    <div className={`min-w-0 overflow-hidden bg-[#1c1c1c] rounded-xl border border-neutral-800 px-5 pt-4 pb-4 flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp size={13} className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-white">membership retention</h2>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded bg-emerald-500 inline-block" />active</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded bg-sky-500 inline-block" />frozen</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded bg-neutral-600 inline-block" />canceled</span>
          <span className="text-neutral-700">last 7 months</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 w-full overflow-hidden">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="gActive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gFrozen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gCancelled" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#525252" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#525252" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: '#737373', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#737373', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CUSTOM_TOOLTIP />} cursor={{ stroke: '#404040', strokeWidth: 1 }} />

            <Area type="monotone" dataKey="active"   name="Active"   stroke="#10b981" strokeWidth={2}   fill="url(#gActive)"    dot={false} />
            <Area type="monotone" dataKey="frozen"   name="Frozen"   stroke="#0ea5e9" strokeWidth={2}   fill="url(#gFrozen)"    dot={false} />
            <Area type="monotone" dataKey="canceled" name="Canceled" stroke="#525252" strokeWidth={1.5} fill="url(#gCancelled)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
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

function MemberPanel({ member, onClose, onStatusChange, updating }) {
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
          {member.status === 'FROZEN'    && <PanelField label="frozen"   value={fmtDate(member.dateFrozen)} />}
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
          {member.status === 'ACTIVE' && (
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
              className="w-full py-2 rounded-lg text-sm font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 transition-colors"
            >
              resume membership
            </button>
          )}
        </div>
      )}

    </div>
  )
}
