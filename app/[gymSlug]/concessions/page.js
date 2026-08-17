'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Minus, Plus, ShoppingBag } from 'lucide-react'
import PublicPageHeader from '@/components/PublicPageHeader'
import { SectionDivider, BUTTON_PRIMARY } from '@/components/PublicPageStyles'

function fmt(n) {
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// Groups items by their staff-set sectionLabel (e.g. "drinks", "snacks"),
// sorted alphabetically — items with no label fall under "other", always last.
function groupBySection(items) {
  const map = new Map()
  for (const item of items) {
    const section = item.sectionLabel?.trim().toLowerCase() || 'other'
    if (!map.has(section)) map.set(section, [])
    map.get(section).push(item)
  }
  const named = [...map.keys()].filter(k => k !== 'other').sort()
  const order = [...named, ...(map.has('other') ? ['other'] : [])]
  return order.map(section => ({ section, items: map.get(section) }))
}

export default function ConcessionsPage() {
  const { gymSlug } = useParams()

  const [gymName,    setGymName]    = useState('')
  const [gymLogo,    setGymLogo]    = useState(null)
  const [items,      setItems]      = useState([])
  const [quantities, setQuantities] = useState({})
  const [loading,    setLoading]    = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    fetch(`/api/${gymSlug}/concessions/items`)
      .then(r => r.json())
      .then(({ gym, items = [] }) => {
        const name = (gym?.name ?? gymSlug).replace(/-/g, ' ')
        setGymName(name)
        setGymLogo(gym?.logoUrl ?? null)
        setItems(items)
        document.title = `concessions — ${name}`
      })
      .catch(() => setError('Could not load the menu.'))
      .finally(() => setLoading(false))
  }, [gymSlug])

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
      const res  = await fetch(`/api/${gymSlug}/concessions/checkout`, {
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

      <PublicPageHeader gymLogo={gymLogo} gymName={gymName} />

      <div className="w-full max-w-2xl flex flex-col gap-4">

        {items.length === 0 && (
          <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-4 shadow-2xl">
            <p className="text-sm text-neutral-500 text-center py-6">nothing available right now — check back soon.</p>
          </div>
        )}

        <div className="flex flex-col gap-4">
        {groupBySection(items).map(group => (
          <div key={group.section} className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl">
            <SectionDivider label={group.section} />
            {group.items.map(item => {
              const qty         = quantities[item.id] ?? 0
              const unavailable = !item.stripeProductId || item.price == null
              const outOfStock  = !unavailable && item.quantity <= 0
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 border rounded-xl px-4 py-3 transition-opacity ${
                    unavailable
                      ? 'bg-[#242424]/40 border-neutral-800 opacity-50'
                      : 'bg-[#242424] border-neutral-700/60'
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${unavailable ? 'text-neutral-400' : 'text-white'}`}>{item.name}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {unavailable ? 'unavailable' : outOfStock ? 'out of stock' : fmt(item.price)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => setQty(item.id, qty - 1)}
                      disabled={unavailable || qty <= 0}
                      className="w-8 h-8 rounded-full border border-neutral-600 text-white flex items-center justify-center hover:border-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-5 text-center text-sm text-white tabular-nums">{qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(item.id, qty + 1)}
                      disabled={unavailable || outOfStock || qty >= item.quantity}
                      className="w-8 h-8 rounded-full border border-neutral-600 text-white flex items-center justify-center hover:border-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        </div>

        {items.length > 0 && (
          <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl">
            <div className="flex items-center justify-between">
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
              className={BUTTON_PRIMARY}
            >
              {submitting ? (
                <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
              ) : (
                <><ShoppingBag size={15} /> checkout</>
              )}
            </button>
          </div>
        )}

        <p className="text-center text-[11px] text-neutral-700 mt-1">powered by <a href="https://ironkeyentry.com" target="_blank" rel="noopener noreferrer" className="underline"><strong>ironkey llc</strong></a> · © 2026 · secured by <strong>Stripe</strong></p>
      </div>
    </div>
  )
}
