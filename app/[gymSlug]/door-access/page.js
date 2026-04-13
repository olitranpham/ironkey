'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, KeyRound, AlertTriangle, X } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const CODE_STATUS_BADGE = {
  set:     'bg-emerald-500/15 text-emerald-400',
  unset:   'bg-neutral-500/15 text-neutral-400',
  unknown: 'bg-amber-500/15 text-amber-400',
}

const CODE_TYPE_BADGE = {
  member: 'bg-blue-500/15 text-blue-400',
  guest:  'bg-amber-500/15 text-amber-400',
}

const TABS = ['all', 'active', 'timed']

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeLeft(endsAt) {
  if (!endsAt) return null
  const ms = new Date(endsAt) - Date.now()
  if (ms <= 0) return 'expired'
  const totalH = Math.floor(ms / 3_600_000)
  const d = Math.floor(totalH / 24)
  const h = totalH % 24
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DoorAccessPage() {
  const { gymSlug } = useParams()

  const [codes,         setCodes]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [fetchErr,      setFetchErr]      = useState(null)
  const [activeTab,     setActiveTab]     = useState('all')
  const [changeModal,   setChangeModal]   = useState(null)
  const [removeModal,   setRemoveModal]   = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)
  const [newCode,       setNewCode]       = useState('')

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/seam/codes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { codes } = await res.json()
      setCodes(codes)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load access codes')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  // Metrics
  const activeCodes   = codes.filter(c => c.status === 'set').length
  const memberCodes   = codes.filter(c => c.type === 'member').length
  const guestCodes    = codes.filter(c => c.type === 'guest').length

  // Tab filter
  const visible = codes.filter(c => {
    if (activeTab === 'active') return c.status === 'set'
    if (activeTab === 'timed')  return c.codeType === 'time_bound'
    return true
  })

  const counts = {
    all:    codes.length,
    active: activeCodes,
    timed:  codes.filter(c => c.codeType === 'time_bound').length,
  }

  async function handleChangeCode() {
    if (!changeModal?.memberId) return
    setActionLoading(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/seam/codes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ memberId: changeModal.memberId, code: newCode || undefined }),
      })
      if (!res.ok) throw new Error('Request failed')
      setChangeModal(null)
      setNewCode('')
      fetchCodes()
    } catch {
      setActionError('something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleRemove() {
    if (!removeModal) return
    setActionLoading(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/seam/codes/${removeModal.id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Request failed')
      setCodes(prev => prev.filter(c => c.id !== removeModal.id))
      setRemoveModal(null)
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
        <h1 className="text-sm font-semibold text-white">door access</h1>
        <button
          onClick={fetchCodes}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          refresh
        </button>
      </header>

      <main className="flex-1 flex flex-col p-5 gap-4 overflow-hidden min-h-0">

        {/* Metric cards */}
        <div className="shrink-0 grid grid-cols-3 gap-3">
          {[
            { label: 'active codes',   value: activeCodes },
            { label: 'active members', value: memberCodes },
            { label: 'guest passes',   value: guestCodes  },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#1c1c1c] rounded-xl border border-neutral-800 px-4 py-3">
              <p className="text-[11px] text-neutral-500 mb-1">{label}</p>
              <p className="text-xl font-semibold text-white tabular-nums">
                {loading ? '—' : value}
              </p>
            </div>
          ))}
        </div>

        {/* Table card */}
        <div className="flex-1 flex flex-col bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden min-h-0">

          {/* Tabs */}
          <div className="flex border-b border-neutral-800 px-4 shrink-0">
            {TABS.map(tab => (
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
                <button onClick={fetchCodes} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                  retry
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-neutral-600">no access codes found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#1c1c1c] z-10">
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">name</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">code</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">status</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">type</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">time left</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(c => {
                    const tl = c.codeType === 'time_bound' ? timeLeft(c.endsAt) : null
                    return (
                      <tr key={c.id} className="border-b border-neutral-800/40 hover:bg-white/[0.025] transition-colors">
                        <td className="px-5 py-3 text-white text-sm">{c.name}</td>
                        <td className="px-5 py-3 font-mono text-xs text-neutral-400 tabular-nums">{c.code}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${CODE_STATUS_BADGE[c.status] ?? CODE_STATUS_BADGE.unknown}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${CODE_TYPE_BADGE[c.type]}`}>
                            {c.type}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {tl ? (
                            <span className={`text-xs ${tl === 'expired' ? 'text-red-400' : 'text-neutral-400'}`}>
                              {tl}
                            </span>
                          ) : (
                            <span className="text-neutral-700 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {c.type === 'member' && (
                              <button
                                onClick={() => { setChangeModal(c); setNewCode(''); setActionError(null) }}
                                className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-neutral-500/10 text-neutral-400 hover:bg-neutral-500/20 transition-colors"
                              >
                                change code
                              </button>
                            )}
                            <button
                              onClick={() => { setRemoveModal(c); setActionError(null) }}
                              className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              remove
                            </button>
                          </div>
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

      {/* ── Change code modal ────────────────────────────────────────────────── */}
      {changeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={!actionLoading ? () => setChangeModal(null) : undefined} />
          <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                <KeyRound size={16} className="text-neutral-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">change access code</p>
                <p className="text-xs text-neutral-500">{changeModal.name}</p>
              </div>
              <button onClick={() => setChangeModal(null)} disabled={actionLoading} className="ml-auto p-1.5 rounded-lg text-neutral-600 hover:text-white hover:bg-white/5 transition-colors">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              enter a new 6-digit code, or leave blank to generate one automatically
            </p>
            <input
              type="text"
              placeholder="e.g. 847291"
              maxLength={6}
              value={newCode}
              onChange={e => setNewCode(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-[#292929] border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 mb-4 font-mono tracking-widest"
            />
            {actionError && <p className="text-xs text-red-400 mb-3">{actionError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setChangeModal(null)}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleChangeCode}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-neutral-500/10 text-neutral-300 hover:bg-neutral-500/20 disabled:opacity-40 transition-colors"
              >
                {actionLoading ? 'please wait…' : 'update code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove modal ─────────────────────────────────────────────────────── */}
      {removeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={!actionLoading ? () => setRemoveModal(null) : undefined} />
          <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} className="text-neutral-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">remove access code?</p>
                <p className="text-xs text-neutral-500">{removeModal.name}</p>
              </div>
            </div>
            <ul className="space-y-1.5 mb-5">
              {[
                'the code will be deleted from all connected locks',
                'this action cannot be undone',
              ].map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-neutral-400">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-600 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
            {actionError && <p className="text-xs text-red-400 mb-3">{actionError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setRemoveModal(null)}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                {actionLoading ? 'please wait…' : 'yes, remove'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
