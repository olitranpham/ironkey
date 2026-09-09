'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Plus, Trash2, Pencil } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const MEMBERSHIP_INTERVALS = [
  { value: 'week:1',  label: 'weekly',         interval: 'week',  intervalCount: 1 },
  { value: 'week:4',  label: 'every 4 weeks',  interval: 'week',  intervalCount: 4 },
  { value: 'month:1', label: 'monthly',        interval: 'month', intervalCount: 1 },
  { value: 'month:6', label: 'every 6 months', interval: 'month', intervalCount: 6 },
  { value: 'year:1',  label: 'yearly',         interval: 'year',  intervalCount: 1 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

// Display-only — adds spaces around the slash in Oasis PT price nicknames
// ("1 session/week" → "1 session / week") without touching the stored value.
function displayLabel(label) {
  if (!label) return label
  return label.replace(/(\d+\s*sessions?)\s*\/\s*week/i, '$1 / week')
}

// Display-only — lowercases Hydra's "Coaching/Programs" product name (and its
// "(NON-MEMBERS)" variant) without touching the stored Stripe product name.
function displayProductName(gymSlug, name) {
  if (gymSlug === 'hydra-athletic-co' && /^coaching\/programs/i.test(name)) return name.toLowerCase()
  return name
}

function token() {
  return localStorage.getItem('ik_token')
}

function fmtCouponDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtCouponDuration(c) {
  if (c.duration === 'repeating') return `${c.durationInMonths} month${c.durationInMonths === 1 ? '' : 's'}`
  if (c.duration === 'forever')   return 'forever'
  return 'once'
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={on ? 'active — click to deactivate' : 'inactive — click to activate'}
      className={`w-8 h-4 rounded-full transition-colors relative shrink-0 disabled:opacity-40 ${on ? 'bg-emerald-500' : 'bg-neutral-700'}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
    </button>
  )
}

// ── Add / Edit Membership Plan Modal ─────────────────────────────────────────

function AddPlanModal({ initial, onSave, onClose, saving }) {
  const isEdit = Boolean(initial)
  const [name,         setName]         = useState(initial?.name ?? '')
  const [price,        setPrice]        = useState(initial ? String(initial.amount) : '')
  const [intervalKey,  setIntervalKey]  = useState(initial?.intervalKey ?? MEMBERSHIP_INTERVALS[2].value)  // monthly default
  const [err,          setErr]          = useState(null)

  function save() {
    if (!name.trim())               { setErr('name is required'); return }
    if (!price || Number(price) <= 0) { setErr('enter a valid price'); return }
    const opt = MEMBERSHIP_INTERVALS.find(o => o.value === intervalKey)
    setErr(null)
    if (isEdit) {
      const priceChanged = Number(price) !== initial.amount || intervalKey !== initial.intervalKey
      onSave({
        productId:     initial.id,
        name:          name.trim(),
        amount:        parseFloat(price),
        interval:      opt.interval,
        intervalCount: opt.intervalCount,
        priceChanged,
        oldPriceId:    initial.priceId,
        priceLabel:    initial.priceLabel,
      })
    } else {
      onSave({
        kind: 'membership',
        name: name.trim(),
        price: parseFloat(price),
        interval: opt.interval,
        intervalCount: opt.intervalCount,
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl flex flex-col gap-4">
        <p className="text-sm font-semibold text-white">{isEdit ? 'edit plan' : 'add plan'}</p>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">name</label>
          <input
            type="text" placeholder="e.g. General Membership"
            value={name} onChange={e => setName(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              value={price} onChange={e => setPrice(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg pl-6 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">billing interval</label>
          <select
            value={intervalKey} onChange={e => setIntervalKey(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
          >
            {MEMBERSHIP_INTERVALS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {err && <p className="text-xs text-rose-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 transition-colors">
            cancel
          </button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 transition-colors">
            {saving ? 'saving…' : isEdit ? 'save changes' : 'add plan'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add / Edit Guest Pass Type Modal ──────────────────────────────────────────

function AddGuestPassModal({ initial, onSave, onClose, saving }) {
  const isEdit = Boolean(initial)
  const [name,   setName]   = useState(initial?.name ?? '')
  const [price,  setPrice]  = useState(initial ? String(initial.amount) : '')
  const [passes, setPasses] = useState(initial ? String(initial.passes) : '1')
  const [err,    setErr]    = useState(null)

  function save() {
    if (!name.trim())                  { setErr('name is required'); return }
    if (!price || Number(price) <= 0)  { setErr('enter a valid price'); return }
    if (!passes || Number(passes) < 1) { setErr('enter a valid number of passes'); return }
    setErr(null)
    if (isEdit) {
      const priceChanged = Number(price) !== initial.amount
      onSave({
        productId:  initial.id,
        name:       name.trim(),
        amount:     parseFloat(price),
        passes:     parseInt(passes, 10),
        priceChanged,
        oldPriceId: initial.priceId,
      })
    } else {
      onSave({
        kind: 'guestPass',
        name: name.trim(),
        price: parseFloat(price),
        passes: parseInt(passes, 10),
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl flex flex-col gap-4">
        <p className="text-sm font-semibold text-white">{isEdit ? 'edit guest pass type' : 'add guest pass type'}</p>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">name</label>
          <input
            type="text" placeholder="e.g. 5-Pack Day Pass"
            value={name} onChange={e => setName(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">price</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              value={price} onChange={e => setPrice(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg pl-6 pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">number of passes</label>
          <input
            type="number" min="1" step="1"
            value={passes} onChange={e => setPasses(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500"
          />
        </div>

        {err && <p className="text-xs text-rose-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 transition-colors">
            cancel
          </button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 transition-colors">
            {saving ? 'saving…' : isEdit ? 'save changes' : 'add guest pass type'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Coupon Modal ──────────────────────────────────────────────────────────

function AddCouponModal({ activeProducts, onSave, onClose, saving }) {
  const [code,             setCode]             = useState('')
  const [discountType,     setDiscountType]     = useState('percent')
  const [value,            setValue]            = useState('')
  const [duration,         setDuration]         = useState('once')
  const [durationInMonths, setDurationInMonths] = useState('')
  const [restrictedIds,    setRestrictedIds]    = useState([])
  const [expiresAt,        setExpiresAt]        = useState('')
  const [maxRedemptions,   setMaxRedemptions]   = useState('')
  const [err,              setErr]              = useState(null)

  function toggleProduct(id) {
    setRestrictedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function save() {
    if (!code.trim())                 { setErr('code is required'); return }
    if (!value || Number(value) <= 0) { setErr('enter a valid value'); return }
    if (discountType === 'percent' && Number(value) > 100) { setErr('percent cannot exceed 100'); return }
    if (duration === 'repeating' && (!durationInMonths || Number(durationInMonths) < 1)) { setErr('enter a valid number of months'); return }
    setErr(null)
    onSave({
      code:                 code.trim(),
      discountType,
      // amount is sent in cents (API contract), converted from the dollar
      // amount typed here — same convention as prices elsewhere on this page.
      value:                discountType === 'amount' ? Math.round(Number(value) * 100) : Number(value),
      duration,
      durationInMonths:     duration === 'repeating' ? parseInt(durationInMonths, 10) : undefined,
      restrictedProductIds: restrictedIds.length > 0 ? restrictedIds : undefined,
      expiresAt:            expiresAt || undefined,
      maxRedemptions:       maxRedemptions ? parseInt(maxRedemptions, 10) : undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
        <p className="text-sm font-semibold text-white">add coupon</p>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">code</label>
          <input
            type="text" placeholder="e.g. SUMMER25"
            value={code} onChange={e => setCode(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">discount type</label>
          <div className="flex gap-1.5">
            {['percent', 'amount'].map(t => (
              <button
                key={t}
                onClick={() => setDiscountType(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${discountType === t ? 'bg-white/15 text-white' : 'bg-neutral-900 border border-neutral-700 text-neutral-500 hover:text-white'}`}
              >
                {t === 'percent' ? '% off' : '$ off'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">{discountType === 'percent' ? 'percent off' : 'amount off'}</label>
          <div className="relative">
            {discountType === 'amount' && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">$</span>
            )}
            <input
              type="number" min="0" step={discountType === 'percent' ? '1' : '0.01'} max={discountType === 'percent' ? '100' : undefined}
              placeholder={discountType === 'percent' ? '25' : '10.00'}
              value={value} onChange={e => setValue(e.target.value)}
              className={`w-full bg-neutral-900 border border-neutral-700 rounded-lg ${discountType === 'amount' ? 'pl-6' : 'pl-3'} pr-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500`}
            />
            {discountType === 'percent' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">%</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">duration</label>
          <div className="flex gap-1.5">
            {['once', 'repeating'].map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${duration === d ? 'bg-white/15 text-white' : 'bg-neutral-900 border border-neutral-700 text-neutral-500 hover:text-white'}`}
              >
                {d === 'once' ? 'once' : 'repeating'}
              </button>
            ))}
          </div>
        </div>

        {duration === 'repeating' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-neutral-500">number of months</label>
            <input
              type="number" min="1" step="1" placeholder="3"
              value={durationInMonths} onChange={e => setDurationInMonths(e.target.value)}
              className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
            />
          </div>
        )}

        {activeProducts.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-neutral-500">restrict to plans (optional — leave blank for all)</label>
            <div className="max-h-32 overflow-y-auto flex flex-col gap-1 bg-neutral-900 border border-neutral-700 rounded-lg p-2">
              {activeProducts.map(p => (
                <label key={p.id} className="flex items-center gap-2 text-xs text-neutral-300 px-1 py-0.5 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={restrictedIds.includes(p.id)}
                    onChange={() => toggleProduct(p.id)}
                    className="accent-white"
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">expiration date (optional)</label>
          <input
            type="date"
            value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500 [color-scheme:dark]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] text-neutral-500">max redemptions (optional)</label>
          <input
            type="number" min="1" step="1" placeholder="unlimited"
            value={maxRedemptions} onChange={e => setMaxRedemptions(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>

        {err && <p className="text-xs text-rose-400">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 transition-colors">
            cancel
          </button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 transition-colors">
            {saving ? 'saving…' : 'add coupon'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Guest pass "number of passes" inline editor ──────────────────────────────

function PassesEditor({ product, onSave }) {
  const [value,   setValue]   = useState(String(product.passes))
  const [saving,  setSaving]  = useState(false)
  const dirty = Number(value) !== product.passes

  async function save() {
    if (!value || Number(value) < 1) return
    setSaving(true)
    await onSave(product.id, parseInt(value, 10))
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number" min="1" step="1"
        value={value} onChange={e => setValue(e.target.value)}
        className="w-14 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-white text-center focus:outline-none focus:border-neutral-500"
      />
      {dirty && (
        <button
          onClick={save} disabled={saving}
          className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 transition-colors"
        >
          {saving ? '…' : 'save'}
        </button>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { gymSlug } = useParams()

  const [membershipPlans, setMembershipPlans] = useState([])
  const [guestPasses,     setGuestPasses]      = useState([])
  const [loading,         setLoading]          = useState(true)
  const [err,             setErr]              = useState(null)
  const [addPlanOpen,     setAddPlanOpen]      = useState(false)
  const [addPassOpen,     setAddPassOpen]      = useState(false)
  const [editPlan,        setEditPlan]         = useState(null)
  const [editPass,        setEditPass]         = useState(null)
  const [saving,          setSaving]           = useState(false)
  const [togglingId,      setTogglingId]       = useState(null)
  const [deletingId,      setDeletingId]       = useState(null)

  const [coupons,         setCoupons]         = useState([])
  const [couponsLoading,  setCouponsLoading]  = useState(true)
  const [couponsErr,      setCouponsErr]      = useState(null)
  const [addCouponOpen,   setAddCouponOpen]   = useState(false)
  const [couponSaving,    setCouponSaving]    = useState(false)
  const [deactivatingId,  setDeactivatingId]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/stripe/products`, { headers: { Authorization: `Bearer ${token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      setMembershipPlans(json.membershipPlans ?? [])
      setGuestPasses(json.guestPasses ?? [])
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { load() }, [load])

  const loadCoupons = useCallback(async () => {
    setCouponsLoading(true); setCouponsErr(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/stripe/coupons`, { headers: { Authorization: `Bearer ${token()}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      setCoupons(json.coupons ?? [])
    } catch (e) {
      setCouponsErr(e.message)
    } finally {
      setCouponsLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { loadCoupons() }, [loadCoupons])

  async function createCoupon(data) {
    setCouponSaving(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/stripe/coupons`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      await loadCoupons()
      setAddCouponOpen(false)
    } catch (e) {
      alert(e.message)
    } finally {
      setCouponSaving(false)
    }
  }

  async function deactivateCoupon(promotionCodeId) {
    if (!confirm('Deactivate this coupon? It will stop working immediately.')) return
    setDeactivatingId(promotionCodeId)
    try {
      const res = await fetch(`/api/${gymSlug}/stripe/coupons/${promotionCodeId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ active: false }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? res.status)
      setCoupons(prev => prev.map(c => c.id === promotionCodeId ? { ...c, active: false } : c))
    } catch (e) {
      alert(e.message)
    } finally {
      setDeactivatingId(null)
    }
  }

  // Restrictable plans for the coupon form — active membership plans + guest
  // pass types, deduped by product id (a plan can have several price rows,
  // e.g. PT tiers, but a coupon restriction is a per-product setting).
  const activeProducts = (() => {
    const map = new Map()
    for (const p of [...membershipPlans, ...guestPasses]) {
      if (p.active && !map.has(p.id)) map.set(p.id, { id: p.id, name: p.name })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  })()

  async function createProduct(data) {
    setSaving(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/stripe/products`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.status)
      if (data.kind === 'membership') {
        setMembershipPlans(prev => [...prev, json.product].sort((a, b) => a.name.localeCompare(b.name)))
        setAddPlanOpen(false)
      } else {
        setGuestPasses(prev => [...prev, json.product].sort((a, b) => a.name.localeCompare(b.name)))
        setAddPassOpen(false)
      }
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(kind, product, nextActive) {
    // Scoped to this one price — a product can have several prices (e.g.
    // Oasis's "Personal Training" product has 6 tiers), so toggling must
    // never touch the shared product or it'd flip every sibling at once.
    setTogglingId(product.priceId)
    try {
      const res = await fetch(`/api/${gymSlug}/stripe/products/${product.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ priceId: product.priceId, active: nextActive }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? res.status)
      // Disabling keeps the row visible (grayed out, re-enable available) —
      // only a permanent delete removes it from the list.
      const update = list => list.map(p => p.priceId === product.priceId ? { ...p, active: nextActive } : p)
      if (kind === 'membership') setMembershipPlans(update)
      else                       setGuestPasses(update)
    } catch (e) {
      alert(e.message)
    } finally {
      setTogglingId(null)
    }
  }

  async function deletePrice(kind, product) {
    // A product can have multiple active prices (e.g. Triumph's PT tiers) —
    // delete only archives this specific price, leaving sibling prices (and
    // the product's active/inactive state) untouched.
    const label = product.priceLabel ? `${product.name} — ${product.priceLabel}` : product.name
    if (!confirm(`Permanently remove "${label}"? This can't be undone.`)) return
    setDeletingId(product.priceId)
    try {
      const res = await fetch(`/api/${gymSlug}/stripe/products/${product.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ archivePriceId: product.priceId }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? res.status)
      if (kind === 'membership') setMembershipPlans(prev => prev.filter(p => p.priceId !== product.priceId))
      else                       setGuestPasses(prev => prev.filter(p => p.priceId !== product.priceId))
    } catch (e) {
      alert(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  async function savePasses(productId, passes) {
    try {
      const res = await fetch(`/api/${gymSlug}/stripe/products/${productId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ passes }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? res.status)
      setGuestPasses(prev => prev.map(p => p.id === productId ? { ...p, passes } : p))
    } catch (e) {
      alert(e.message)
    }
  }

  async function saveEditedPlan(data) {
    setSaving(true)
    try {
      const body = { name: data.name }
      if (data.priceChanged) {
        body.priceUpdate = {
          oldPriceId: data.oldPriceId,
          amount:     data.amount,
          nickname:   data.priceLabel,
          recurring:  { interval: data.interval, intervalCount: data.intervalCount },
        }
      }
      const res = await fetch(`/api/${gymSlug}/stripe/products/${data.productId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? res.status)
      // A price change replaces the row's priceId — simplest to just refetch.
      await load()
      setEditPlan(null)
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveEditedGuestPass(data) {
    setSaving(true)
    try {
      const body = { name: data.name, passes: data.passes }
      if (data.priceChanged) {
        body.priceUpdate = { oldPriceId: data.oldPriceId, amount: data.amount, nickname: null, recurring: null }
      }
      const res = await fetch(`/api/${gymSlug}/stripe/products/${data.productId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? res.status)
      await load()
      setEditPass(null)
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">products</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 md:min-h-0">
        {err ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-sm text-rose-400">{err}</p>
            <button onClick={load} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
          </div>
        ) : (
          <>
            {/* ── Membership Plans ─────────────────────────────────────────── */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden max-h-[420px] flex flex-col">
              <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
                <p className="text-sm font-semibold text-white">membership plans</p>
                <button
                  onClick={() => setAddPlanOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Plus size={11} />
                  add plan
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <table className="w-full">
                  <tbody>
                    {loading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                          <td className="px-5 py-3"><div className="h-3 w-36 bg-neutral-800 animate-pulse rounded" /></td>
                          <td className="px-5 py-3"><div className="h-3 w-20 bg-neutral-800 animate-pulse rounded" /></td>
                          <td className="px-5 py-3"><div className="h-3 w-16 bg-neutral-800 animate-pulse rounded" /></td>
                        </tr>
                      ))
                    ) : membershipPlans.length === 0 ? (
                      <tr><td colSpan={4} className="px-5 py-12 text-center text-sm text-neutral-600">no membership plans yet — click "add plan" to get started</td></tr>
                    ) : (
                      membershipPlans.map((p, i) => (
                        <tr key={p.priceId} className={`group hover:bg-white/5 transition-colors ${!p.active ? 'opacity-50' : ''} ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                          <td className="px-5 py-3">
                            <span className="text-sm text-white">{displayProductName(gymSlug, p.name)}</span>
                            {p.priceLabel && <span className="block text-[11px] text-neutral-500 mt-0.5">{displayLabel(p.priceLabel)}</span>}
                            {!p.active && <span className="ml-2 text-[10px] text-neutral-500">inactive</span>}
                          </td>
                          <td className="px-5 py-3"><span className="text-xs text-neutral-300 tabular-nums">{fmt(p.amount)}</span></td>
                          <td className="px-5 py-3"><span className="text-xs text-neutral-500">{p.interval ?? '—'}</span></td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-3">
                              <Toggle
                                on={p.active}
                                disabled={togglingId === p.priceId}
                                onClick={() => toggleActive('membership', p, !p.active)}
                              />
                              <button
                                onClick={() => setEditPlan(p)}
                                title="edit"
                                className="p-1.5 rounded-md text-neutral-600 hover:text-white hover:bg-white/10 transition-colors"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => deletePrice('membership', p)}
                                disabled={deletingId === p.priceId}
                                title="delete permanently"
                                className="p-1.5 rounded-md text-neutral-600 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
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
            </div>

            {/* ── Guest Pass Types ──────────────────────────────────────────── */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden max-h-[420px] flex flex-col">
              <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
                <p className="text-sm font-semibold text-white">guest pass types</p>
                <button
                  onClick={() => setAddPassOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Plus size={11} />
                  add guest pass type
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <table className="w-full">
                  <tbody>
                    {loading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                          <td className="px-5 py-3"><div className="h-3 w-36 bg-neutral-800 animate-pulse rounded" /></td>
                          <td className="px-5 py-3"><div className="h-3 w-20 bg-neutral-800 animate-pulse rounded" /></td>
                          <td className="px-5 py-3"><div className="h-3 w-16 bg-neutral-800 animate-pulse rounded" /></td>
                        </tr>
                      ))
                    ) : guestPasses.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-12 text-center text-sm text-neutral-600">no guest pass types yet — click "add guest pass type" to get started</td></tr>
                  ) : (
                    guestPasses.map((p, i) => (
                      <tr key={p.priceId} className={`group hover:bg-white/5 transition-colors ${!p.active ? 'opacity-50' : ''} ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                        <td className="px-5 py-3">
                          <span className="text-sm text-white">{p.name}</span>
                          {p.priceLabel && <span className="block text-[11px] text-neutral-500 mt-0.5">{displayLabel(p.priceLabel)}</span>}
                          {!p.active && <span className="ml-2 text-[10px] text-neutral-500">inactive</span>}
                        </td>
                        <td className="px-5 py-3"><span className="text-xs text-neutral-300 tabular-nums">{fmt(p.amount)}</span></td>
                        <td className="px-5 py-3">
                          <PassesEditor product={p} onSave={savePasses} />
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-3">
                            <Toggle
                              on={p.active}
                              disabled={togglingId === p.priceId}
                              onClick={() => toggleActive('guestPass', p, !p.active)}
                            />
                            <button
                              onClick={() => setEditPass(p)}
                              title="edit"
                              className="p-1.5 rounded-md text-neutral-600 hover:text-white hover:bg-white/10 transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deletePrice('guestPass', p)}
                              disabled={deletingId === p.priceId}
                              title="delete permanently"
                              className="p-1.5 rounded-md text-neutral-600 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
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
            </div>

            {/* ── Coupons ───────────────────────────────────────────────────── */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden max-h-[420px] flex flex-col">
              <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
                <p className="text-sm font-semibold text-white">coupons</p>
                <button
                  onClick={() => setAddCouponOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Plus size={11} />
                  add coupon
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {couponsErr ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-3">
                    <p className="text-xs text-rose-400">{couponsErr}</p>
                    <button onClick={loadCoupons} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
                  </div>
                ) : (
                <table className="w-full">
                  <tbody>
                    {couponsLoading ? (
                      Array.from({ length: 2 }).map((_, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                          <td className="px-5 py-3"><div className="h-3 w-24 bg-neutral-800 animate-pulse rounded" /></td>
                          <td className="px-5 py-3"><div className="h-3 w-16 bg-neutral-800 animate-pulse rounded" /></td>
                          <td className="px-5 py-3"><div className="h-3 w-16 bg-neutral-800 animate-pulse rounded" /></td>
                        </tr>
                      ))
                    ) : coupons.length === 0 ? (
                      <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-neutral-600">no coupons yet — click "add coupon" to get started</td></tr>
                    ) : (
                      coupons.map((c, i) => (
                        <tr key={c.id} className={`hover:bg-white/5 transition-colors ${!c.active ? 'opacity-50' : ''} ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                          <td className="px-5 py-3">
                            <span className="text-sm text-white font-mono">{c.code}</span>
                            {!c.active && <span className="ml-2 text-[10px] text-neutral-500">inactive</span>}
                          </td>
                          <td className="px-5 py-3"><span className="text-xs text-neutral-300">{c.discount}</span></td>
                          <td className="px-5 py-3"><span className="text-xs text-neutral-500">{fmtCouponDuration(c)}</span></td>
                          <td className="px-5 py-3"><span className="text-xs text-neutral-500">{c.restrictedProducts.length > 0 ? c.restrictedProducts.join(', ') : 'all plans'}</span></td>
                          <td className="px-5 py-3"><span className="text-xs text-neutral-500">{fmtCouponDate(c.expiresAt)}</span></td>
                          <td className="px-5 py-3">
                            <span className="text-xs text-neutral-500 tabular-nums">
                              {c.timesRedeemed}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {c.active && (
                              <button
                                onClick={() => deactivateCoupon(c.id)}
                                disabled={deactivatingId === c.id}
                                className="text-xs px-2.5 py-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
                              >
                                {deactivatingId === c.id ? '…' : 'deactivate'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {addPlanOpen && (
        <AddPlanModal onSave={createProduct} onClose={() => setAddPlanOpen(false)} saving={saving} />
      )}
      {addPassOpen && (
        <AddGuestPassModal onSave={createProduct} onClose={() => setAddPassOpen(false)} saving={saving} />
      )}
      {editPlan && (
        <AddPlanModal initial={editPlan} onSave={saveEditedPlan} onClose={() => setEditPlan(null)} saving={saving} />
      )}
      {editPass && (
        <AddGuestPassModal initial={editPass} onSave={saveEditedGuestPass} onClose={() => setEditPass(null)} saving={saving} />
      )}
      {addCouponOpen && (
        <AddCouponModal activeProducts={activeProducts} onSave={createCoupon} onClose={() => setAddCouponOpen(false)} saving={couponSaving} />
      )}
    </div>
  )
}
