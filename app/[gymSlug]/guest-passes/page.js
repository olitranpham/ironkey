'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PASS_TYPE_LABEL = {
  SINGLE:     'single',
  THREE_PACK: '3-pack',
  FIVE_PACK:  '5-pack',
  TEN_PACK:   '10-pack',
}

const PASS_TYPE_BADGE = {
  SINGLE:     'bg-neutral-500/15 text-neutral-400',
  THREE_PACK: 'bg-violet-500/15 text-violet-400',
  FIVE_PACK:  'bg-blue-500/15 text-blue-400',
  TEN_PACK:   'bg-emerald-500/15 text-emerald-400',
}

const PASS_TABS     = ['all', 'single', '3-pack', '5-pack', '10-pack']
const PASS_TAB_TYPE = {
  all:       null,
  single:    'SINGLE',
  '3-pack':  'THREE_PACK',
  '5-pack':  'FIVE_PACK',
  '10-pack': 'TEN_PACK',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GuestPassesPage() {
  const { gymSlug } = useParams()

  const [passes,    setPasses]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [fetchErr,  setFetchErr]  = useState(null)
  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState('all')

  const fetchPasses = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/guest-passes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { passes } = await res.json()
      setPasses(passes)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load guest passes')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchPasses() }, [fetchPasses])

  // Metrics
  const total  = passes.length
  const single = passes.filter(p => p.passType === 'SINGLE').length
  const three  = passes.filter(p => p.passType === 'THREE_PACK').length
  const five   = passes.filter(p => p.passType === 'FIVE_PACK').length
  const ten    = passes.filter(p => p.passType === 'TEN_PACK').length

  const counts = { all: total, single, '3-pack': three, '5-pack': five, '10-pack': ten }

  const visible = passes
    .filter(p => {
      const typeKey     = PASS_TAB_TYPE[activeTab]
      const matchTab    = !typeKey || p.passType === typeKey
      const q           = search.trim().toLowerCase()
      const matchSearch = !q || `${p.guestName} ${p.guestEmail ?? ''}`.toLowerCase().includes(q)
      return matchTab && matchSearch
    })
    .sort((a, b) => new Date(b.usedAt ?? b.createdAt) - new Date(a.usedAt ?? a.createdAt))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

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
        <div className="shrink-0 grid grid-cols-5 gap-3">
          {[
            { label: 'total entries', value: total  },
            { label: 'single',        value: single },
            { label: '3-pack',        value: three  },
            { label: '5-pack',        value: five   },
            { label: '10-pack',       value: ten    },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#1c1c1c] rounded-xl border border-neutral-800 px-4 py-3">
              <p className="text-[11px] text-neutral-500 mb-1">{label}</p>
              <p className="text-xl font-semibold text-white tabular-nums">
                {loading ? '—' : value}
              </p>
            </div>
          ))}
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
            {PASS_TABS.map(tab => (
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
                <p className="text-sm text-neutral-600">no passes match</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#1c1c1c] z-10">
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">name</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">email</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">pass type</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">passes left</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">date purchased</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(p => (
                    <tr key={p.id} className="border-b border-neutral-800/40 hover:bg-white/[0.025] transition-colors">
                      <td className="px-5 py-3 text-white text-sm">{p.guestName}</td>
                      <td className="px-5 py-3 text-neutral-500 text-xs">{p.guestEmail || '—'}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${PASS_TYPE_BADGE[p.passType] ?? PASS_TYPE_BADGE.SINGLE}`}>
                          {PASS_TYPE_LABEL[p.passType] ?? p.passType.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {p.passesLeft === null || p.passesLeft === undefined ? (
                          <span className="text-neutral-600 text-xs">—</span>
                        ) : p.passesLeft === 0 ? (
                          <span className="text-red-400 text-xs font-medium">used out</span>
                        ) : (
                          <span className="text-white text-xs">{p.passesLeft} left</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-600 text-xs whitespace-nowrap">
                        {fmtDate(p.usedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </main>
    </div>
  )
}
