'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw } from 'lucide-react'
import ExportButton from '@/components/ExportButton'
import MemberDrawer from '@/components/member-drawer/MemberDrawer'
import { useMemberParam } from '@/components/member-drawer/useMemberParam'
import { CATEGORY_OPTIONS, classifyMembershipType, classifyMembershipTypeAll } from '@/lib/membershipCategory'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_TABS  = ['active', 'flex', 'frozen', 'canceled']
const FLEX_GYMS = new Set(['oasis-boston'])

const STATUS_TEXT = {
  ACTIVE:    'text-emerald-600',
  FROZEN:    'text-blue-400/70',
  CANCELED: 'text-zinc-500',
  OVERDUE:   'text-red-400/70',
}

const AVATAR_COLOR = 'bg-white'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtStatus(status) {
  return status === 'CANCELED' ? 'canceled' : status.toLowerCase()
}


function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const { gymSlug } = useParams()
  const tabs = FLEX_GYMS.has(gymSlug) ? ALL_TABS : ALL_TABS.filter(t => t !== 'flex')

  const [members,   setMembers]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [fetchErr,  setFetchErr]  = useState(null)
  const [search,     setSearch]     = useState('')
  const [activeTab,  setActiveTab]  = useState('active')
  const [typeFilter, setTypeFilter] = useState('')

  // Member drawer — ?member=<id>&tab=<tab>
  const drawer = useMemberParam('overview')

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

  // ── CSV export ───────────────────────────────────────────────────────────

  function exportCSV() {
    const escape = v => {
      if (v == null) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }

    const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''

    const header = [
      'first name', 'last name', 'email', 'phone',
      'membership type', 'status', 'access code',
      'join date', 'freeze date', 'cancel date',
      'date of birth', 'address',
      'emergency contact name', 'emergency contact phone', 'emergency contact relationship',
      'is minor', 'guardian name', 'guardian email', 'guardian phone', 'guardian relationship',
    ]
    const rows = visible.map(m => [
      m.firstName,
      m.lastName,
      m.email,
      m.phone,
      m.membershipType,
      m.status,
      m.accessCode,
      fmtDate(m.dateAccessed ?? m.createdAt),
      fmtDate(m.dateFrozen),
      fmtDate(m.dateCanceled),
      m.dateOfBirth,
      m.address,
      m.emergencyContactName,
      m.emergencyContactPhone,
      m.emergencyContactRelationship,
      m.isMinor ? 'yes' : 'no',
      m.guardianName,
      m.guardianEmail,
      m.guardianPhone,
      m.guardianRelationship,
    ].map(escape))

    const csv  = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${gymSlug}-members-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  function isFlex(m) {
    return m.membershipType?.toLowerCase().includes('flex')
  }

  function matchesTab(m, tab) {
    if (tab === 'active')   return (m.status === 'ACTIVE' || m.status === 'OVERDUE') && !isFlex(m) && !m.cancelScheduled
    if (tab === 'flex')     return isFlex(m) && !m.cancelScheduled
    if (tab === 'frozen')   return m.status === 'FROZEN'
    if (tab === 'canceled') return m.status === 'CANCELED' || ((m.status === 'ACTIVE' || m.status === 'OVERDUE') && m.cancelScheduled === true)
    return true
  }

  const tabCount = members.filter(m => matchesTab(m, activeTab)).length

  // Membership types actually present for this gym, so the filter never shows
  // options that don't apply here — pulled from the gym's real member records.
  // PT/programming variants (e.g. "1 session/week", "weekly communication")
  // collapse into two category options instead of one entry per tier.
  const regularTypes = [...new Set(
    members.map(m => m.membershipType).filter(t => t && !classifyMembershipType(t))
  )]
  const presentCategories = CATEGORY_OPTIONS.filter(cat =>
    members.some(m => classifyMembershipTypeAll(m.membershipType).includes(cat))
  )
  const membershipTypes = [...regularTypes, ...presentCategories].sort()

  const visible = members
    .filter(m => {
      const q = search.trim().toLowerCase()
      const matchSearch = !q ||
        `${m.firstName} ${m.lastName} ${m.email} ${m.phone ?? ''}`.toLowerCase().includes(q)
      const matchType = !typeFilter || (
        CATEGORY_OPTIONS.includes(typeFilter)
          ? classifyMembershipTypeAll(m.membershipType).includes(typeFilter)
          : m.membershipType === typeFilter
      )
      return matchesTab(m, activeTab) && matchSearch && matchType
    })
    .sort((a, b) => {
      if (activeTab === 'frozen')   return new Date(b.dateFrozen   ?? 0) - new Date(a.dateFrozen   ?? 0)
      if (activeTab === 'canceled') return new Date(b.dateCanceled ?? 0) - new Date(a.dateCanceled ?? 0)
      return 0
    })

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-white">members</h1>
          {!loading && (
            <span className="text-sm font-normal text-white opacity-40 tabular-nums">{tabCount}</span>
          )}
        </div>
        {!loading && members.length > 0 && (
          <ExportButton onClick={exportCSV} />
        )}
      </header>

      {/* Main */}
      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Search + type filter */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-80">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              type="text"
              placeholder="search name, email, phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-neutral-700/50 border border-neutral-600/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
            />
          </div>
          {membershipTypes.length > 0 && (
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-neutral-700/50 border border-neutral-600/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors appearance-none pr-7 cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              <option value="">all types</option>
              {membershipTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">

          {/* Tabs */}
          <div className="flex border-b border-neutral-800 px-4 shrink-0">
            {tabs.map(tab => (
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

          {/* Table body */}
          <div className="md:flex-1 md:overflow-y-auto overflow-x-auto">
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
                <tbody>
                  {visible.map((m, i) => (
                    <tr
                      key={m.id}
                      onClick={() => drawer.openMember(m.id)}
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
                            {m.cancelScheduled && (
                              <p className="text-[10px] text-amber-500/70 leading-tight mt-0.5">
                                cancellation scheduled{m.cancelEffectiveDate ? ` — ${fmtDate(m.cancelEffectiveDate)}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Joined date */}
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs text-neutral-500">{fmtDate(m.createdAt)}</span>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      <MemberDrawer
        gymSlug={gymSlug}
        memberId={drawer.memberId}
        initialTab={drawer.tab}
        seed={members.find(m => m.id === drawer.memberId)}
        onClose={drawer.close}
        onTabChange={drawer.setTab}
        onMemberUpdated={updated => setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))}
        onMemberRemoved={id => setMembers(prev => prev.filter(m => m.id !== id))}
      />

    </div>
  )
}
