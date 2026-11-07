'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

function fmtStart(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
}

const STATUS_STYLE = {
  active:   'text-emerald-400',
  trialing: 'text-sky-400',
  past_due: 'text-amber-400',
  unpaid:   'text-rose-400',
}

/**
 * "pt memberships" section of the personal training page: members with a
 * live PT subscription (GET /api/[gymSlug]/pt/memberships) and an "assign
 * trainer" dropdown per row (pt.assign only; plain text otherwise).
 *
 * Follows the page's trainer filter: a trainer → that trainer's assigned
 * clients; all trainers → everyone, unassigned first. onAssigned lets the
 * page refresh its trainer client counts.
 */
export function PtMembershipsSection({ gymSlug, filterTrainerId, onAssigned }) {
  const [rows,      setRows]      = useState([])
  const [trainers,  setTrainers]  = useState([])
  const [canAssign, setCanAssign] = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [savingId,  setSavingId]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/pt/memberships`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(res.status === 403 ? 'you don\'t have access to pt memberships' : 'could not load pt memberships')
      const data = await res.json()
      setRows(data.rows ?? [])
      setTrainers(data.trainers ?? [])
      setCanAssign(Boolean(data.canAssign))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { load() }, [load])

  async function assign(row, personalTrainerId) {
    setSavingId(row.subscriptionId)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/members/${row.memberId}/trainer`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ personalTrainerId: personalTrainerId || null }),
      })
      if (!res.ok) throw new Error()
      const { trainer } = await res.json()
      setRows(prev => prev.map(r => r.memberId === row.memberId ? { ...r, trainer } : r))
      onAssigned?.()
    } catch {
      alert('could not assign the trainer')
    } finally {
      setSavingId(null)
    }
  }

  const visible = filterTrainerId
    ? rows.filter(r => r.trainer?.id === filterTrainerId)
    : [...rows].sort((a, b) => (a.trainer ? 1 : 0) - (b.trainer ? 1 : 0) || a.name.localeCompare(b.name))

  return (
    <div className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden shrink-0">
      <div className="px-5 py-3 border-b border-neutral-800 flex items-center gap-2">
        <p className="text-xs font-semibold text-neutral-500 tracking-widest">pt memberships</p>
        {!loading && !error && <span className="text-xs text-neutral-600 tabular-nums">{visible.length}</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-24 gap-2">
          <RefreshCw size={14} className="text-neutral-600 animate-spin" />
          <span className="text-xs text-neutral-600">loading…</span>
        </div>
      ) : error ? (
        <p className="text-xs text-red-400 px-5 py-4">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-neutral-600 px-5 py-4">
          {filterTrainerId ? 'no pt members assigned to this trainer' : 'no members with an active pt membership'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-neutral-500 border-b border-neutral-800">
                <th className="px-5 py-2.5 font-medium">name</th>
                <th className="px-5 py-2.5 font-medium">pt plan</th>
                <th className="px-5 py-2.5 font-medium">status</th>
                <th className="px-5 py-2.5 font-medium">trainer</th>
                <th className="px-5 py-2.5 font-medium">started</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={r.subscriptionId} className={`border-b border-neutral-800/60 last:border-b-0 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                  <td className="px-5 py-3 text-white">
                    {r.name}
                    {!r.memberId && <span className="ml-2 text-[10px] text-neutral-600">no member record</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-neutral-300">{r.plan.toLowerCase()}</td>
                  <td className={`px-5 py-3 text-xs ${STATUS_STYLE[r.status] ?? 'text-neutral-400'}`}>{r.status.replace('_', ' ')}</td>
                  <td className="px-5 py-3">
                    {canAssign && r.memberId ? (
                      <select
                        aria-label="assign trainer"
                        value={r.trainer?.id ?? ''}
                        disabled={savingId === r.subscriptionId}
                        onChange={e => assign(r, e.target.value)}
                        className="bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-neutral-500 disabled:opacity-40"
                      >
                        <option value="">assign trainer</option>
                        {trainers.map(t => <option key={t.id} value={t.id}>{t.name.toLowerCase()}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-neutral-400">{r.trainer?.name?.toLowerCase() ?? 'unassigned'}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-neutral-500 whitespace-nowrap">{fmtStart(r.startDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
