'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, Activity, Search, TrendingUp, Lock, Unlock } from 'lucide-react'
import { getGymTheme } from '@/lib/gymThemes'
import MemberProfileDrawer from '@/components/MemberProfileDrawer'
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

const TABS = ['active', 'frozen', 'canceled', 'overdue']

const STATUS_TEXT = {
  ACTIVE:    'text-emerald-600',
  FROZEN:    'text-blue-400/70',
  CANCELLED: 'text-zinc-500',
  OVERDUE:   'text-red-400/70',
}

const AVATAR_COLOR = 'bg-white'

function fmtStatus(status) {
  return status === 'CANCELLED' ? 'canceled' : status.toLowerCase()
}

// ── Helpers ───────────────────────────────────────────────────────────────────


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
  const { membershipBorder } = getGymTheme(gymSlug)

  const [members,  setMembers]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [fetchErr, setFetchErr] = useState(null)

  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState('active')

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

  async function handleAccessCodeSave(memberId, code) {
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/members/${memberId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ accessCode: code }),
      })
      if (!res.ok) throw new Error('Failed')
      const { member: updated } = await res.json()
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === memberId ? { ...prev, ...updated } : prev)
    } catch {
      // non-fatal
    }
  }

  // ── Fetch ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/all`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { members } = await res.json()
      setMembers(members)
      setFetchErr(null)
    } catch {
      setFetchErr('Could not load members — retrying in 30s')
    } finally {
      setLoading(false)
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

      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col p-4 md:p-5 pb-4 md:pb-5 gap-4 overflow-y-auto lg:overflow-hidden lg:min-h-0">

        {loading ? (
          <LoadingState />
        ) : fetchErr ? (
          <ErrorState message={fetchErr} onRetry={() => load({ manual: true })} />
        ) : (
          <>
            {/* Mid row — stacks vertically on mobile, side by side on lg+ */}
            <div className="flex flex-col lg:flex-row gap-4 lg:flex-[2] lg:min-h-0">
              <MemberDirectory
                members={visible}
                membershipBorder={membershipBorder}
                search={search}
                setSearch={setSearch}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onRowClick={openPanel}
                className="lg:flex-1 lg:min-h-0"
              />
              <DoorActivity
                events={doorEvents}
                loading={doorEventsLoading}
                error={doorEventsError}
                className="lg:w-80 lg:min-h-0"
              />
            </div>

            {/* Retention chart */}
            <RetentionChart data={buildChartData(members)} />
          </>
        )}

      </main>

      <MemberProfileDrawer
        member={selectedMember}
        open={panelOpen}
        membershipBorder={membershipBorder}
        onClose={closePanel}
        onStatusChange={handleStatusChange}
        onSaveAccessCode={handleAccessCodeSave}
        updating={updatingStatus}
      />

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

// ── Member directory ──────────────────────────────────────────────────────────

function MemberDirectory({ members, membershipBorder, search, setSearch, activeTab, setActiveTab, onRowClick, className = '' }) {
  return (
    <div className={`bg-white/[0.03] rounded-xl border border-white/5 lg:overflow-hidden flex flex-col ${className}`}>

      {/* Header */}
      <div className="px-5 py-3.5 border-b border-neutral-800">
        <h2 className="text-sm font-semibold text-white">member directory</h2>
      </div>

      {/* Search */}
      <div className="px-5 py-3 border-b border-neutral-800 shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="search name, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-neutral-700/50 border border-neutral-600/50 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800 px-4 shrink-0">
        {TABS.map((tab) => (
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

      {/* Table */}
      <div className="lg:overflow-y-auto lg:flex-1 overflow-x-auto">
        {members.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-neutral-600">
            no members match
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {members.map((m, i) => {
                const initials = (m.firstName?.[0] ?? '') + (m.lastName?.[0] ?? '')
                return (
                  <tr
                    key={m.id}
                    onClick={() => onRowClick(m)}
                    className={`group hover:bg-white/5 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                  >
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                          <span className="text-black font-medium text-[10px] select-none">{initials || '?'}</span>
                        </div>
                        <p className="text-white text-sm">{m.firstName} {m.lastName}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <span className="text-xs text-neutral-500">{fmtDate(statusDate(m))}</span>
                    </td>
                  </tr>
                )
              })}
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
    <div className={`bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden flex flex-col ${className}`}>
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
      <div className="lg:flex-1 lg:overflow-auto divide-y divide-neutral-800/50">
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
          events.map((ev, i) => {
            const isUnlock = ev.event?.toLowerCase().includes('unlock')
            const EventIcon = isUnlock ? Unlock : Lock
            return (
              <div key={ev.id} className={`flex items-center gap-3 px-4 py-2.5 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                <EventIcon size={13} className={`shrink-0 ${ev.ok ? 'text-emerald-500' : 'text-red-400'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white font-medium truncate">{ev.name || 'unknown'}</p>
                  <p className="text-[11px] text-neutral-500">{ev.event}</p>
                </div>
                <span className="text-[11px] text-neutral-600 shrink-0">{sinceISO(ev.createdAt)}</span>
              </div>
            )
          })
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

function RetentionChart({ data }) {
  return (
    <div className="min-h-[300px] lg:flex-1 lg:min-h-0 min-w-0 overflow-hidden bg-white/[0.03] border border-white/5 rounded-xl px-5 pt-4 pb-4 flex flex-col">
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
                <stop offset="5%"  stopColor="#10b981" stopOpacity={0.10} />
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

