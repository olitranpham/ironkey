'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, X, Phone, KeyRound, CreditCard, Search, TrendingUp } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

// ── Design tokens ─────────────────────────────────────────────────────────────

const T = {
  bg:      '#0f0f0f',
  card:    '#1a1a1a',
  border:  'rgba(255,255,255,0.08)',
  text:    '#ffffff',
  muted:   '#555555',
  dim:     '#333333',
  active:  '#22c97a',
  overdue: '#ff5b5b',
  frozen:  '#4a9eff',
  cancel:  '#666666',
  radius:  14,
  radiusPill: 20,
}

const FONT_UI   = "'DM Sans', system-ui, sans-serif"
const FONT_MONO = "'DM Mono', 'Courier New', monospace"

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = ['all', 'active', 'frozen', 'canceled', 'overdue']

const STATUS_COLOR = {
  ACTIVE:    T.active,
  OVERDUE:   T.overdue,
  FROZEN:    T.frozen,
  CANCELLED: T.cancel,
}

const STATUS_BG = {
  ACTIVE:    'rgba(34,201,122,0.12)',
  OVERDUE:   'rgba(255,91,91,0.12)',
  FROZEN:    'rgba(74,158,255,0.12)',
  CANCELLED: 'rgba(102,102,102,0.12)',
}

const TYPE_COLOR  = { FOUNDING: '#4a9eff', GENERAL: '#888', STUDENT: '#f59e0b' }
const TYPE_BG     = { FOUNDING: 'rgba(74,158,255,0.12)', GENERAL: 'rgba(136,136,136,0.1)', STUDENT: 'rgba(245,158,11,0.12)' }

const AVATAR_PALETTE = [
  '#7c3aed','#2563eb','#059669','#d97706',
  '#dc2626','#0891b2','#ea580c','#4f46e5',
]

function avatarColor(id = '') {
  const n = [...(id ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0)
  return AVATAR_PALETTE[n % AVATAR_PALETTE.length]
}

function fmtStatus(s) { return s === 'CANCELLED' ? 'canceled' : s.toLowerCase() }

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

function statusDate(m) {
  if (m.status === 'FROZEN')    return m.dateFrozen   ?? m.createdAt
  if (m.status === 'CANCELLED') return m.dateCanceled ?? m.createdAt
  return m.createdAt
}

function buildChartData(members) {
  const plotDate = (m) => {
    if (m.status === 'FROZEN')    return new Date(m.dateFrozen   ?? m.createdAt)
    if (m.status === 'CANCELLED') return new Date(m.dateCanceled ?? m.createdAt)
    return new Date(m.createdAt)
  }
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d          = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
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

function eventDotColor(ev) {
  const e = (ev.event ?? '').toLowerCase()
  if (e.includes('unlocked') || e.includes('opened')) return T.active
  if (e.includes('code') || e.includes('access_code')) return T.frozen
  return T.muted
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

  function openPanel(member) { setSelectedMember(member); setPanelOpen(true) }
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
    } catch { /* non-fatal */ } finally { setUpdatingStatus(false) }
  }

  const load = useCallback(async ({ manual = false } = {}) => {
    if (manual) setSyncing(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/all`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`${res.status}`)
      const { members } = await res.json()
      setMembers(members)
      setLastSync(Date.now())
      setFetchErr(null)
    } catch {
      setFetchErr('Could not load members — retrying in 30s')
    } finally { setLoading(false); setSyncing(false) }
  }, [gymSlug])

  useEffect(() => {
    load()
    timerRef.current = setInterval(() => load(), 30_000)
    return () => clearInterval(timerRef.current)
  }, [load])

  const loadDoorEvents = useCallback(async () => {
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/seam/events`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`${res.status}`)
      const { events } = await res.json()
      setDoorEvents(events)
      setDoorEventsError(null)
    } catch { setDoorEventsError('could not load door events') }
    finally { setDoorEventsLoading(false) }
  }, [gymSlug])

  useEffect(() => {
    loadDoorEvents()
    doorTimerRef.current = setInterval(() => loadDoorEvents(), 60_000)
    return () => clearInterval(doorTimerRef.current)
  }, [loadDoorEvents])

  // ── Derived ──────────────────────────────────────────────────────────────

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
      const matchTab  = activeTab === 'all' || m.status.toLowerCase() === tabStatus
      const q = search.trim().toLowerCase()
      const matchSearch = !q || `${m.firstName} ${m.lastName} ${m.email} ${m.phone ?? ''}`.toLowerCase().includes(q)
      return matchTab && matchSearch
    })
    .sort((a, b) => {
      if (activeTab === 'all')      return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
      if (activeTab === 'frozen')   return new Date(b.dateFrozen   ?? 0) - new Date(a.dateFrozen   ?? 0)
      if (activeTab === 'canceled') return new Date(b.dateCanceled ?? 0) - new Date(a.dateCanceled ?? 0)
      return 0
    })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: FONT_UI, background: T.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <header style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: `1px solid ${T.border}`, background: T.card, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: T.text, letterSpacing: '-0.02em' }}>
          dashboard
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.muted }}>
            {syncing ? 'syncing…' : `synced ${sinceLabel(lastSync)}`}
          </span>
          <button
            onClick={() => load({ manual: true })}
            disabled={syncing || loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, background: 'transparent',
              border: `1px solid ${T.border}`, borderRadius: 8, padding: '5px 10px',
              fontSize: 11, color: T.muted, cursor: 'pointer', fontFamily: FONT_UI,
            }}
          >
            <RefreshCw size={10} style={syncing ? { animation: 'spin 1s linear infinite' } : {}} />
            sync
          </button>
        </div>
      </header>

      {/* Body */}
      <main style={{ flex: 1, padding: '14px 14px 24px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: T.muted }}>
            <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>loading…</span>
          </div>
        ) : fetchErr ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10 }}>
            <span style={{ fontSize: 13, color: T.overdue }}>{fetchErr}</span>
            <button onClick={() => load({ manual: true })} style={{ fontSize: 11, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 8, padding: '5px 12px', background: 'none', cursor: 'pointer' }}>
              retry
            </button>
          </div>
        ) : (
          <>
            {/* ── Stats 2×2 ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <StatCard label="active"   value={counts.active}   color={T.active}  sub="billing on time" />
              <StatCard label="overdue"  value={counts.overdue}  color={T.overdue} sub="needs attention" />
              <StatCard label="frozen"   value={counts.frozen}   color={T.frozen}  sub="paused billing" />
              <StatCard label="canceled" value={counts.canceled} color={T.cancel}  sub="ended" />
            </div>

            {/* ── Member directory ── */}
            <MemberDirectory
              members={visible}
              counts={counts}
              search={search}
              setSearch={setSearch}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onRowClick={openPanel}
            />

            {/* ── Door activity ── */}
            <DoorActivity
              events={doorEvents}
              loading={doorEventsLoading}
              error={doorEventsError}
            />

            {/* ── Retention chart ── */}
            <RetentionChart data={buildChartData(members)} />
          </>
        )}
      </main>

      {/* Overlay */}
      <div
        onClick={closePanel}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 40,
          opacity: panelOpen ? 1 : 0, pointerEvents: panelOpen ? 'auto' : 'none',
          transition: 'opacity 200ms',
        }}
      />

      {/* Member panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '100%', maxWidth: 420,
        background: '#141414', borderLeft: `1px solid ${T.border}`,
        zIndex: 50, display: 'flex', flexDirection: 'column',
        transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms',
        fontFamily: FONT_UI,
      }}>
        {selectedMember && (
          <MemberPanel
            member={selectedMember}
            onClose={closePanel}
            onStatusChange={handleStatusChange}
            updating={updatingStatus}
          />
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
      `}</style>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}`,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 36, fontWeight: 500, color, lineHeight: 1, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: T.dim }}>
        {sub}
      </div>
    </div>
  )
}

// ── Member directory ──────────────────────────────────────────────────────────

function MemberDirectory({ members, counts, search, setSearch, activeTab, setActiveTab, onRowClick }) {
  return (
    <div style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}`, overflow: 'hidden' }}>

      {/* Search */}
      <div style={{ padding: '12px 14px 10px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: T.muted, pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', background: '#111', border: `1px solid ${T.border}`,
              borderRadius: 10, padding: '8px 12px 8px 30px',
              fontSize: 13, color: T.text, fontFamily: FONT_UI,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Pill tabs */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 14px 12px', scrollbarWidth: 'none' }}>
        {TABS.map(tab => {
          const active = tab === activeTab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: T.radiusPill,
                border: `1px solid ${active ? 'rgba(255,255,255,0.2)' : T.border}`,
                background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                fontSize: 12, fontWeight: active ? 600 : 400,
                color: active ? T.text : T.muted,
                cursor: 'pointer', fontFamily: FONT_UI, whiteSpace: 'nowrap',
              }}
            >
              {tab}
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: active ? T.muted : T.dim }}>
                {counts[tab]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Member rows */}
      <div style={{ borderTop: `1px solid ${T.border}` }}>
        {members.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, fontSize: 13, color: T.dim }}>
            no members match
          </div>
        ) : members.map(m => {
          const initials = (m.firstName?.[0] ?? '') + (m.lastName?.[0] ?? '')
          const bg       = avatarColor(m.id)
          return (
            <div
              key={m.id}
              onClick={() => onRowClick(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 14px', borderBottom: `1px solid ${T.border}`,
                cursor: 'pointer',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: '#fff', letterSpacing: '-0.01em' }}>
                  {initials || '?'}
                </span>
              </div>

              {/* Name + type + email */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.firstName} {m.lastName}
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 1, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                  <span style={{
                    color: TYPE_COLOR[m.membershipType] ?? TYPE_COLOR.GENERAL,
                    background: TYPE_BG[m.membershipType] ?? TYPE_BG.GENERAL,
                    borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 600, flexShrink: 0,
                  }}>
                    {(m.membershipType ?? 'general').toLowerCase()}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</span>
                </div>
              </div>

              {/* Status pill */}
              <span style={{
                flexShrink: 0, fontSize: 10, fontWeight: 600,
                color: STATUS_COLOR[m.status], background: STATUS_BG[m.status],
                borderRadius: T.radiusPill, padding: '3px 9px',
              }}>
                {fmtStatus(m.status)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Door activity ─────────────────────────────────────────────────────────────

function DoorActivity({ events, loading, error }) {
  return (
    <div style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}`, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>live feed</span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(34,201,122,0.12)', borderRadius: T.radiusPill,
            padding: '2px 8px',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.active, display: 'inline-block', animation: 'pulse 2s infinite' }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: 500, color: T.active }}>LIVE</span>
          </span>
        </div>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.dim }}>last 24h</span>
      </div>

      {/* Events */}
      <div>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 70, gap: 8, color: T.muted }}>
            <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : error ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 70, fontSize: 12, color: T.dim }}>
            {error}
          </div>
        ) : events.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 70, fontSize: 12, color: T.dim }}>
            no events yet
          </div>
        ) : events.map(ev => (
          <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${T.border}` }}>
            {/* Dot */}
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: eventDotColor(ev), flexShrink: 0 }} />
            {/* Name + event */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {ev.name || '—'}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>{ev.event}</div>
            </div>
            {/* Timestamp */}
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.dim, flexShrink: 0 }}>
              {sinceISO(ev.createdAt)}
            </span>
          </div>
        ))}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  )
}

// ── Retention chart ───────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1e1e1e', border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 12px', fontSize: 11, fontFamily: FONT_UI }}>
      <p style={{ color: T.muted, marginBottom: 4, fontWeight: 600 }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: <span style={{ color: T.text, fontWeight: 700 }}>{p.value}</span>
        </p>
      ))}
    </div>
  )
}

function RetentionChart({ data }) {
  return (
    <div style={{ background: T.card, borderRadius: T.radius, border: `1px solid ${T.border}`, padding: '14px 14px 10px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <TrendingUp size={12} color={T.muted} />
          <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>membership retention</span>
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: T.muted }}>
          {[['#22c97a','active'],['#4a9eff','frozen'],['#555','canceled']].map(([c,l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 2, background: c, borderRadius: 2, display: 'inline-block' }} />
              {l}
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22c97a" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#22c97a" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gF" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#4a9eff" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#4a9eff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#555" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#555" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: T.muted, fontSize: 10, fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: T.muted, fontSize: 10, fontFamily: FONT_MONO }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: T.border, strokeWidth: 1 }} />
            <Area type="monotone" dataKey="active"   name="Active"   stroke="#22c97a" strokeWidth={1.5} fill="url(#gA)" dot={false} />
            <Area type="monotone" dataKey="frozen"   name="Frozen"   stroke="#4a9eff" strokeWidth={1.5} fill="url(#gF)" dot={false} />
            <Area type="monotone" dataKey="canceled" name="Canceled" stroke="#555555" strokeWidth={1}   fill="url(#gC)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Member panel ──────────────────────────────────────────────────────────────

function PanelField({ label, value, mono = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, color: T.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: T.text, fontFamily: mono ? FONT_MONO : FONT_UI, textAlign: 'right', marginLeft: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
        {value || '—'}
      </span>
    </div>
  )
}

function PanelSection({ icon: Icon, title, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon size={11} color={T.dim} />
        <span style={{ fontSize: 10, fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
      </div>
      <div style={{ background: '#1a1a1a', borderRadius: 10, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function MemberPanel({ member, onClose, onStatusChange, updating }) {
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '')
  const bg       = avatarColor(member.id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT_UI }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 52, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: T.text }}>member profile</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: T.muted }}>
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingBottom: 4 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontWeight: 800, fontSize: 22, color: '#fff', letterSpacing: '-0.02em' }}>{initials || '?'}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: T.text }}>{member.firstName} {member.lastName}</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>member</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[member.status], background: STATUS_BG[member.status], borderRadius: T.radiusPill, padding: '3px 10px' }}>
              {fmtStatus(member.status)}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: TYPE_COLOR[member.membershipType] ?? TYPE_COLOR.GENERAL, background: TYPE_BG[member.membershipType] ?? TYPE_BG.GENERAL, borderRadius: T.radiusPill, padding: '3px 10px' }}>
              {(member.membershipType ?? 'general').toLowerCase()}
            </span>
          </div>
        </div>

        <PanelSection icon={Phone} title="contact">
          <PanelField label="email" value={member.email} />
          <PanelField label="phone" value={member.phone} />
        </PanelSection>

        <PanelSection icon={KeyRound} title="membership">
          <PanelField label="access id" value={member.accessCode} mono />
          <PanelField label="joined"    value={fmtDate(member.createdAt)} />
          {member.status === 'FROZEN'    && <PanelField label="frozen"   value={fmtDate(member.dateFrozen)} />}
          {member.status === 'CANCELLED' && <PanelField label="canceled" value={fmtDate(member.dateCanceled)} />}
        </PanelSection>

        {(member.stripeCustomerId || member.stripeSubscriptionId) && (
          <PanelSection icon={CreditCard} title="stripe">
            <PanelField label="customer id"     value={member.stripeCustomerId}     mono />
            <PanelField label="subscription id" value={member.stripeSubscriptionId} mono />
          </PanelSection>
        )}

      </div>

      {/* Actions */}
      {member.status !== 'CANCELLED' && (
        <div style={{ flexShrink: 0, padding: '14px 16px', borderTop: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {member.status === 'ACTIVE' && (
            <>
              <button onClick={() => onStatusChange(member.id, 'FROZEN')} disabled={updating} style={{ width: '100%', padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: T.frozen, background: 'rgba(74,158,255,0.1)', border: 'none', cursor: 'pointer', fontFamily: FONT_UI, opacity: updating ? 0.4 : 1 }}>
                freeze membership
              </button>
              <button onClick={() => onStatusChange(member.id, 'CANCELLED')} disabled={updating} style={{ width: '100%', padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: T.overdue, background: 'rgba(255,91,91,0.1)', border: 'none', cursor: 'pointer', fontFamily: FONT_UI, opacity: updating ? 0.4 : 1 }}>
                cancel membership
              </button>
            </>
          )}
          {member.status === 'FROZEN' && (
            <button onClick={() => onStatusChange(member.id, 'ACTIVE')} disabled={updating} style={{ width: '100%', padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: T.active, background: 'rgba(34,201,122,0.1)', border: 'none', cursor: 'pointer', fontFamily: FONT_UI, opacity: updating ? 0.4 : 1 }}>
              resume membership
            </button>
          )}
        </div>
      )}
    </div>
  )
}
