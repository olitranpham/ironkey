'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, X } from 'lucide-react'
import { getGymTheme } from '@/lib/gymThemes'

// ── Constants ─────────────────────────────────────────────────────────────────

const PLAN_AMOUNT = { FOUNDING: 50, GENERAL: 65, STUDENT: 55 }

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

function fmtAmount(cents, membershipType) {
  if (cents != null) return `$${(cents / 100).toFixed(2)}`
  const flat = PLAN_AMOUNT[membershipType]
  return flat ? `$${flat}.00` : '—'
}

function fmtDate(unix) {
  if (!unix) return null
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function invoiceLabel(r) {
  return r.invoiceStatus === 'unpaid' ? 'unpaid' : r.invoiceStatus === 'open' ? 'open invoice' : 'past due'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OverduePage() {
  const { gymSlug } = useParams()
  const { membershipBorder } = getGymTheme(gymSlug)

  const [rows,          setRows]          = useState([])
  const [loading,       setLoading]       = useState(true)
  const [fetchErr,      setFetchErr]      = useState(null)
  const [stripeErr,     setStripeErr]     = useState(null)
  const [confirmModal,  setConfirmModal]  = useState(null) // { action, row }
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)

  const [selectedRow, setSelectedRow] = useState(null)
  const [panelOpen,   setPanelOpen]   = useState(false)
  const closeTimer = useRef(null)

  function openPanel(row) {
    setSelectedRow(row)
    setPanelOpen(true)
  }
  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedRow(null), 220)
  }

  useEffect(() => {
    document.body.style.overflow = panelOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [panelOpen])

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
        setRows(prev => prev.filter(r => r.id !== row.id))
        closePanel()
      } else if (action === 'resolve') {
        const res = await fetch(`/api/${gymSlug}/stripe/resolve`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ memberId: row.id, invoiceId: row.invoiceId }),
        })
        if (!res.ok) throw new Error('Failed to resolve')
        setRows(prev => prev.filter(r => r.id !== row.id))
        closePanel()
      } else if (action === 'cancel') {
        const res = await fetch(`/api/${gymSlug}/cancel`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ memberId: row.id }),
        })
        if (!res.ok) throw new Error('Cancel failed')
        setRows(prev => prev.filter(r => r.id !== row.id))
        closePanel()
      }

      setConfirmModal(null)
    } catch (err) {
      setActionError(err.message ?? 'something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">overdue</h1>
      </header>

      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Stripe error banner */}
        {stripeErr && (
          <div className="shrink-0 bg-amber-500/10 border border-amber-900/50 rounded-lg px-4 py-3 text-xs text-amber-400">
            stripe error: {stripeErr}
          </div>
        )}

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">
          <div className="md:flex-1 md:overflow-y-auto overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 gap-2">
                <div className="w-4 h-4 border-2 border-neutral-600 border-t-neutral-400 rounded-full animate-spin" />
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
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.id}
                      onClick={() => openPanel(r)}
                      className={`group hover:bg-white/5 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                    >
                      {/* Name + email + avatar */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                            <span className="text-black font-medium text-[10px] select-none">
                              {(r.firstName?.[0] ?? '') + (r.lastName?.[0] ?? '')}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-white text-sm leading-tight">{r.firstName} {r.lastName}</p>
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

      {/* ── Overlay ───────────────────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-black/60 z-30 transition-opacity duration-200 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      />

      {/* ── Overdue panel ─────────────────────────────────────────────────────── */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[360px] bg-[#171717] border-l border-neutral-800 z-40 flex flex-col shadow-2xl transition-transform duration-200 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedRow && (
          <OverduePanel
            row={selectedRow}
            membershipBorder={membershipBorder}
            onClose={closePanel}
            onAction={(action) => { setActionError(null); setConfirmModal({ action, row: selectedRow }) }}
          />
        )}
      </div>

      {/* ── Confirm modal ─────────────────────────────────────────────────────── */}
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

// ── Overdue panel ─────────────────────────────────────────────────────────────

function OverduePanel({ row, membershipBorder, onClose, onAction }) {
  const initials = (row.firstName?.[0] ?? '') + (row.lastName?.[0] ?? '')

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
        <p className="text-sm font-semibold text-white">overdue member</p>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* Avatar + name */}
        <div className="flex flex-col items-center text-center gap-3 pt-1 pb-2">
          <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-black font-bold text-lg tracking-tight select-none">{initials || '?'}</span>
          </div>
          <div>
            <p className="text-white font-semibold text-base leading-tight">{row.firstName} {row.lastName}</p>
            <p className="text-neutral-500 text-xs mt-0.5">{row.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-red-400/70">{row.invoiceStatus === 'unpaid' ? 'unpaid' : row.invoiceStatus === 'open' ? 'open invoice' : 'past due'}</span>
            <span className={`text-[11px] font-medium border-l-2 pl-2 ${membershipBorder[row.membershipType] ?? membershipBorder.GENERAL}`}>
              {(row.membershipType ?? 'GENERAL').toLowerCase()}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
            <span className="text-xs text-neutral-500">amount due</span>
            <span className="text-xs text-red-400/80 tabular-nums font-medium">
              {row.amountDue != null ? `$${(row.amountDue / 100).toFixed(2)}` : PLAN_AMOUNT[row.membershipType] ? `$${PLAN_AMOUNT[row.membershipType]}.00` : '—'}
            </span>
          </div>
          {row.failedAt && (
            <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-neutral-500">failed</span>
              <span className="text-xs text-white">{fmtDate(row.failedAt)}</span>
            </div>
          )}
          {row.declineReason && (
            <div className="flex items-start justify-between px-3 py-2.5 bg-[#1c1c1c] gap-4">
              <span className="text-xs text-neutral-500 shrink-0">decline reason</span>
              <span className="text-xs text-amber-400/70 text-right">{row.declineReason}</span>
            </div>
          )}
        </div>

      </div>

      {/* Actions */}
      <div className="shrink-0 px-5 py-4 border-t border-neutral-800 space-y-2">
        <button
          onClick={() => onAction('retry')}
          className="w-full py-2 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
        >
          retry charge
        </button>
        <button
          onClick={() => onAction('resolve')}
          className="w-full py-2 rounded-lg text-xs font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
        >
          mark resolved
        </button>
        <button
          onClick={() => onAction('cancel')}
          className="w-full py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
        >
          cancel membership
        </button>
      </div>

    </div>
  )
}
