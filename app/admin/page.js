'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Plus, ExternalLink, Settings, CheckCircle2, Circle, X, Eye, EyeOff } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function gymInitials(name) {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
}

function StatusBadge({ on, onLabel = 'connected', offLabel = 'not connected' }) {
  return on ? (
    <span className="flex items-center gap-1 text-[11px] text-emerald-400">
      <CheckCircle2 size={11} /> {onLabel}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[11px] text-neutral-600">
      <Circle size={11} /> {offLabel}
    </span>
  )
}

function MaskedInput({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      {label && <label className="block text-xs text-neutral-500 mb-1.5">{label}</label>}
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? '••••••••'}
          className="w-full bg-[#292929] border border-neutral-700 rounded-lg px-3 pr-9 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors font-mono"
        />
        <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400 transition-colors">
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, mono }) {
  return (
    <div>
      <label className="block text-xs text-neutral-500 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-[#292929] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}

// ── Gym card ──────────────────────────────────────────────────────────────────

function GymCard({ gym, onEdit, onOpenPortal }) {
  const total = gym.active + gym.frozen + gym.canceled + gym.overdue
  return (
    <div className="bg-[#1c1c1c] border border-neutral-800 rounded-xl p-5 flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0">
          <span className="text-[#1c1c1c] font-black text-[11px] tracking-tighter select-none">
            {gymInitials(gym.name)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{gym.name.toLowerCase()}</p>
          <p className="text-[11px] text-neutral-600 font-mono">{gym.slug}</p>
        </div>
      </div>

      {/* Member counts */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'active',   value: gym.active,   cls: 'text-emerald-400' },
          { label: 'frozen',   value: gym.frozen,   cls: 'text-blue-400' },
          { label: 'canceled', value: gym.canceled, cls: 'text-neutral-400' },
          { label: 'overdue',  value: gym.overdue,  cls: 'text-red-400' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="bg-[#252525] rounded-lg px-2 py-2 text-center">
            <p className={`text-base font-semibold tabular-nums ${cls}`}>{value}</p>
            <p className="text-[10px] text-neutral-600 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Integrations */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-neutral-600">stripe</span>
          <StatusBadge on={gym.hasStripe} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-neutral-600">seam</span>
          <StatusBadge on={gym.hasSeam} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onOpenPortal(gym)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/15 transition-colors"
        >
          <ExternalLink size={12} /> open portal
        </button>
        <button
          onClick={() => onEdit(gym)}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors"
        >
          <Settings size={12} /> edit
        </button>
      </div>
    </div>
  )
}

// ── Add gym modal ─────────────────────────────────────────────────────────────

function AddGymModal({ onClose, onCreated, adminToken }) {
  const [gymName,  setGymName]  = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/admin/gyms', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body:    JSON.stringify({ gymName, email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      onCreated(data.gym)
      onClose()
    } catch {
      setError('something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={!loading ? onClose : undefined} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm font-semibold text-white">add new gym</p>
          <button onClick={onClose} disabled={loading} className="p-1.5 rounded-lg text-neutral-600 hover:text-white hover:bg-white/5 transition-colors"><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="gym name"      value={gymName}  onChange={setGymName}  placeholder="gym name" />
          <Field label="owner email"   value={email}    onChange={setEmail}    placeholder="owner@gym.com" />
          <MaskedInput label="owner password" value={password} onChange={setPassword} placeholder="min 8 characters" />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 py-2 rounded-lg text-xs font-medium border border-neutral-700 text-neutral-400 hover:text-white disabled:opacity-40 transition-colors">
              cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg text-xs font-medium bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 transition-colors">
              {loading ? 'creating…' : 'create gym'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Edit gym modal ────────────────────────────────────────────────────────────

function EditGymModal({ gym, onClose, onUpdated, onDeleted, adminToken }) {
  const [name,            setName]            = useState(gym.name)
  const [slug,            setSlug]            = useState(gym.slug)
  const [seamApiKey,      setSeamApiKey]      = useState('')
  const [seamDeviceId,    setSeamDeviceId]    = useState(gym.seamDeviceId ?? '')
  const [stripeAccountId, setStripeAccountId] = useState('')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [confirmDelete,   setConfirmDelete]   = useState(false)
  const [deleting,        setDeleting]        = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/admin/gyms/${gym.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body:    JSON.stringify({ name, slug, seamApiKey, seamDeviceId, stripeAccountId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      onUpdated({ ...gym, ...data.gym })
      onClose()
    } catch {
      setError('something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    setDeleting(true); setError(null)
    try {
      const res = await fetch(`/api/admin/gyms/${gym.id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      if (!res.ok) { const d = await res.json(); setError(d.error); setDeleting(false); return }
      onDeleted(gym.id)
      onClose()
    } catch {
      setError('delete failed')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={!loading ? onClose : undefined} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm font-semibold text-white">edit — {gym.name.toLowerCase()}</p>
          <button onClick={onClose} disabled={loading} className="p-1.5 rounded-lg text-neutral-600 hover:text-white hover:bg-white/5 transition-colors"><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="gym name" value={name} onChange={setName} />
          <Field label="slug"     value={slug} onChange={setSlug} mono />
          <MaskedInput label={`seam api key${gym.hasSeam ? ' (set — blank to keep)' : ''}`}      value={seamApiKey}      onChange={setSeamApiKey}      />
          <Field       label="seam device id"                                                  value={seamDeviceId}    onChange={setSeamDeviceId}    mono />
          <MaskedInput label={`stripe account id${gym.hasStripe ? ' (set — blank to keep)' : ''}`} value={stripeAccountId} onChange={setStripeAccountId} />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 py-2 rounded-lg text-xs font-medium border border-neutral-700 text-neutral-400 hover:text-white disabled:opacity-40 transition-colors">
              cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg text-xs font-medium bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 transition-colors">
              {loading ? 'saving…' : 'save'}
            </button>
          </div>

          {/* Delete */}
          <div className="border-t border-neutral-800 pt-4 mt-2">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full py-2 rounded-lg text-xs font-medium text-red-500/70 hover:text-red-400 hover:bg-red-500/5 border border-transparent hover:border-red-900 transition-colors"
              >
                delete gym
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-red-400 text-center">this will permanently delete <span className="font-semibold">{gym.name.toLowerCase()}</span> and all its data</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="flex-1 py-2 rounded-lg text-xs font-medium border border-neutral-700 text-neutral-400 hover:text-white disabled:opacity-40 transition-colors">
                    cancel
                  </button>
                  <button type="button" onClick={handleDelete} disabled={deleting} className="flex-1 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-900 disabled:opacity-40 transition-colors">
                    {deleting ? 'deleting…' : 'yes, delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter()

  const [gyms,       setGyms]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [addModal,   setAddModal]   = useState(false)
  const [editGym,    setEditGym]    = useState(null)
  const [adminToken, setAdminToken] = useState('')

  useEffect(() => {
    document.title = 'ironkey admin portal'
    const t = localStorage.getItem('ik_admin_token')
    if (!t) { router.replace('/admin/login'); return }
    setAdminToken(t)
  }, [router])

  const fetchGyms = useCallback(async () => {
    const t = localStorage.getItem('ik_admin_token')
    if (!t) return
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/admin/gyms', { headers: { Authorization: `Bearer ${t}` } })
      if (res.status === 401 || res.status === 403) { router.replace('/admin/login'); return }
      if (!res.ok) throw new Error()
      const { gyms } = await res.json()
      setGyms(gyms)
    } catch {
      setError('could not load gyms')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { if (adminToken) fetchGyms() }, [adminToken, fetchGyms])

  function logout() {
    localStorage.removeItem('ik_admin_token')
    router.replace('/admin/login')
  }

  async function openPortal(gym) {
    try {
      const res  = await fetch(`/api/admin/gyms/${gym.id}/impersonate`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'impersonate failed'); return }

      // Open in new tab via /auth/complete bridge
      const params = new URLSearchParams({
        ik_token: data.token,
        ik_gym:   JSON.stringify(data.gym),
        ik_role:  data.role,
      })
      window.open(`/auth/complete?${params}`, '_blank')
    } catch {
      alert('could not open portal')
    }
  }

  const totalActive = gyms.reduce((s, g) => s + g.active, 0)
  const totalGyms   = gyms.length

  return (
    <div className="min-h-screen bg-[#292929]">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-[#1c1c1c] border-b border-neutral-800 h-14 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">ironkey admin portal</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-600 hidden sm:block">
            {totalGyms} gym{totalGyms !== 1 ? 's' : ''} · {totalActive} active members
          </span>
          <button
            onClick={fetchGyms}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> refresh
          </button>
          <button
            onClick={logout}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors"
          >
            log out
          </button>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-6 py-8">

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xs font-semibold text-neutral-500 tracking-wider">gyms</h2>
          <button
            onClick={() => setAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-white text-[#1c1c1c] px-3 py-1.5 text-xs font-semibold hover:bg-neutral-200 transition-colors"
          >
            <Plus size={13} /> add gym
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64 gap-2">
            <RefreshCw size={16} className="text-neutral-600 animate-spin" />
            <span className="text-sm text-neutral-600">loading…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={fetchGyms} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">retry</button>
          </div>
        ) : gyms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2">
            <p className="text-sm text-neutral-500">no gyms yet</p>
            <button onClick={() => setAddModal(true)} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">add the first gym</button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {gyms.map(gym => (
              <GymCard
                key={gym.id}
                gym={gym}
                onEdit={setEditGym}
                onOpenPortal={openPortal}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {addModal && (
        <AddGymModal
          adminToken={adminToken}
          onClose={() => setAddModal(false)}
          onCreated={newGym => setGyms(prev => [...prev, newGym])}
        />
      )}

      {editGym && (
        <EditGymModal
          gym={editGym}
          adminToken={adminToken}
          onClose={() => setEditGym(null)}
          onUpdated={updated => setGyms(prev => prev.map(g => g.id === updated.id ? updated : g))}
          onDeleted={id => { setGyms(prev => prev.filter(g => g.id !== id)); setEditGym(null) }}
        />
      )}
    </div>
  )
}
