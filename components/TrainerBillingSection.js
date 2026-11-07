'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

const money = cents => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const day   = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).toLowerCase() : '—')
const INPUT = 'bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-neutral-500 disabled:opacity-40'
const BTN   = 'text-xs px-2.5 py-1 rounded-md bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 transition-colors'

/** Next 1st of the month, Boston time — mirrors lib/trainerBilling nextMonthAnchor, for the confirm copy. */
function nextFirst() {
  const [y, m] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).split('-').map(Number)
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 1, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
}

/**
 * "pt billing" on the personal training page — OWNER / ADMIN
 * only (renders nothing for anyone else). Per trainer: link a promotion code
 * and a Stripe customer (a member's email or cus_…), see the card on file
 * (or a "no payment method" flag + card setup link), start billing, and
 * verify the month: visits, metered visits, amount so far, cap, invoices and
 * the visit list (same-day repeats flagged).
 */
export function TrainerBillingSection({ gymSlug }) {
  const [allowed,  setAllowed]  = useState(false)
  const [data,     setData]     = useState(null)
  const [month,    setMonth]    = useState('')
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [busy,     setBusy]     = useState(null)    // trainer id with a request in flight
  const [open,     setOpen]     = useState({})      // trainer id → visit list expanded
  const [drafts,   setDrafts]   = useState({})      // trainer id → customer input
  const [confirm,  setConfirm]  = useState(null)    // trainer row awaiting "start billing" confirmation

  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ik_token')}` })

  useEffect(() => {
    fetch(`/api/${gymSlug}/me`, { headers: headers() })
      .then(r => (r.ok ? r.json() : null))
      .then(me => setAllowed(['OWNER', 'ADMIN'].includes(me?.role)))
      .catch(() => setAllowed(false))
  }, [gymSlug])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/pt/trainer-billing${month ? `?month=${month}` : ''}`, { headers: headers() })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'could not load trainer billing')
      setData(json)
      if (!month) setMonth(json.month)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [gymSlug, month])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  async function call(trainerId, path, body, method = 'POST') {
    setBusy(trainerId)
    try {
      const res  = await fetch(`/api/${gymSlug}/pt/trainer-billing/${trainerId}${path}`, { method, headers: headers(), body: JSON.stringify(body ?? {}) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'something went wrong — please try again')
      return json
    } catch (err) {
      alert(err.message)
      return null
    } finally {
      setBusy(null)
    }
  }

  async function saveLink(t, patch) {
    if (await call(t.id, '', patch, 'PATCH')) load()
  }

  async function setupLink(t) {
    const json = await call(t.id, '/setup-link')
    if (!json?.url) return
    try { await navigator.clipboard.writeText(json.url); alert('card setup link copied — send it to the trainer') }
    catch { prompt('card setup link — send it to the trainer', json.url) }
  }

  async function startBilling(t) {
    setConfirm(null)
    if (await call(t.id, '/start', { paymentMethodId: t.paymentMethod.id })) load()
  }

  if (!allowed) return null

  return (
    <div className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden shrink-0">
      <div className="px-5 py-3 border-b border-neutral-800 flex items-center gap-3">
        <p className="text-xs font-semibold text-neutral-500 tracking-widest">pt billing</p>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={`${INPUT} ml-auto`} aria-label="month" />
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-24 gap-2">
          <RefreshCw size={14} className="text-neutral-600 animate-spin" />
          <span className="text-xs text-neutral-600">loading…</span>
        </div>
      ) : error ? (
        <p className="text-xs text-red-400 px-5 py-4">{error}</p>
      ) : (
        <div className="divide-y divide-neutral-800">
          {data.trainers.map(t => {
            const linked  = t.promotionCodeId && t.stripeCustomerId
            const canStart = linked && t.paymentMethod && !t.billing
            return (
              <div key={t.id} className="px-5 py-4 flex flex-col gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-sm text-white">{t.name.toLowerCase()}</p>
                  {t.billing
                    ? <span className="text-[11px] text-emerald-400">billing {t.billing.status} · next invoice {day(t.billing.nextInvoiceAt)}</span>
                    : <span className="text-[11px] text-neutral-500">not billing</span>}
                </div>

                {/* Links: promotion code + Stripe customer */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2">
                    <span className="text-neutral-500 w-20 shrink-0">code</span>
                    <select
                      value={t.promotionCodeId ?? ''}
                      disabled={busy === t.id}
                      onChange={e => saveLink(t, { promotionCodeId: e.target.value || null })}
                      className={INPUT}
                    >
                      <option value="">none</option>
                      {data.promotionCodes.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
                      {t.promotionCodeId && !data.promotionCodes.some(p => p.id === t.promotionCodeId) && (
                        <option value={t.promotionCodeId}>{t.promotionCode} (inactive)</option>
                      )}
                    </select>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-500 w-20 shrink-0">customer</span>
                    {t.billing ? (
                      <span className="text-neutral-300 truncate">{t.customerLabel}</span>
                    ) : (
                      <>
                        <input
                          value={drafts[t.id] ?? ''}
                          placeholder={t.customerLabel ?? 'member email or cus_…'}
                          onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                          className={`${INPUT} flex-1 min-w-0`}
                        />
                        <button className={BTN} disabled={busy === t.id || !(drafts[t.id] ?? '').trim()} onClick={() => saveLink(t, { customer: drafts[t.id] })}>save</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Payment method + start */}
                {t.stripeCustomerId && (
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span className="text-neutral-500 w-20 shrink-0">card</span>
                    {t.paymentMethod
                      ? <span className="text-neutral-300">{t.paymentMethod.brand} •••• {t.paymentMethod.last4}{t.paymentMethod.exp && ` · exp ${t.paymentMethod.exp}`} <span className="text-neutral-600">({t.paymentMethod.source})</span></span>
                      : <span className="text-amber-400">no payment method</span>}
                    <button className={BTN} disabled={busy === t.id} onClick={() => setupLink(t)}>send card setup link</button>
                    {!t.billing && (
                      <button className={BTN} disabled={busy === t.id || !canStart} onClick={() => setConfirm(t)}>start billing</button>
                    )}
                  </div>
                )}

                {/* This month */}
                {t.promotionCodeId && (
                  <div className="flex items-center gap-4 flex-wrap text-xs">
                    <span className="text-neutral-500 w-20 shrink-0">{data.month}</span>
                    <span className="text-white tabular-nums">{t.month.visits} visit{t.month.visits === 1 ? '' : 's'}</span>
                    <span className="text-neutral-400 tabular-nums">{t.month.billedVisits} billed · {money(t.month.amountCents)}</span>
                    {t.month.capReached && <span className="text-amber-400">cap reached</span>}
                    {t.visits.length > 0 && (
                      <button className="flex items-center gap-1 text-neutral-400 hover:text-white" onClick={() => setOpen(o => ({ ...o, [t.id]: !o[t.id] }))}>
                        {open[t.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />} visits
                      </button>
                    )}
                  </div>
                )}

                {open[t.id] && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] text-neutral-500 border-b border-neutral-800">
                        <th className="py-1.5 font-medium">date</th>
                        <th className="py-1.5 font-medium">guest</th>
                        <th className="py-1.5 font-medium">session</th>
                        <th className="py-1.5 font-medium">billed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.visits.map(v => (
                        <tr key={v.id} className="border-b border-neutral-800/60 last:border-b-0">
                          <td className="py-1.5 text-neutral-300 whitespace-nowrap">{day(v.date)}</td>
                          <td className="py-1.5 text-neutral-300">
                            {v.guestName}
                            {v.sameDayRepeat && <span className="ml-2 text-[10px] text-amber-400">same-day repeat</span>}
                          </td>
                          <td className="py-1.5 text-neutral-500 font-mono">{v.sessionId ? `${v.sessionId.slice(0, 18)}…` : '—'}</td>
                          <td className="py-1.5">
                            {v.billed === 'yes' ? <span className="text-emerald-400">yes</span>
                              : v.billed === 'pre-billing' ? <span className="text-sky-400">pre-billing</span>
                              : <span className="text-neutral-600">no</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {t.invoices.length > 0 && (
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="text-neutral-500">invoices</span>
                    {t.invoices.map(i => (
                      <div key={i.id} className="flex items-center gap-3">
                        <span className="text-neutral-300 w-40">{day(i.periodStart)} – {day(i.periodEnd)}</span>
                        <span className="text-white tabular-nums w-20">{money(i.total)}</span>
                        <span className={i.status === 'paid' ? 'text-emerald-400' : i.status === 'open' ? 'text-amber-400' : 'text-neutral-500'}>{i.status}</span>
                        {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-neutral-400 underline underline-offset-2 hover:text-white">view</a>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setConfirm(null)} />
          <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl flex flex-col gap-3">
            <p className="text-sm font-semibold text-white">start billing {confirm.name.toLowerCase()}?</p>
            <ul className="text-xs text-neutral-400 flex flex-col gap-1">
              <li>code {confirm.promotionCode} — $20 per guest pass, $500 / month cap</li>
              <li>charged to {confirm.paymentMethod.brand} •••• {confirm.paymentMethod.last4}</li>
              <li>first invoice {nextFirst()}, then the 1st of every month</li>
              <li>only visits from now on are billed</li>
            </ul>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setConfirm(null)} className="flex-1 py-2 rounded-lg text-xs text-neutral-400 border border-neutral-700 hover:text-white">cancel</button>
              <button onClick={() => startBilling(confirm)} className="flex-1 py-2 rounded-lg text-xs font-medium bg-white text-black hover:bg-neutral-200">start billing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
