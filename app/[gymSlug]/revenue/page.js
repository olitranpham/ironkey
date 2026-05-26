'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { Plus, Trash2 } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const INCOME_CATEGORIES  = ['merchandise', 'concessions', 'events', 'other']
const EXPENSE_CATEGORIES = ['rent', 'equipment', 'supplies', 'marketing', 'other']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtExact(n) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function shortMonth(key) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'short' })
}

function fmtDate(val) {
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Bone({ className = '' }) {
  return <div className={`bg-neutral-800 animate-pulse rounded ${className}`} />
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1c1c1c] border border-neutral-700 rounded-lg px-3 py-2 text-xs shadow-xl space-y-1">
      <p className="text-neutral-400 mb-1">{label}</p>
      {payload.map(p => p.value !== 0 && (
        <p key={p.dataKey} style={{ color: p.fill }} className="flex justify-between gap-4">
          <span>{p.name}</span>
          <span className="font-semibold text-white">{fmtExact(Math.abs(p.value))}</span>
        </p>
      ))}
    </div>
  )
}

// ── Add Entry Modal ───────────────────────────────────────────────────────────

function EntryModal({ gymSlug, onSave, onClose }) {
  const [form, setForm] = useState({
    type: 'income', category: 'Merchandise', amount: '', description: '', date: todayISO(),
  })
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)

  const categories = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  function set(k, v) {
    setForm(f => ({
      ...f,
      [k]: v,
      // reset category when switching type
      ...(k === 'type' ? { category: (v === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0] } : {}),
    }))
  }

  async function save() {
    if (!form.amount || isNaN(parseFloat(form.amount))) { setErr('enter a valid amount'); return }
    setSaving(true); setErr(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/financial-entries`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      onSave(json.entry)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl flex flex-col gap-4">
        <p className="text-sm font-semibold text-white">add entry</p>

        {/* Type toggle */}
        <div className="flex rounded-lg bg-neutral-900 p-1 gap-1">
          {['income', 'expense'].map(t => (
            <button
              key={t}
              onClick={() => set('type', t)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                form.type === t
                  ? t === 'income' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Category */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">category</label>
          <select
            value={form.category}
            onChange={e => set('category', e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg pl-6 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
            />
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">description <span className="text-neutral-700">(optional)</span></label>
          <input
            type="text"
            placeholder="e.g. August rent payment"
            value={form.description}
            onChange={e => set('description', e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>

        {/* Date */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">date</label>
          <input
            type="date"
            value={form.date}
            onChange={e => set('date', e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
          />
        </div>

        {err && <p className="text-xs text-rose-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 transition-colors"
          >
            cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 transition-colors"
          >
            {saving ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RevenuePage() {
  const { gymSlug } = useParams()

  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [err,          setErr]          = useState(null)
  const [entries,      setEntries]      = useState([])
  const [modalOpen,    setModalOpen]    = useState(false)
  const [deletingId,   setDeletingId]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const token   = localStorage.getItem('ik_token')
      const headers = { Authorization: `Bearer ${token}` }
      const [revRes, entRes] = await Promise.all([
        fetch(`/api/${gymSlug}/stripe/revenue`,      { headers }),
        fetch(`/api/${gymSlug}/financial-entries`,   { headers }),
      ])
      const revJson = await revRes.json()
      if (!revRes.ok) throw new Error(revJson.error ?? revRes.status)
      setData(revJson)
      if (entRes.ok) {
        const entJson = await entRes.json()
        setEntries(entJson.entries ?? [])
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { load() }, [load])

  // ── Chart data: merge Stripe monthly + manual entries ─────────────────────
  const chartData = (() => {
    const entryMap = {}
    for (const e of entries) {
      const d   = new Date(e.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!entryMap[key]) entryMap[key] = { income: 0, expenses: 0 }
      if (e.type === 'income') entryMap[key].income   += e.amount
      else                     entryMap[key].expenses += e.amount
    }
    return (data?.monthly ?? []).map(m => ({
      name:     shortMonth(m.month),
      stripe:   m.amount,
      income:   entryMap[m.month]?.income   ?? 0,
      expenses: -(entryMap[m.month]?.expenses ?? 0),  // negative → below axis
    }))
  })()

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleSaved(entry) {
    setEntries(prev => [entry, ...prev])
    setModalOpen(false)
  }

  async function deleteEntry(id) {
    setDeletingId(id)
    try {
      const token = localStorage.getItem('ik_token')
      await fetch(`/api/${gymSlug}/financial-entries/${id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setEntries(prev => prev.filter(e => e.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  const hasExpenses = chartData.some(d => d.expenses < 0)

  return (
    <div className="flex-1 overflow-y-auto">

      {/* Top bar */}
      <header className="sticky top-0 z-20 h-14 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">revenue</h1>
      </header>

      <main className="p-5 flex flex-col gap-5">
        {err ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-rose-400">{err}</p>
            <button onClick={load} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
          </div>
        ) : (
          <>
            {/* ── Monthly chart ──────────────────────────────────────────────── */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-center justify-between mb-5">
                <p className="text-xs font-semibold text-neutral-400">monthly revenue</p>
                <div className="flex items-center gap-4 text-[11px] text-neutral-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded inline-block" style={{ background: '#3a3a3a' }} />stripe</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded inline-block" style={{ background: '#2a2a2a' }} />income</span>
                  {hasExpenses && <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded inline-block" style={{ background: '#1e1e1e' }} />expenses</span>}
                </div>
              </div>
              {loading ? (
                <div className="flex items-end gap-2 h-[220px] px-1">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Bone key={i} className="flex-1" style={{ height: `${30 + Math.sin(i * 0.8) * 20 + (i % 3) * 15}%` }} />
                  ))}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} barSize={20} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: '#737373', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#737373', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={40} />
                    <ReferenceLine y={0} stroke="#404040" />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="stripe"   name="stripe"  stackId="pos" fill="#3a3a3a" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="income"   name="income"  stackId="pos" fill="#2a2a2a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="expense" fill="#1e1e1e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* ── Recent Stripe transactions ─────────────────────────────────── */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
                <p className="text-sm font-semibold text-white">recent transactions</p>
              </div>
              <table className="w-full">
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                        <td className="px-5 py-3"><Bone className="h-3 w-24" /></td>
                        <td className="px-5 py-3"><Bone className="h-3 w-32" /></td>
                        <td className="px-5 py-3"><Bone className="h-3 w-14" /></td>
                        <td className="px-5 py-3"><Bone className="h-3 w-16" /></td>
                      </tr>
                    ))
                  ) : (data?.transactions ?? []).length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-16 text-center text-sm text-neutral-600">no transactions found</td></tr>
                  ) : (
                    data.transactions.slice(0, 10).map((tx, i) => (
                      <tr key={tx.id} className={`hover:bg-white/5 transition-colors ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                        <td className="px-5 py-3 text-neutral-400 text-xs tabular-nums whitespace-nowrap">{fmtDate(tx.date * 1000)}</td>
                        <td className="px-5 py-3">
                          <p className="text-white text-xs">{tx.name ?? '—'}</p>
                        </td>
                        <td className="px-5 py-3 text-white text-xs tabular-nums">{fmtExact(tx.amount)}</td>
                        <td className="px-5 py-3 text-xs text-emerald-600">{tx.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Manual income & expenses ───────────────────────────────────── */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
                <p className="text-sm font-semibold text-white">
                  other income & expenses
                  {entries.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-neutral-500">({entries.length})</span>
                  )}
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Plus size={11} />
                  add entry
                </button>
              </div>
              <table className="w-full">
                <tbody>
                  {entries.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-16 text-center text-sm text-neutral-600">no entries yet — click "add entry" to get started</td></tr>
                  ) : (
                    entries.map((e, i) => (
                      <tr key={e.id} className={`group hover:bg-white/5 transition-colors ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                        <td className="px-5 py-3 text-neutral-400 text-xs tabular-nums whitespace-nowrap">{fmtDate(e.date)}</td>
                        <td className="px-5 py-3 text-xs">
                          <span className={e.type === 'income' ? 'text-emerald-600' : 'text-rose-400/70'}>
                            {e.type}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-neutral-400 text-xs">{e.category}</td>
                        <td className="px-5 py-3 text-neutral-500 text-xs max-w-[200px] truncate">{e.description ?? '—'}</td>
                        <td className="px-5 py-3 text-xs tabular-nums">
                          <span className={e.type === 'income' ? 'text-emerald-600' : 'text-rose-400/70'}>
                            {e.type === 'expense' ? '−' : '+'}{fmtExact(e.amount)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => deleteEntry(e.id)}
                            disabled={deletingId === e.id}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-neutral-700 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {modalOpen && <EntryModal gymSlug={gymSlug} onSave={handleSaved} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
