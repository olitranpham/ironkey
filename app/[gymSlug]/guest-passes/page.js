'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw, X, KeyRound, Phone, TrendingUp, User, ShieldAlert } from 'lucide-react'
import { formatPhone } from '@/lib/phone'
import { getGymTheme } from '@/lib/gymThemes'
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

const PASS_TYPE_LABEL = {
  SINGLE:     'single',
  THREE_PACK: '3-pack',
  FIVE_PACK:  '5-pack',
  TEN_PACK:   '10-pack',
  VALUE:      'value',
  DELUXE:     'deluxe',
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
}

// Returns 'YYYY-MM' for a pass record using createdAt as the purchase month
function passMonth(pass) {
  const raw = pass.usedAt ?? pass.createdAt
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toLowerCase()
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
  const { passTypeBorder } = getGymTheme(gymSlug)

  const [profiles,    setProfiles]    = useState([])
  const [unlinked,    setUnlinked]    = useState([])
  const [totalCount,  setTotalCount]  = useState(null)
  const [countByType, setCountByType] = useState({})
  const [loading,     setLoading]     = useState(true)
  const [fetchErr,    setFetchErr]    = useState(null)
  const [statsData,   setStatsData]   = useState([])
  const [search,      setSearch]      = useState('')
  const [activeTab,   setActiveTab]   = useState('all')
  const [monthFilter, setMonthFilter] = useState('')

  const [selectedProfile, setSelectedProfile] = useState(null)
  const [panelOpen,       setPanelOpen]       = useState(false)
  const [savingCode,      setSavingCode]      = useState(false)
  const closeTimer = useRef(null)

  useEffect(() => {
    document.body.style.overflow = panelOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [panelOpen])

  const fetchPasses = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const [passRes, statsRes] = await Promise.all([
        fetch(`/api/${gymSlug}/guest-passes`,       { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/${gymSlug}/guest-passes/stats`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!passRes.ok) throw new Error(`${passRes.status}`)
      const data  = await passRes.json()
      setProfiles(data.profiles ?? [])
      setUnlinked(data.unlinked ?? [])
      setTotalCount(data.totalCount ?? null)
      setCountByType(data.countByType ?? {})
      setFetchErr(null)
      if (statsRes.ok) {
        const stats = await statsRes.json()
        setStatsData(stats.data ?? [])
      }
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

  async function saveProfileFields(profileId, fields) {
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/guest-passes/profiles/${profileId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(fields),
      })
      if (!res.ok) throw new Error('Failed')
      const { profile: updated } = await res.json()
      setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, ...updated } : p))
      setSelectedProfile(prev => prev?.id === profileId ? { ...prev, ...updated } : prev)
    } catch {
      // non-fatal
    }
  }

  async function savePassesLeft(passId, passesLeft, profileId) {
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/guest-passes/${passId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ passesLeft }),
      })
      if (!res.ok) throw new Error('Failed')
      const { pass: updated } = await res.json()
      // Update the specific pass inside the matching profile
      const patchPasses = passes =>
        passes.map(p => p.id === passId ? { ...p, passesLeft: updated.passesLeft } : p)
      setProfiles(prev =>
        prev.map(p => p.id === profileId ? { ...p, passes: patchPasses(p.passes) } : p)
      )
      setSelectedProfile(prev =>
        prev?.id === profileId ? { ...prev, passes: patchPasses(prev.passes) } : prev
      )
      return updated
    } catch (err) {
      console.error('[savePassesLeft]', err.message)
      throw err
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────

  const unified     = buildUnifiedGuests(profiles, unlinked)
  const allPasses   = unified.flatMap(g => g.passes)
  const typeFilter  = PASS_TAB_TYPE[activeTab]

  // Map enum values (e.g. 'THREE_PACK') back to tab keys (e.g. '3-pack')
  const TYPE_TO_TAB = Object.fromEntries(Object.entries(PASS_TAB_TYPE).map(([k, v]) => [v, k]))

  // Build filter tabs from pass types actually present in the data
  const presentTypes = [...new Set(allPasses.map(p => p.passType))]
  const visibleTabs  = ['all', ...PASS_TABS.slice(1).filter(tab => {
    const type = PASS_TAB_TYPE[tab]
    return type && presentTypes.includes(type)
  })]

  // Months present across all passes (unfiltered), sorted most recent first
  const availableMonths = [...new Set(allPasses.map(passMonth).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))

  // When a month is selected, trim each guest's passes to only those in that month.
  // A guest with 14 passes across many months only appears in the month(s) where
  // they have a pass with usedAt in that month — and only with those passes.
  const guestsForView = monthFilter
    ? unified
        .map(g => ({ ...g, passes: g.passes.filter(p => passMonth(p) === monthFilter) }))
        .filter(g => g.passes.length > 0)
    : unified

  const visible = guestsForView
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

  const visiblePassCount = visible.reduce((sum, g) => {
    const passes = typeFilter ? g.passes.filter(p => p.passType === typeFilter) : g.passes
    return sum + passes.length
  }, 0)

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-white">guest passes</h1>
          {!loading && (
            <span className="text-sm font-normal text-white opacity-40 tabular-nums">
            {!search.trim() && !monthFilter && totalCount != null
              ? (activeTab === 'all' ? totalCount : (countByType[PASS_TAB_TYPE[activeTab]] ?? 0))
              : visiblePassCount}
          </span>
          )}
        </div>
      </header>

      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Trend chart */}
        {statsData.length > 0 && <GuestPassTrendChart data={statsData} />}

        {/* Search + month filter */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          <div className="relative w-80">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              type="text"
              placeholder="search name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-neutral-700/50 border border-neutral-600/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
            />
          </div>
          {availableMonths.length > 0 && (
            <select
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="bg-neutral-700/50 border border-neutral-600/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors appearance-none pr-7 cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              <option value="">all time</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{fmtMonth(m)}</option>
              ))}
            </select>
          )}
        </div>

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">

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
                <tbody>
                  {visible.map((g, i) => {
                    const left     = passesLeftSummary(g)
                    const lastType = mostRecentPassType(g)
                    return (
                      <tr
                        key={g.id}
                        onClick={() => openPanel(g)}
                        className={`group hover:bg-white/5 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                      >
                        {/* Name + avatar */}
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                              <span className="text-black font-medium text-[10px] select-none">
                                {g.name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                              </span>
                            </div>
                            <p className="text-white text-sm leading-tight">{g.name}</p>
                          </div>
                        </td>

                        {/* Last seen date */}
                        <td className="px-5 py-3 text-right">
                          <span className="text-xs text-neutral-500">
                            {fmtDate(lastSeenDate(g))}
                          </span>
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
            passTypeBorder={passTypeBorder}
            onClose={closePanel}
            onSaveCode={saveAccessCode}
            saving={savingCode}
            onSavePassesLeft={(passId, passesLeft) => savePassesLeft(passId, passesLeft, selectedProfile.id)}
            onSaveProfile={(fields) => saveProfileFields(selectedProfile.id, fields)}
          />
        )}
      </div>

    </div>
  )
}

// ── Guest Profile Panel ───────────────────────────────────────────────────────

function GuestProfilePanel({ profile, passTypeBorder, onClose, onSaveCode, saving, onSavePassesLeft, onSaveProfile }) {
  const [codeInput,    setCodeInput]    = useState(profile.accessCode ?? '')
  const [passEdits,    setPassEdits]    = useState({})
  const [savingPassId, setSavingPassId] = useState(null)

  // Contact
  const [nameInput,  setNameInput]  = useState(profile.name  ?? '')
  const [emailInput, setEmailInput] = useState(profile.email ?? '')
  const [phoneInput, setPhoneInput] = useState(profile.phone ?? '')

  // Personal info
  const [dobInput,  setDobInput]  = useState(profile.dateOfBirth ?? '')
  const [addrInput, setAddrInput] = useState(profile.address     ?? '')

  // Emergency contact
  const [ecNameInput, setEcNameInput] = useState(profile.emergencyContactName         ?? '')
  const [ecPhoneInput, setEcPhoneInput] = useState(profile.emergencyContactPhone      ?? '')
  const [ecRelInput,  setEcRelInput]  = useState(profile.emergencyContactRelationship ?? '')

  const visits     = totalVisits(profile)
  const isUnlinked = profile._unlinked === true
  const nameParts  = profile.name.trim().split(/\s+/)
  const initials   = (nameParts[0]?.[0] ?? '') + (nameParts[1]?.[0] ?? '')

  useEffect(() => {
    setCodeInput(profile.accessCode ?? '')
    setPassEdits({})
    setNameInput(profile.name  ?? '')
    setEmailInput(profile.email ?? '')
    setPhoneInput(profile.phone ?? '')
    setDobInput(profile.dateOfBirth ?? '')
    setAddrInput(profile.address    ?? '')
    setEcNameInput(profile.emergencyContactName         ?? '')
    setEcPhoneInput(profile.emergencyContactPhone       ?? '')
    setEcRelInput(profile.emergencyContactRelationship  ?? '')
  }, [profile.id])

  function handleSaveCode() {
    onSaveCode(profile.id, codeInput.trim())
  }

  async function handleSavePassesLeft(passId, value) {
    setSavingPassId(passId)
    try {
      await onSavePassesLeft(passId, value)
      setPassEdits(prev => { const n = { ...prev }; delete n[passId]; return n })
    } catch {
      // non-fatal
    } finally {
      setSavingPassId(null)
    }
  }

  const GEditField = ({ label, value, setValue, onSave, saved, type = 'text', onBlur }) => (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-zinc-400 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 ml-4 flex-1 justify-end">
        <input
          type={type}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={onBlur}
          disabled={isUnlinked}
          className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-neutral-500 w-36 disabled:opacity-40"
        />
        {!isUnlinked && (
          <button
            onClick={onSave}
            disabled={value === saved}
            className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            save
          </button>
        )}
      </div>
    </div>
  )

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

      <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* Avatar + name + stats */}
        <div className="flex flex-col items-center text-center gap-2 pt-1 pb-2">
          <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-black font-bold text-lg tracking-tight select-none">
              {initials.toUpperCase() || '?'}
            </span>
          </div>
          <p className="text-white font-semibold text-base leading-tight">{profile.name}</p>
          <div className="flex items-center gap-2.5 text-xs text-neutral-500">
            <span><span className="text-white font-semibold">{visits}</span> visits</span>
            <span className="text-neutral-700">·</span>
            <span><span className="text-white font-semibold">{profile.passes.length}</span> passes</span>
          </div>
        </div>

        {/* Contact */}
        <GSection icon={Phone} title="contact">
          <GEditField
            label="name"
            value={nameInput}
            setValue={setNameInput}
            saved={profile.name ?? ''}
            onSave={() => onSaveProfile({ name: nameInput.trim() })}
          />
          <GEditField
            label="email"
            value={emailInput}
            setValue={setEmailInput}
            saved={profile.email ?? ''}
            onSave={() => onSaveProfile({ email: emailInput.trim() })}
          />
          <GEditField
            label="phone"
            value={phoneInput}
            setValue={setPhoneInput}
            saved={profile.phone ?? ''}
            onSave={() => onSaveProfile({ phone: phoneInput })}
            onBlur={() => setPhoneInput(v => formatPhone(v) ?? v)}
          />
        </GSection>

        {/* Personal info */}
        <GSection icon={User} title="personal info">
          <GEditField
            label="date of birth"
            value={dobInput}
            setValue={setDobInput}
            saved={profile.dateOfBirth ?? ''}
            onSave={() => onSaveProfile({ dateOfBirth: dobInput.trim() })}
            type="date"
          />
          <GEditField
            label="address"
            value={addrInput}
            setValue={setAddrInput}
            saved={profile.address ?? ''}
            onSave={() => onSaveProfile({ address: addrInput.trim() })}
          />
        </GSection>

        {/* Emergency contact */}
        <GSection icon={ShieldAlert} title="emergency contact">
          <GEditField
            label="name"
            value={ecNameInput}
            setValue={setEcNameInput}
            saved={profile.emergencyContactName ?? ''}
            onSave={() => onSaveProfile({ emergencyContactName: ecNameInput.trim() })}
          />
          <GEditField
            label="phone"
            value={ecPhoneInput}
            setValue={setEcPhoneInput}
            saved={profile.emergencyContactPhone ?? ''}
            onSave={() => onSaveProfile({ emergencyContactPhone: ecPhoneInput })}
            onBlur={() => setEcPhoneInput(v => formatPhone(v) ?? v)}
          />
          <GEditField
            label="relationship"
            value={ecRelInput}
            setValue={setEcRelInput}
            saved={profile.emergencyContactRelationship ?? ''}
            onSave={() => onSaveProfile({ emergencyContactRelationship: ecRelInput.trim() })}
          />
        </GSection>

        {/* Access code */}
        <GSection icon={KeyRound} title="access code">
          <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
            <span className="text-xs text-zinc-400 shrink-0">pin</span>
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={isUnlinked ? 'no profile linked' : '——'}
                disabled={isUnlinked}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white text-right placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-20 font-mono disabled:opacity-40"
              />
              {!isUnlinked && (
                <>
                  <button
                    type="button"
                    onClick={() => setCodeInput(String(Math.floor(1000 + Math.random() * 9000)))}
                    className="text-[10px] px-2 py-1 rounded bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  >
                    gen
                  </button>
                  <button
                    onClick={handleSaveCode}
                    disabled={saving || codeInput.trim() === (profile.accessCode ?? '')}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {saving ? '…' : 'save'}
                  </button>
                </>
              )}
            </div>
          </div>
        </GSection>

        {/* Pass history */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-[11px] font-semibold tracking-widest text-neutral-500">PASS HISTORY</p>
          </div>
          <div className="rounded-lg border border-neutral-800 overflow-hidden">
            {profile.passes.length === 0 ? (
              <p className="px-3 py-3 text-xs text-neutral-600">no passes yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left bg-[#1c1c1c]">
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-500 tracking-wider">type</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-500 tracking-wider">left</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-500 tracking-wider">purchased</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {profile.passes.map(p => (
                    <tr key={p.id} className="bg-[#1c1c1c]">
                      <td className="px-3 py-2.5">
                        <span className={`inline-block text-[10px] font-medium border-l-2 pl-1.5 ${passTypeBorder[p.passType] ?? passTypeBorder.SINGLE}`}>
                          {PASS_TYPE_LABEL[p.passType]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-400 tabular-nums">
                        {p.passesLeft === null || p.passesLeft === undefined ? '—' : (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              value={passEdits[p.id] ?? p.passesLeft}
                              onChange={e => {
                                const v = parseInt(e.target.value, 10)
                                if (!isNaN(v) && v >= 0) {
                                  setPassEdits(prev => ({ ...prev, [p.id]: v }))
                                }
                              }}
                              className="w-10 bg-[#252525] border border-neutral-700 rounded px-1.5 py-0.5 text-xs text-white text-center font-mono focus:outline-none focus:border-neutral-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            {passEdits[p.id] !== undefined && passEdits[p.id] !== p.passesLeft && (
                              <button
                                onClick={() => handleSavePassesLeft(p.id, passEdits[p.id])}
                                disabled={savingPassId === p.id}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 transition-colors shrink-0"
                              >
                                {savingPassId === p.id ? '…' : 'save'}
                              </button>
                            )}
                          </div>
                        )}
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

function GSection({ icon: Icon, title, children }) {
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

function GField({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-zinc-400 shrink-0">{label}</span>
      <span className="text-xs text-white text-right ml-4 truncate max-w-[240px]">{value || '—'}</span>
    </div>
  )
}

// ── Guest pass trend chart ─────────────────────────────────────────────────────

const PASS_TOOLTIP = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1c1c1c] border border-neutral-800 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-neutral-400 mb-1.5 font-medium">{label}</p>
      <p className="text-violet-400 leading-5">
        passes: <span className="font-semibold text-white">{payload[0].value}</span>
      </p>
    </div>
  )
}

function GuestPassTrendChart({ data }) {
  return (
    <div className="shrink-0 bg-white/[0.03] border border-white/5 rounded-xl px-5 pt-4 pb-4 flex flex-col" style={{ minHeight: 220 }}>
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <TrendingUp size={13} className="text-neutral-400" />
        <h2 className="text-sm font-semibold text-white">guest pass activity</h2>
      </div>
      <div className="min-w-0 w-full overflow-hidden" style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="gPasses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
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
              allowDecimals={false}
            />
            <Tooltip content={<PASS_TOOLTIP />} cursor={{ stroke: '#404040', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="passes"
              name="passes"
              stroke="#8b5cf6"
              strokeWidth={2}
              fill="url(#gPasses)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
