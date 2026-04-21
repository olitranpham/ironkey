'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw, X, KeyRound, Phone } from 'lucide-react'
import { getAllowedPassTypes } from '@/lib/gymPassTypes'

// ── Constants ─────────────────────────────────────────────────────────────────

const PASS_TYPE_LABEL = {
  SINGLE:     'single',
  THREE_PACK: '3-pack',
  FIVE_PACK:  '5-pack',
  TEN_PACK:   '10-pack',
  VALUE:      'value',
  DELUXE:     'deluxe',
}

const PASS_TYPE_BADGE = {
  SINGLE:     'bg-neutral-500/15 text-neutral-400',
  THREE_PACK: 'bg-violet-500/15 text-violet-400',
  FIVE_PACK:  'bg-blue-500/15 text-blue-400',
  TEN_PACK:   'bg-emerald-500/15 text-emerald-400',
  VALUE:      'bg-amber-500/15 text-amber-400',
  DELUXE:     'bg-rose-500/15 text-rose-400',
}

const PASS_TABS     = ['all', 'single', '3-pack', '5-pack', '10-pack', 'value', 'deluxe']
const PASS_TAB_TYPE = {
  all:       null,
  single:    'SINGLE',
  '3-pack':  'THREE_PACK',
  '5-pack':  'FIVE_PACK',
  '10-pack': 'TEN_PACK',
  value:     'VALUE',
  deluxe:    'DELUXE',
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500',   'bg-cyan-500', 'bg-orange-500',  'bg-indigo-500',
]

function avatarBg(id = '') {
  const n = [...(id ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

function normName(s) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

const PASS_TYPE_INITIAL = {
  SINGLE:     1,
  VALUE:      1,
  DELUXE:     1,
  THREE_PACK: 3,
  FIVE_PACK:  5,
  TEN_PACK:   10,
}

function totalVisits(guest) {
  return guest.passes.reduce((sum, p) => {
    const initial = PASS_TYPE_INITIAL[p.passType] ?? 1
    if (initial === 1) return sum + 1
    const used = p.passesLeft != null ? initial - p.passesLeft : initial
    return sum + used
  }, 0)
}

function mostRecentPassType(guest) {
  if (!guest.passes.length) return null
  // passes sorted desc by usedAt from API; find most recent by date
  const sorted = [...guest.passes].sort(
    (a, b) => new Date(b.usedAt ?? b.createdAt) - new Date(a.usedAt ?? a.createdAt)
  )
  return sorted[0].passType
}

function passesLeftSummary(guest) {
  const packs = guest.passes.filter(p => p.passesLeft != null && p.passesLeft > 0)
  if (!packs.length) return null
  return packs.reduce((sum, p) => sum + p.passesLeft, 0)
}

function lastSeenDate(guest) {
  if (!guest.passes.length) return null
  return guest.passes.reduce((latest, p) => {
    const d = p.usedAt ?? p.createdAt
    if (!latest) return d
    return new Date(d) > new Date(latest) ? d : latest
  }, null)
}

/**
 * Find the best name match in a Map<normName, guest>.
 * 1. Exact normalized match
 * 2. Prefix match: "marc" ↔ "marc lhaubouet" (one is a word-prefix of the other)
 */
function findNameMatch(byName, norm) {
  if (byName.has(norm)) return byName.get(norm)
  for (const [key, g] of byName) {
    if (key.startsWith(norm + ' ') || norm.startsWith(key + ' ')) return g
  }
  return null
}

/**
 * Merge profiles + unlinked into a single deduplicated list.
 * Priority: email match → exact name match → prefix name match → new name bucket.
 */
function buildUnifiedGuests(profiles, unlinked) {
  const guests = profiles.map(p => ({
    ...p,
    passes:    [...p.passes],
    _unlinked: false,
  }))

  const byEmail = new Map()
  const byName  = new Map()
  guests.forEach(g => {
    if (g.email) byEmail.set(g.email.toLowerCase(), g)
    byName.set(normName(g.name), g)
  })

  // Name buckets for unlinked passes that don't match any existing guest
  const nameBuckets = new Map()

  for (const pass of unlinked) {
    const email = (pass.guestEmail ?? '').toLowerCase()
    const norm  = normName(pass.guestName)

    // 1. Email match
    if (email && byEmail.has(email)) {
      byEmail.get(email).passes.push(pass)
      continue
    }
    // 2. Name match (exact or prefix) against existing profiles
    const nameHit = findNameMatch(byName, norm)
    if (nameHit) {
      nameHit.passes.push(pass)
      continue
    }
    // 3. Name match against already-created name buckets
    const bucketHit = findNameMatch(nameBuckets, norm)
    if (bucketHit) {
      bucketHit.passes.push(pass)
      continue
    }
    // 4. New name bucket
    nameBuckets.set(norm, {
      id:         `_name_${norm}`,
      name:       pass.guestName,
      email:      pass.guestEmail ?? null,
      phone:      pass.guestPhone ?? null,
      accessCode: null,
      passes:     [pass],
      _unlinked:  true,
    })
  }

  return [...guests, ...nameBuckets.values()]
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GuestPassesPage() {
  const { gymSlug } = useParams()

  const [profiles,  setProfiles]  = useState([])
  const [unlinked,  setUnlinked]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [fetchErr,  setFetchErr]  = useState(null)
  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState('all')

  const [selectedProfile, setSelectedProfile] = useState(null)
  const [panelOpen,       setPanelOpen]       = useState(false)
  const [savingCode,      setSavingCode]      = useState(false)
  const closeTimer = useRef(null)

  const fetchPasses = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/guest-passes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setProfiles(data.profiles ?? [])
      setUnlinked(data.unlinked ?? [])
      setFetchErr(null)
    } catch {
      setFetchErr('could not load guest passes')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchPasses() }, [fetchPasses])

  function openPanel(profile) {
    console.log('[guest-passes] row clicked, opening panel for:', profile.name, profile.email)
    setSelectedProfile(profile)
    setPanelOpen(true)
  }
  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedProfile(null), 220)
  }

  async function saveAccessCode(profileId, code) {
    setSavingCode(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/guest-passes/profiles/${profileId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ accessCode: code }),
      })
      if (!res.ok) throw new Error('Failed')
      const { profile: updated } = await res.json()
      setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, ...updated } : p))
      setSelectedProfile(prev => prev?.id === profileId ? { ...prev, ...updated } : prev)
    } catch {
      // non-fatal
    } finally {
      setSavingCode(false)
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────

  const unified     = buildUnifiedGuests(profiles, unlinked)
  const allPasses   = unified.flatMap(g => g.passes)
  const typeFilter  = PASS_TAB_TYPE[activeTab]

  // Map allowed enum values (e.g. 'THREE_PACK') back to tab keys (e.g. '3-pack')
  const TYPE_TO_TAB = Object.fromEntries(Object.entries(PASS_TAB_TYPE).map(([k, v]) => [v, k]))
  const allowedTypes = getAllowedPassTypes(gymSlug)
  const visibleTabs  = ['all', ...allowedTypes.map(t => TYPE_TO_TAB[t]).filter(Boolean)]

  // Metric card counts — all pass record totals
  const passCounts = {
    total:     allPasses.length,
    single:    allPasses.filter(p => p.passType === 'SINGLE').length,
    '3-pack':  allPasses.filter(p => p.passType === 'THREE_PACK').length,
    '5-pack':  allPasses.filter(p => p.passType === 'FIVE_PACK').length,
    '10-pack': allPasses.filter(p => p.passType === 'TEN_PACK').length,
    value:     allPasses.filter(p => p.passType === 'VALUE').length,
    deluxe:    allPasses.filter(p => p.passType === 'DELUXE').length,
  }

  // Tab pill counts — unique guests per type
  const counts = {
    all:       unified.length,
    single:    unified.filter(g => g.passes.some(p => p.passType === 'SINGLE')).length,
    '3-pack':  unified.filter(g => g.passes.some(p => p.passType === 'THREE_PACK')).length,
    '5-pack':  unified.filter(g => g.passes.some(p => p.passType === 'FIVE_PACK')).length,
    '10-pack': unified.filter(g => g.passes.some(p => p.passType === 'TEN_PACK')).length,
    value:     unified.filter(g => g.passes.some(p => p.passType === 'VALUE')).length,
    deluxe:    unified.filter(g => g.passes.some(p => p.passType === 'DELUXE')).length,
  }

  const visible = unified
    .filter(g => {
      const q           = search.trim().toLowerCase()
      const matchSearch = !q || `${g.name} ${g.email ?? ''}`.toLowerCase().includes(q)
      const matchTab    = !typeFilter || g.passes.some(p => p.passType === typeFilter)
      return matchSearch && matchTab
    })
    .sort((a, b) => {
      const da = lastSeenDate(a)
      const db = lastSeenDate(b)
      if (!da && !db) return 0
      if (!da) return 1
      if (!db) return -1
      return new Date(db) - new Date(da)
    })

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">guest passes</h1>
        <button
          onClick={fetchPasses}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          refresh
        </button>
      </header>

      <main className="flex-1 flex flex-col p-5 gap-4 overflow-hidden min-h-0">

        {/* Metric cards */}
        <div className="shrink-0 grid gap-3" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}>
          {[
            { label: 'total passes', key: 'all' },
            { label: 'single',       key: 'single' },
            { label: '3-pack',       key: '3-pack' },
            { label: '5-pack',       key: '5-pack' },
            { label: '10-pack',      key: '10-pack' },
            { label: 'value',        key: 'value' },
            { label: 'deluxe',       key: 'deluxe' },
          ].filter(c => c.key === 'all' || visibleTabs.includes(c.key))
           .map(({ label, key }) => {
            const value = key === 'all' ? passCounts.total : passCounts[key]
            return (
            <div key={label} className="bg-[#1c1c1c] rounded-xl border border-neutral-800 px-4 py-3">
              <p className="text-[11px] text-neutral-500 mb-1">{label}</p>
              <p className="text-xl font-semibold text-white tabular-nums">
                {loading ? '—' : value}
              </p>
            </div>
          )})}
        </div>

        {/* Search */}
        <div className="shrink-0 relative w-80">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1c1c1c] border border-neutral-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
          />
        </div>

        {/* Table card */}
        <div className="flex-1 flex flex-col bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden min-h-0">

          {/* Tabs */}
          <div className="flex border-b border-neutral-800 px-4 shrink-0">
            {visibleTabs.map(tab => (
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
                <button onClick={fetchPasses} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                  retry
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-neutral-600">no guests match</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#1c1c1c] z-10">
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">name</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">email</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">last pass type</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">passes left</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">visits</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">access code</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(g => {
                    const left     = passesLeftSummary(g)
                    const lastType = mostRecentPassType(g)
                    return (
                      <tr
                        key={g.id}
                        onClick={() => openPanel(g)}
                        className="border-b border-neutral-800/40 hover:bg-white/[0.025] transition-colors cursor-pointer"
                      >
                        <td className="px-5 py-3 text-white text-sm font-medium">{g.name}</td>
                        <td className="px-5 py-3 text-neutral-500 text-xs">{g.email || '—'}</td>
                        <td className="px-5 py-3">
                          {lastType ? (
                            <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${PASS_TYPE_BADGE[lastType]}`}>
                              {PASS_TYPE_LABEL[lastType]}
                            </span>
                          ) : <span className="text-neutral-600 text-xs">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          {left === null ? (
                            <span className="text-neutral-600 text-xs">—</span>
                          ) : left === 0 ? (
                            <span className="text-red-400 text-xs font-medium">used out</span>
                          ) : (
                            <span className="text-white text-xs">{left} left</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-neutral-400 text-xs tabular-nums">{totalVisits(g)}</td>
                        <td className="px-5 py-3 text-xs text-neutral-400">{g.accessCode || '—'}</td>
                        <td className="px-5 py-3 text-neutral-600 text-xs whitespace-nowrap">
                          {fmtDate(lastSeenDate(g))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </main>

      {/* ── Overlay ───────────────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-black/60 z-[100] transition-opacity duration-200 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      />

      {/* ── Profile panel ─────────────────────────────────────────────────── */}
      <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }} className={`fixed inset-y-0 right-0 w-full sm:w-[420px] bg-[#171717] border-l border-neutral-800 z-[110] flex flex-col shadow-2xl transition-transform duration-200 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedProfile && (
          <GuestProfilePanel
            profile={selectedProfile}
            onClose={closePanel}
            onSaveCode={saveAccessCode}
            saving={savingCode}
          />
        )}
      </div>

    </div>
  )
}

// ── Guest Profile Panel ───────────────────────────────────────────────────────

function GuestProfilePanel({ profile, onClose, onSaveCode, saving }) {
  const [codeInput, setCodeInput] = useState(profile.accessCode ?? '')
  const visits     = totalVisits(profile)
  const isUnlinked = profile._unlinked === true
  const nameParts  = profile.name.trim().split(/\s+/)
  const initials   = (nameParts[0]?.[0] ?? '') + (nameParts[1]?.[0] ?? '')
  const color      = avatarBg(profile.id)

  function handleSave() {
    onSaveCode(profile.id, codeInput.trim())
  }

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
        <p className="text-sm font-semibold text-white">guest profile</p>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Identity */}
        <div className="flex flex-col items-center text-center gap-3 pt-1 pb-2">
          <div className={`w-[60px] h-[60px] rounded-full flex items-center justify-center shrink-0 ${color}`}>
            <span className="text-white font-bold text-lg tracking-tight select-none">
              {initials.toUpperCase() || '?'}
            </span>
          </div>
          <div>
            <p className="text-white font-semibold text-base leading-tight">{profile.name}</p>
            <p className="text-neutral-500 text-xs mt-0.5">{profile.email}</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span><span className="text-white font-semibold">{visits}</span> total visits</span>
            <span><span className="text-white font-semibold">{profile.passes.length}</span> passes</span>
          </div>
        </div>

        {/* Contact */}
        <Section icon={Phone} title="contact">
          <Field label="email" value={profile.email} />
          <Field label="phone" value={profile.phone} />
        </Section>

        {/* Access code */}
        <Section icon={KeyRound} title="access code">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-[#1c1c1c]">
            <input
              type="text"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              placeholder={isUnlinked ? 'no profile linked' : 'enter PIN…'}
              disabled={isUnlinked}
              className="flex-1 bg-transparent text-xs text-white placeholder-neutral-600 focus:outline-none disabled:opacity-40"
            />
            {!isUnlinked && (
              <button
                onClick={handleSave}
                disabled={saving || codeInput.trim() === (profile.accessCode ?? '')}
                className="text-[11px] px-2.5 py-1 rounded-md bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {saving ? 'saving…' : 'save'}
              </button>
            )}
          </div>
        </Section>

        {/* Pass history */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-[11px] font-semibold tracking-widest text-neutral-600">PASS HISTORY</p>
          </div>
          <div className="rounded-lg border border-neutral-800 overflow-hidden">
            {profile.passes.length === 0 ? (
              <p className="px-3 py-3 text-xs text-neutral-600">no passes yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left bg-[#1c1c1c]">
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-600 tracking-wider">type</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-600 tracking-wider">left</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-600 tracking-wider">purchased</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {profile.passes.map(p => (
                    <tr key={p.id} className="bg-[#1c1c1c]">
                      <td className="px-3 py-2.5">
                        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${PASS_TYPE_BADGE[p.passType]}`}>
                          {PASS_TYPE_LABEL[p.passType]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-400 tabular-nums">
                        {p.passesLeft === null || p.passesLeft === undefined
                          ? '—'
                          : p.passesLeft === 0
                            ? <span className="text-red-400">used</span>
                            : p.passesLeft}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-500 whitespace-nowrap">{fmtDate(p.usedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

function Section({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={11} className="text-neutral-600" />
        <p className="text-[11px] font-semibold tracking-widest text-neutral-600">{title.toUpperCase()}</p>
      </div>
      <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-neutral-500 shrink-0">{label}</span>
      <span className="text-xs text-white text-right ml-4 truncate max-w-[240px]">{value || '—'}</span>
    </div>
  )
}
