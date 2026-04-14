'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, AlertTriangle } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PLAN_AMOUNT = { FOUNDING: 50, GENERAL: 65, STUDENT: 55 }

const PLAN_BADGE = {
  FOUNDING: 'bg-blue-500/15 text-blue-400',
  GENERAL:  'bg-neutral-500/15 text-neutral-400',
  STUDENT:  'bg-amber-500/15 text-amber-400',
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500',   'bg-cyan-500', 'bg-orange-500',  'bg-indigo-500',
]

const CONFIRM_COPY = {
  retry: {
    title:   'retry charge?',
    bullets: ['stripe will attempt to charge the card on file', 'the member will be notified if payment succeeds'],
    cta: 'yes, retry', ctaCls: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  },
  resolve: {
    title:   'mark as active?',
    bullets: ['this will remove the member from the overdue list', 'use this if the payment was resolved outside stripe'],
    cta: 'yes, mark active', ctaCls: 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20',
  },
  cancel: {
    title:   'cancel membership?',
    bullets: ['a 30-day notice policy applies', 'member retains access through notice period', 'this action cannot be easily undone'],
    cta: 'yes, cancel', ctaCls: 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function avatarBg(id) {
  const n = [...(id ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

function fmtAmount(cents, membershipType) {
  if (cents != null) return `$${(cents / 100).toFixed(2)}`
  const flat = PLAN_AMOUNT[membershipType]
  return flat ? `$${flat}.00` : '—'
}

function fmtDate(unix) {
  if (!unix) return null
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OverduePage() {
  const { gymSlug } = useParams()

  const [rows,         setRows]         = useState([])
  const [loading,      setLoading]      = useState(true)
  const [fetchErr,     setFetchErr]     = useState(null)
  const [stripeErr,    setStripeErr]    = useState(null)
  const [confirmModal, setConfirmModal] = useState(null) // { action, row }
  const [actionLoading,setActionLoading]= useState(false)
  const [actionError,  setActionError]  = useState(null)

  const fetchOverdue = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/stripe/overdue`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setRows(data.overdue)
      setStripeErr(data.stripeError ?? null)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load overdue members')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchOverdue() }, [fetchOverdue])

  // Metrics
  const pastDue   = rows.filter(r => r.invoiceStatus === 'past_due' || r.invoiceStatus === 'open').length
  const unpaid    = rows.filter(r => r.invoiceStatus === 'unpaid').length
  const totalOwed = rows.reduce((s, r) => {
    return s + (r.amountDue != null ? r.amountDue / 100 : PLAN_AMOUNT[r.membershipType] ?? 0)
  }, 0)

  // ── Actions ───────────────────────────────────────────────────────────────
  async function confirmAction() {
    const { action, row } = confirmModal
    setActionLoading(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('ik_token')

      if (action === 'retry') {
        if (!row.invoiceId) throw new Error('No invoice ID — Stripe not connected')
        const res = await fetch(`/api/${gymSlug}/stripe/retry`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ invoiceId: row.invoiceId }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? 'Retry failed')
        }
        // Remove from list on success
        setRows(prev => prev.filter(r => r.id !== row.id))
      } else if (action === 'resolve') {
        const res = await fetch(`/api/${gymSlug}/stripe/resolve`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ memberId: row.id, invoiceId: row.invoiceId }),
        })
        if (!res.ok) throw new Error('Failed to resolve')
        setRows(prev => prev.filter(r => r.id !== row.id))
      } else if (action === 'cancel') {
        const res = await fetch(`/api/${gymSlug}/cancel`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ memberId: row.id }),
        })
        if (!res.ok) throw new Error('Cancel failed')
        setRows(prev => prev.filter(r => r.id !== row.id))
      }

      setConfirmModal(null)
    } catch (err) {
      setActionError(err.message ?? 'something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">overdue</h1>
        <button
          onClick={fetchOverdue}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          refresh
        </button>
      </header>

      <main className="flex-1 flex flex-col p-5 gap-4 overflow-hidden min-h-0">

        {/* Metric cards */}
        <div className="shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'past due',   value: loading ? '—' : pastDue,  sub: 'stripe is still retrying' },
            { label: 'unpaid',     value: loading ? '—' : unpaid,   sub: 'retries exhausted — needs outreach' },
            { label: 'total owed', value: loading ? '—' : `$${totalOwed.toFixed(2)}`, sub: null },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-[#1c1c1c] rounded-xl border border-red-900/30 px-4 py-3">
              <p className="text-[11px] text-neutral-500 mb-1">{label}</p>
              <p className="text-xl font-semibold text-red-400 tabular-nums">{value}</p>
              {sub && <p className="text-[10px] text-neutral-600 mt-1">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Stripe error banner */}
        {stripeErr && (
          <div className="shrink-0 bg-amber-500/10 border border-amber-900/50 rounded-lg px-4 py-3 text-xs text-amber-400">
            stripe error: {stripeErr}
          </div>
        )}

        {/* Table card */}
        <div className="flex-1 flex flex-col bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden min-h-0">

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
                <button onClick={fetchOverdue} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <p className="text-sm text-neutral-500">no overdue members</p>
                <p className="text-xs text-neutral-700">all memberships are current</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#1c1c1c] z-10">
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">member</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">plan</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">amount</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">status</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">decline reason</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-neutral-800/40 bg-red-950/20 hover:bg-red-950/30 transition-colors">

                      {/* Member */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${avatarBg(r.id)}`}>
                            <span className="text-white font-semibold text-[10px] select-none">
                              {(r.firstName?.[0] ?? '') + (r.lastName?.[0] ?? '')}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-white font-medium text-sm truncate">{r.firstName} {r.lastName}</p>
                            <p className="text-neutral-500 text-[11px] truncate">{r.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${PLAN_BADGE[r.membershipType] ?? PLAN_BADGE.GENERAL}`}>
                          {(r.membershipType ?? 'GENERAL').toLowerCase()}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-3 text-red-400 text-xs font-medium tabular-nums">
                        {fmtAmount(r.amountDue, r.membershipType)}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 w-fit">
                            {r.invoiceStatus === 'unpaid' ? 'unpaid' : r.invoiceStatus === 'open' ? 'open invoice' : 'past due'}
                          </span>
                          {r.failedAt && (
                            <span className="text-[10px] text-neutral-600 pl-1">{fmtDate(r.failedAt)}</span>
                          )}
                        </div>
                      </td>

                      {/* Decline reason */}
                      <td className="px-5 py-3 max-w-[200px]">
                        {r.declineReason ? (
                          <span className="text-xs text-amber-400/80">{r.declineReason}</span>
                        ) : (
                          <span className="text-xs text-neutral-700">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setActionError(null); setConfirmModal({ action: 'retry', row: r }) }}
                            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            retry charge
                          </button>
                          <button
                            onClick={() => { setActionError(null); setConfirmModal({ action: 'resolve', row: r }) }}
                            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
                          >
                            mark resolved
                          </button>
                          <button
                            onClick={() => { setActionError(null); setConfirmModal({ action: 'cancel', row: r }) }}
                            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          >
                            cancel
                          </button>
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

      {/* ── Confirm modal ──────────────────────────────────────────────────── */}
      {confirmModal && (() => {
        const copy = CONFIRM_COPY[confirmModal.action]
        const name = `${confirmModal.row.firstName} ${confirmModal.row.lastName}`
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={!actionLoading ? () => setConfirmModal(null) : undefined} />
            <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{copy.title}</p>
                  <p className="text-xs text-neutral-500">{name}</p>
                </div>
              </div>
              <ul className="space-y-1.5 mb-5">
                {copy.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-neutral-400">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-600 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
              {actionError && <p className="text-xs text-red-400 mb-3">{actionError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmModal(null)}
                  disabled={actionLoading}
                  className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
                >
                  cancel
                </button>
                <button
                  onClick={confirmAction}
                  disabled={actionLoading}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors ${copy.ctaCls}`}
                >
                  {actionLoading ? 'please wait…' : copy.cta}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
