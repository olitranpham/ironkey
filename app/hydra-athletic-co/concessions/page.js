'use client'

import { useState, useEffect } from 'react'
import { Loader2, Minus, Plus, ShoppingBag } from 'lucide-react'

function fmt(n) {
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function SectionDivider({ label }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 border-t border-white/8" />
      <span className="text-[10px] font-semibold tracking-widest text-neutral-600 uppercase">{label}</span>
      <div className="flex-1 border-t border-white/8" />
    </div>
  )
}

export default function ConcessionsPage() {
  const [gymName,    setGymName]    = useState('')
  const [gymLogo,    setGymLogo]    = useState(null)
  const [items,      setItems]      = useState([])
  const [quantities, setQuantities] = useState({})
  const [loading,    setLoading]    = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    fetch('/api/hydra-athletic-co/concessions/items')
      .then(r => r.json())
      .then(({ gym, items = [] }) => {
        setGymName(gym?.name ?? 'hydra athletic co')
        setGymLogo(gym?.logoUrl ?? null)
        setItems(items)
      })
      .catch(() => setError('Could not load the menu.'))
      .finally(() => setLoading(false))
  }, [])

  function setQty(id, qty) {
    setQuantities(q => ({ ...q, [id]: Math.max(0, qty) }))
  }

  const total         = items.reduce((sum, item) => sum + (quantities[item.id] ?? 0) * item.price, 0)
  const selectedCount = Object.values(quantities).reduce((n, q) => n + (q > 0 ? 1 : 0), 0)

  async function handleCheckout() {
    setError(null)
    const selected = items
      .filter(item => (quantities[item.id] ?? 0) > 0)
      .map(item => ({ stripeProductId: item.stripeProductId, quantity: quantities[item.id] }))
    if (!selected.length) return

    setSubmitting(true)
    try {
      const res  = await fetch('/api/hydra-athletic-co/concessions/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items: selected }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      if (!json.url) throw new Error('No checkout URL returned — please try again.')
      window.location.href = json.url
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#292929] flex items-center justify-center">
        <Loader2 size={20} className="text-neutral-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center py-12 px-4">

      {/* Header */}
      <div className="flex flex-col items-center text-center gap-3 mb-8">
        {gymLogo && (
          <img src={gymLogo} alt={gymName} className="w-24 h-24 object-contain" />
        )}
        {!gymLogo && <h1 className="text-xl font-bold text-white">{gymName}</h1>}
      </div>

      <div className="w-full max-w-2xl bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 flex flex-col gap-3 shadow-2xl">

        <SectionDivider label="concessions" />

        {items.length === 0 && (
          <p className="text-sm text-neutral-500 text-center py-6">nothing available right now — check back soon.</p>
        )}

        {items.map(item => {
          const qty        = quantities[item.id] ?? 0
          const outOfStock = item.quantity <= 0
          return (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 bg-[#242424] border border-neutral-700/60 rounded-xl px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{item.name}</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {outOfStock ? 'out of stock' : fmt(item.price)}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setQty(item.id, qty - 1)}
                  disabled={qty <= 0}
                  className="w-8 h-8 rounded-full border border-neutral-600 text-white flex items-center justify-center hover:border-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Minus size={14} />
                </button>
                <span className="w-5 text-center text-sm text-white tabular-nums">{qty}</span>
                <button
                  type="button"
                  onClick={() => setQty(item.id, qty + 1)}
                  disabled={outOfStock || qty >= item.quantity}
                  className="w-8 h-8 rounded-full border border-neutral-600 text-white flex items-center justify-center hover:border-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          )
        })}

        {items.length > 0 && (
          <>
            <div className="flex items-center justify-between border-t border-white/10 pt-4 mt-1">
              <span className="text-sm text-neutral-400">total</span>
              <span className="text-lg font-bold text-white">{fmt(total)}</span>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3.5 py-3">
                <span className="text-rose-400 mt-px shrink-0">⚠</span>
                <p className="text-xs text-rose-400 leading-relaxed">{error}</p>
              </div>
            )}

            <button
              onClick={handleCheckout}
              disabled={submitting || selectedCount === 0}
              className="w-full py-3.5 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
              ) : (
                <><ShoppingBag size={15} /> checkout</>
              )}
            </button>
          </>
        )}

        <p className="text-center text-[11px] text-neutral-700 mt-1">powered by <strong>ironkey</strong> · secured by <strong>Stripe</strong></p>
      </div>
    </div>
  )
}
