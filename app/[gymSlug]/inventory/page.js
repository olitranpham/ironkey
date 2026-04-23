'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Plus, Search, Minus, RotateCcw, Pencil, Trash2, Package, AlertTriangle, XCircle } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['merchandise', 'concessions', 'equipment', 'supplies', 'other']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function statusColor(status) {
  if (status === 'out') return 'text-rose-400'
  if (status === 'low') return 'text-amber-400'
  return 'text-white'
}

function rowHighlight(status) {
  if (status === 'out') return 'bg-rose-500/5'
  if (status === 'low') return 'bg-amber-500/5'
  return ''
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Bone({ className = '' }) {
  return <div className={`bg-neutral-800 animate-pulse rounded ${className}`} />
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, iconCls = 'text-neutral-400', loading }) {
  return (
    <div className="bg-[#1c1c1c] border border-neutral-800 rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
          <Icon size={14} className={iconCls} />
        </div>
        <span className="text-xs text-neutral-500 font-medium">{label}</span>
      </div>
      {loading
        ? <Bone className="h-8 w-16" />
        : <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      }
    </div>
  )
}

// ── Item Modal (Add / Edit) ───────────────────────────────────────────────────

function ItemModal({ gymSlug, item, onSave, onClose }) {
  const editing = Boolean(item)
  const [form, setForm] = useState({
    name:       item?.name       ?? '',
    category:   item?.category   ?? CATEGORIES[0],
    quantity:   item?.quantity   ?? 0,
    lowStockAt: item?.lowStockAt ?? 5,
    unitCost:   item?.unitCost   ?? '',
    notes:      item?.notes      ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.name.trim())  { setErr('name is required'); return }
    if (!form.category)     { setErr('category is required'); return }
    setSaving(true); setErr(null)
    try {
      const token = localStorage.getItem('ik_token')
      const url    = editing
        ? `/api/${gymSlug}/inventory/${item.id}`
        : `/api/${gymSlug}/inventory`
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name:       form.name.trim(),
          category:   form.category,
          quantity:   parseInt(form.quantity) || 0,
          lowStockAt: parseInt(form.lowStockAt) || 5,
          unitCost:   form.unitCost !== '' ? parseFloat(form.unitCost) : null,
          notes:      form.notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      onSave(json.item, editing)
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
        <p className="text-sm font-semibold text-white">{editing ? 'edit item' : 'add item'}</p>

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">name</label>
          <input
            type="text"
            placeholder="e.g. Protein Bar"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>

        {/* Category */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">category</label>
          <select
            value={form.category}
            onChange={e => set('category', e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Quantity + Low Stock */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-neutral-500">quantity</label>
            <input
              type="number"
              min="0"
              value={form.quantity}
              onChange={e => set('quantity', e.target.value)}
              className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-neutral-500">low stock at</label>
            <input
              type="number"
              min="0"
              value={form.lowStockAt}
              onChange={e => set('lowStockAt', e.target.value)}
              className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
            />
          </div>
        </div>

        {/* Unit cost */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">unit cost <span className="text-neutral-700">(optional)</span></label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.unitCost}
              onChange={e => set('unitCost', e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg pl-6 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">notes <span className="text-neutral-700">(optional)</span></label>
          <input
            type="text"
            placeholder="e.g. stored in back room"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
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
            {saving ? 'saving…' : editing ? 'save changes' : 'add item'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sell Modal ────────────────────────────────────────────────────────────────

function SellModal({ gymSlug, item, onSave, onClose }) {
  const [qty,       setQty]       = useState(1)
  const [logSale,   setLogSale]   = useState(Boolean(item.unitCost))
  const [price,     setPrice]     = useState(item.unitCost ? (item.unitCost * 1).toFixed(2) : '')
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState(null)

  const total = logSale && price ? (parseFloat(price) * qty).toFixed(2) : null

  async function sell() {
    const amount = parseInt(qty)
    if (!amount || amount < 1) { setErr('enter a valid quantity'); return }
    if (amount > item.quantity) { setErr(`only ${item.quantity} in stock`); return }
    setSaving(true); setErr(null)
    try {
      const token = localStorage.getItem('ik_token')

      // Adjust inventory
      const res = await fetch(`/api/${gymSlug}/inventory/${item.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ adjust: -amount, reason: 'sale' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)

      // Optionally log a financial entry
      if (logSale && price && parseFloat(price) > 0) {
        await fetch(`/api/${gymSlug}/financial-entries`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({
            type:        'income',
            category:    item.category,
            amount:      parseFloat(price) * amount,
            description: `${item.name} × ${amount}`,
            date:        new Date().toISOString().split('T')[0],
          }),
        })
      }

      onSave(json.item)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-xs p-6 shadow-2xl flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold text-white">sell item</p>
          <p className="text-xs text-neutral-500 mt-0.5">{item.name} — {item.quantity} in stock</p>
        </div>

        {/* Qty */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">quantity to sell</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQty(q => Math.max(1, q - 1))}
              className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
            >
              <Minus size={12} />
            </button>
            <input
              type="number"
              min="1"
              max={item.quantity}
              value={qty}
              onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="flex-1 text-center bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
            />
            <button
              onClick={() => setQty(q => Math.min(item.quantity, q + 1))}
              className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        {/* Log sale toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLogSale(v => !v)}
            className={`w-8 h-4 rounded-full transition-colors relative ${logSale ? 'bg-emerald-500' : 'bg-neutral-700'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${logSale ? 'left-4' : 'left-0.5'}`} />
          </button>
          <span className="text-xs text-neutral-400">log as income entry</span>
        </div>

        {/* Price per unit */}
        {logSale && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-neutral-500">price per unit</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg pl-6 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
              />
            </div>
            {total && (
              <p className="text-[11px] text-neutral-500">total: <span className="text-emerald-400 font-medium">${total}</span></p>
            )}
          </div>
        )}

        {err && <p className="text-xs text-rose-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 transition-colors"
          >
            cancel
          </button>
          <button
            onClick={sell}
            disabled={saving || item.quantity === 0}
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 transition-colors"
          >
            {saving ? 'saving…' : 'sell'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Restock Modal ─────────────────────────────────────────────────────────────

function RestockModal({ gymSlug, item, onSave, onClose }) {
  const [qty,    setQty]    = useState(10)
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)

  async function restock() {
    const amount = parseInt(qty)
    if (!amount || amount < 1) { setErr('enter a valid quantity'); return }
    setSaving(true); setErr(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/inventory/${item.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ adjust: amount, reason: 'restock' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      onSave(json.item)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-xs p-6 shadow-2xl flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold text-white">restock</p>
          <p className="text-xs text-neutral-500 mt-0.5">{item.name} — currently {item.quantity}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">quantity to add</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQty(q => Math.max(1, q - 1))}
              className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
            >
              <Minus size={12} />
            </button>
            <input
              type="number"
              min="1"
              value={qty}
              onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="flex-1 text-center bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
            />
            <button
              onClick={() => setQty(q => q + 1)}
              className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
            >
              <Plus size={12} />
            </button>
          </div>
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
            onClick={restock}
            disabled={saving}
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 transition-colors"
          >
            {saving ? 'saving…' : 'restock'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { gymSlug } = useParams()

  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [err,        setErr]        = useState(null)
  const [search,     setSearch]     = useState('')
  const [activeTab,  setActiveTab]  = useState('all')
  const [addModal,   setAddModal]   = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [sellItem,   setSellItem]   = useState(null)
  const [restockItem, setRestockItem] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/inventory`, { headers: { Authorization: `Bearer ${token}` } })
      const json  = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      setItems(json.items)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { load() }, [load])

  // ── Derived ──────────────────────────────────────────────────────────────
  const totalItems   = items.length
  const lowCount     = items.filter(i => i.status === 'low').length
  const outCount     = items.filter(i => i.status === 'out').length

  const filtered = items.filter(item => {
    const matchCat    = activeTab === 'all' || item.category === activeTab
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleItemSaved(item, editing) {
    if (editing) {
      setItems(prev => prev.map(i => i.id === item.id ? item : i))
      setEditItem(null)
    } else {
      setItems(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
      setAddModal(false)
    }
  }

  function handleAdjusted(updated) {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
    setSellItem(null)
    setRestockItem(null)
  }

  async function deleteItem(id) {
    if (!confirm('Delete this item?')) return
    setDeletingId(id)
    try {
      const token = localStorage.getItem('ik_token')
      await fetch(`/api/${gymSlug}/inventory/${id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setItems(prev => prev.filter(i => i.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  const tabs = ['all', ...CATEGORIES]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">inventory</h1>
        <button
          onClick={() => setAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15 transition-colors"
        >
          <Plus size={11} />
          add item
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
        {err ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-rose-400">{err}</p>
            <button onClick={load} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
          </div>
        ) : (
          <>
            {/* ── Metric cards ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-4">
              <MetricCard icon={Package}       label="total items"  value={totalItems} loading={loading} />
              <MetricCard icon={AlertTriangle} label="low stock"    value={lowCount}   loading={loading} iconCls={lowCount  > 0 ? 'text-amber-400' : 'text-neutral-400'} />
              <MetricCard icon={XCircle}       label="out of stock" value={outCount}   loading={loading} iconCls={outCount  > 0 ? 'text-rose-400'  : 'text-neutral-400'} />
            </div>

            {/* ── Search + category tabs ─────────────────────────────────────── */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Search */}
              <div className="relative w-full sm:max-w-xs">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  placeholder="search items…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-[#1c1c1c] border border-neutral-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
                />
              </div>

              {/* Category tabs */}
              <div className="flex items-center gap-1 flex-wrap">
                {tabs.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      activeTab === tab
                        ? 'bg-white/10 text-white'
                        : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Table ─────────────────────────────────────────────────────── */}
            <div className="bg-[#1c1c1c] border border-neutral-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">item</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">category</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">qty</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">unit cost</th>
                    <th className="px-5 py-3 text-[11px] font-semibold text-neutral-500 tracking-wider">total value</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-neutral-800/40">
                        <td className="px-5 py-3.5"><Bone className="h-3 w-36" /></td>
                        <td className="px-5 py-3.5"><Bone className="h-3 w-20" /></td>
                        <td className="px-5 py-3.5"><Bone className="h-3 w-10" /></td>
                        <td className="px-5 py-3.5"><Bone className="h-3 w-16" /></td>
                        <td className="px-5 py-3.5"><Bone className="h-3 w-16" /></td>
                        <td className="px-5 py-3.5"><Bone className="h-5 w-24 rounded-full" /></td>
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-sm text-neutral-600">
                        {items.length === 0 ? 'no items yet — click "add item" to get started' : 'no items match your search'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map(item => (
                      <tr
                        key={item.id}
                        className={`border-b border-neutral-800/40 transition-colors hover:bg-white/[0.025] ${rowHighlight(item.status)}`}
                      >
                        <td className="px-5 py-3">
                          <p className="text-white text-xs font-medium">{item.name}</p>
                          {item.notes && <p className="text-neutral-600 text-[11px] mt-0.5">{item.notes}</p>}
                        </td>
                        <td className="px-5 py-3 text-neutral-400 text-xs">{item.category}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs font-semibold tabular-nums ${statusColor(item.status)}`}>
                            {item.quantity}
                          </span>
                          {item.status === 'low' && (
                            <span className="ml-1.5 text-[10px] text-amber-500/70">low</span>
                          )}
                          {item.status === 'out' && (
                            <span className="ml-1.5 text-[10px] text-rose-500/70">out</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-neutral-400 text-xs tabular-nums">
                          {item.unitCost != null ? fmt(item.unitCost) : '—'}
                        </td>
                        <td className="px-5 py-3 text-neutral-300 text-xs tabular-nums font-medium">
                          {item.unitCost != null ? fmt(item.unitCost * item.quantity) : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* Sell */}
                            <button
                              onClick={() => setSellItem(item)}
                              disabled={item.quantity === 0}
                              title="sell"
                              className="p-1.5 rounded-md text-neutral-600 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus size={13} />
                            </button>
                            {/* Restock */}
                            <button
                              onClick={() => setRestockItem(item)}
                              title="restock"
                              className="p-1.5 rounded-md text-neutral-600 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            >
                              <RotateCcw size={13} />
                            </button>
                            {/* Edit */}
                            <button
                              onClick={() => setEditItem(item)}
                              title="edit"
                              className="p-1.5 rounded-md text-neutral-600 hover:text-white hover:bg-white/10 transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            {/* Delete */}
                            <button
                              onClick={() => deleteItem(item.id)}
                              disabled={deletingId === item.id}
                              title="delete"
                              className="p-1.5 rounded-md text-neutral-700 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
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

      {/* Modals */}
      {addModal    && <ItemModal    gymSlug={gymSlug} item={null}    onSave={handleItemSaved}  onClose={() => setAddModal(false)} />}
      {editItem    && <ItemModal    gymSlug={gymSlug} item={editItem} onSave={handleItemSaved} onClose={() => setEditItem(null)} />}
      {sellItem    && <SellModal    gymSlug={gymSlug} item={sellItem}    onSave={handleAdjusted} onClose={() => setSellItem(null)} />}
      {restockItem && <RestockModal gymSlug={gymSlug} item={restockItem} onSave={handleAdjusted} onClose={() => setRestockItem(null)} />}
    </div>
  )
}
