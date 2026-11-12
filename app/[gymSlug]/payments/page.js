'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw } from 'lucide-react'
import MemberDrawer from '@/components/member-drawer/MemberDrawer'
import { useMemberParam } from '@/components/member-drawer/useMemberParam'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS = ['active', 'frozen', 'canceled']
// "paused" maps to FROZEN; "active" includes ACTIVE + OVERDUE
const TAB_STATUSES = {
  all:      null,
  active:   ['ACTIVE', 'OVERDUE'],
  frozen:   ['FROZEN'],
  canceled: ['CANCELED'],
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { gymSlug } = useParams()
  const [members,    setMembers]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState(null)
  const [search,    setSearch]    = useState('')
  const [activeTab, setActiveTab] = useState('active')

  // Member drawer — ?member=<id>&tab=<tab>, payments tab by default
  const drawer = useMemberParam('payments')

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const headers = { Authorization: `Bearer ${token}` }

      const membersRes = await fetch(`/api/${gymSlug}/all`, { headers })

      if (!membersRes.ok) throw new Error(`${membersRes.status}`)
      const { members } = await membersRes.json()

      setMembers(members)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load members')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // ── Filtered list ─────────────────────────────────────────────────────────
  const visible = members
    .filter(m => {
      const statuses = TAB_STATUSES[activeTab]
      const matchTab    = activeTab === 'canceled'
        ? (m.status === 'CANCELED' || ((m.status === 'ACTIVE' || m.status === 'OVERDUE') && m.cancelScheduled === true))
        : activeTab === 'frozen'
          ? statuses.includes(m.status)
          : (!statuses || statuses.includes(m.status)) && !m.cancelScheduled
      const q           = search.trim().toLowerCase()
      const matchSearch = !q || `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)
      return matchTab && matchSearch
    })
    .sort((a, b) => {
      const order = { ACTIVE: 0, OVERDUE: 1, FROZEN: 2, CANCELED: 3 }
      return (order[a.status] ?? 9) - (order[b.status] ?? 9)
    })

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">payments</h1>
      </header>

      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Search */}
        <div className="shrink-0">
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
        </div>

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">

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
          <div className="md:flex-1 md:overflow-y-auto overflow-x-auto">
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
