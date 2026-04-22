'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { RefreshCw, TrendingUp, DollarSign, Calendar, BarChart2 } from 'lucide-react'

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

function fmtDate(unix) {
  return new Date(unix * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ── Skeleton primitive ────────────────────────────────────────────────────────

function Bone({ className = '' }) {
  return <div className={`bg-neutral-800 animate-pulse rounded ${className}`} />
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1c1c1c] border border-neutral-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-neutral-400 mb-1">{label}</p>
      <p className="text-white font-semibold">{fmtExact(payload[0].value)}</p>
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, loading }) {
  return (
    <div className="bg-[#1c1c1c] border border-neutral-800 rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
          <Icon size={14} className="text-neutral-400" />
        </div>
        <span className="text-xs text-neutral-500 font-medium">{label}</span>
      </div>
      {loading
        ? <Bone className="h-8 w-28" />
        : <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      }

    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RevenuePage() {
  const { gymSlug } = useParams()

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/stripe/revenue`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json  = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      setData(json)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { load() }, [load])

  const chartData = (data?.monthly ?? []).map(m => ({
    name:   shortMonth(m.month),
    amount: m.amount,
  }))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">revenue</h1>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          refresh
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">

        {err ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-red-400">{err}</p>
            <button onClick={load} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
          </div>
        ) : (
          <>
            {/* ── Summary cards — visible immediately with skeleton ──────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard icon={TrendingUp} label="MRR"        value={fmt(data?.mrr)}       loading={loading} />
              <SummaryCard icon={DollarSign} label="this month" value={fmt(data?.thisMonth)} loading={loading} />
              <SummaryCard icon={Calendar}   label="last month" value={fmt(data?.lastMonth)} loading={loading} />
              <SummaryCard icon={BarChart2}  label="YTD"        value={fmt(data?.ytd)}       loading={loading} />
            </div>

            {/* ── Monthly chart ──────────────────────────────────────────────── */}
            <div className="bg-[#1c1c1c] border border-neutral-800 rounded-xl p-5">
              <p className="text-xs font-semibold text-neutral-400 mb-5">monthly revenue</p>
              {loading ? (
                <div className="flex items-end gap-2 h-[220px] px-1">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Bone
                      key={i}
                      className="flex-1 bg-neutral-800"
                      style={{ height: `${30 + Math.sin(i * 0.8) * 20 + (i % 3) * 15}%` }}
                    />
                  ))}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} barSize={28} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: '#737373', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#737373', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={40} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="amount" fill="#ffffff" radius={[4, 4, 0, 0]} opacity={0.9} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* ── Recent transactions ────────────────────────────────────────── */}
            <div className="bg-[#1c1c1c] border border-neutral-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-neutral-800">
                <p className="text-xs font-semibold text-neutral-400">recent transactions</p>
              </div>
              <div className="overflow-auto max-h-[220px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-800 text-left">
                      <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">date</th>
                      <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">member</th>
                      <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">amount</th>
                      <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-neutral-800/40">
                          <td className="px-5 py-3.5"><Bone className="h-3 w-24" /></td>
                          <td className="px-5 py-3.5 flex flex-col gap-1.5">
                            <Bone className="h-3 w-32" />
                            <Bone className="h-2.5 w-44" />
                          </td>
                          <td className="px-5 py-3.5"><Bone className="h-3 w-14" /></td>
                          <td className="px-5 py-3.5"><Bone className="h-5 w-16 rounded-full" /></td>
                        </tr>
                      ))
                    ) : (data?.transactions ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-5 py-10 text-center text-sm text-neutral-600">
                          no transactions found
                        </td>
                      </tr>
                    ) : (
                      data.transactions.slice(0, 5).map(tx => (
                        <tr key={tx.id} className="border-b border-neutral-800/40 hover:bg-white/[0.025] transition-colors">
                          <td className="px-5 py-3 text-neutral-400 text-xs tabular-nums whitespace-nowrap">
                            {fmtDate(tx.date)}
                          </td>
                          <td className="px-5 py-3">
                            <p className="text-white text-xs font-medium">{tx.name ?? '—'}</p>
                            {tx.email && <p className="text-neutral-500 text-[11px]">{tx.email}</p>}
                          </td>
                          <td className="px-5 py-3 text-white text-xs tabular-nums font-medium">
                            {fmtExact(tx.amount)}
                          </td>
                          <td className="px-5 py-3">
                            <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                              {tx.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
