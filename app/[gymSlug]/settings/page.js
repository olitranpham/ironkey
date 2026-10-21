'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, CheckCircle2, Circle } from 'lucide-react'

function MaskedInput({ label, value, onChange }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="block text-xs text-neutral-500 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="••••••••"
          className="w-full bg-[#292929] border border-neutral-700 rounded-lg px-3 pr-9 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400 transition-colors"
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-[#1c1c1c] rounded-xl border border-neutral-800 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-neutral-800">
        <h2 className="text-xs font-semibold text-neutral-400 tracking-wider">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function SettingsPage() {
  const { gymSlug }   = useParams()
  const searchParams  = useSearchParams()

  const [connected,      setConnected]      = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [lockbox,        setLockbox]        = useState(null)   // null = not an owner (section hidden)
  const [lockboxSaving,  setLockboxSaving]  = useState(false)
  const [lockboxMsg,     setLockboxMsg]     = useState(null)   // { type: 'ok'|'err', text }
  const [disconnecting,  setDisconnecting]  = useState(false)
  const [connecting,     setConnecting]     = useState(false)
  const [stripeMsg,      setStripeMsg]      = useState(null) // { type: 'ok'|'err', text }

const [curPw,     setCurPw]     = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving,  setPwSaving]  = useState(false)
  const [pwSaved,   setPwSaved]   = useState(false)
  const [pwError,   setPwError]   = useState(null)


  const token = () => localStorage.getItem('ik_token')

  // ── Load settings ──────────────────────────────────────────────────────────
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/${gymSlug}/settings`, {
        headers: { Authorization: `Bearer ${token()}` },
      })
      if (!res.ok) return
      const { settings } = await res.json()
      setConnected(Boolean(settings.hasStripeConnect))
      // Only returned to users with settings.manage
      if ('lockboxCode' in settings) setLockbox(settings.lockboxCode ?? '')
    } finally {
      setSettingsLoaded(true)
    }
  }, [gymSlug])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  // ── Handle OAuth callback query params ────────────────────────────────────
  useEffect(() => {
    if (searchParams.get('stripe_connected')) {
      setStripeMsg({ type: 'ok', text: 'Stripe account connected successfully.' })
      setConnected(true)
    } else if (searchParams.get('stripe_error')) {
      setStripeMsg({ type: 'err', text: `Stripe connection failed: ${searchParams.get('stripe_error')}` })
    }
  }, [searchParams])

  // ── Connect Stripe ─────────────────────────────────────────────────────────
  async function connectStripe() {
    setConnecting(true)
    setStripeMsg(null)
    try {
      const res = await fetch(`/api/${gymSlug}/stripe/connect`, {
        headers: { Authorization: `Bearer ${token()}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error)
      window.location.href = data.url
    } catch (err) {
      setStripeMsg({ type: 'err', text: err.message || 'Failed to start Stripe connection — please try again.' })
      setConnecting(false)
    }
  }

  // ── Disconnect Stripe ──────────────────────────────────────────────────────
  async function disconnect() {
    if (!confirm('Disconnect Stripe? Overdue charge retries will stop working.')) return
    setDisconnecting(true)
    setStripeMsg(null)
    try {
      const res = await fetch(`/api/${gymSlug}/stripe/connect`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      })
      if (!res.ok) throw new Error()
      setConnected(false)
      setStripeMsg({ type: 'ok', text: 'Stripe account disconnected.' })
    } catch {
      setStripeMsg({ type: 'err', text: 'Failed to disconnect — please try again.' })
    } finally {
      setDisconnecting(false)
    }
  }

  // ── Front-door lockbox code ────────────────────────────────────────────────
  async function saveLockbox(e) {
    e.preventDefault()
    setLockboxSaving(true)
    setLockboxMsg(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/settings`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ type: 'lockbox', lockboxCode: lockbox }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'could not save')
      setLockbox(data.settings?.lockboxCode ?? '')
      setLockboxMsg({ type: 'ok', text: data.settings?.lockboxCode ? 'lockbox code saved.' : 'lockbox code cleared.' })
    } catch (err) {
      setLockboxMsg({ type: 'err', text: err.message })
    } finally {
      setLockboxSaving(false)
    }
  }

  // ── Change password ────────────────────────────────────────────────────────
  async function savePassword(e) {
    e.preventDefault()
    if (newPw !== confirmPw) { setPwError('passwords do not match'); return }
    if (newPw.length < 8)   { setPwError('new password must be at least 8 characters'); return }
    setPwSaving(true); setPwError(null); setPwSaved(false)
    try {
      const res = await fetch(`/api/${gymSlug}/settings/password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPwSaved(true)
      setCurPw(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => setPwSaved(false), 2500)
    } catch (err) {
      setPwError(err.message ?? 'save failed')
    } finally {
      setPwSaving(false)
    }
  }


  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">settings</h1>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5">

          {/* ── Stripe Connect ─────────────────────────────────────────────── */}
          <Section title="stripe">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-500">payment processing</p>
                {settingsLoaded && (
                  connected ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <CheckCircle2 size={12} /> connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-neutral-600">
                      <Circle size={12} /> not connected
                    </span>
                  )
                )}
              </div>

              {stripeMsg && (
                <p className={`text-xs ${stripeMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stripeMsg.text}
                </p>
              )}

              {settingsLoaded && (
                connected ? (
                  <button
                    onClick={disconnect}
                    disabled={disconnecting}
                    className="w-full py-2 rounded-lg text-xs font-medium border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-900 disabled:opacity-40 transition-colors"
                  >
                    {disconnecting ? 'disconnecting…' : 'disconnect'}
                  </button>
                ) : (
                  <button
                    onClick={connectStripe}
                    disabled={connecting}
                    className="flex items-center justify-center w-full py-2 rounded-lg text-xs font-medium bg-[#635BFF] text-white hover:bg-[#4F46E5] disabled:opacity-40 transition-colors"
                  >
                    {connecting ? 'connecting…' : 'connect stripe'}
                  </button>
                )
              )}
            </div>
          </Section>

{/* ── Lockbox code (owners only) ─────────────────────────────────── */}
          {lockbox !== null && (
            <Section title="front lockbox">
              <form onSubmit={saveLockbox} className="space-y-3">
                <p className="text-xs text-neutral-500">
                  shown to guests and members only after a paid checkout. leave empty to hide it.
                </p>
                <input
                  value={lockbox}
                  onChange={e => setLockbox(e.target.value)}
                  placeholder="lockbox code"
                  maxLength={16}
                  className="w-full bg-[#292929] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 font-mono"
                />
                {lockboxMsg && (
                  <p className={`text-xs ${lockboxMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{lockboxMsg.text}</p>
                )}
                <button
                  type="submit"
                  disabled={lockboxSaving}
                  className="w-full py-2 rounded-lg text-xs font-medium bg-white text-black hover:bg-neutral-200 disabled:opacity-40 transition-colors"
                >
                  {lockboxSaving ? 'saving…' : 'save lockbox code'}
                </button>
              </form>
            </Section>
          )}

{/* ── Change password ────────────────────────────────────────────── */}
          <Section title="change password">
            <form onSubmit={savePassword} className="space-y-4">
              <MaskedInput label="current password" value={curPw}     onChange={setCurPw} />
              <MaskedInput label="new password"     value={newPw}     onChange={setNewPw} />
              <MaskedInput label="confirm password" value={confirmPw} onChange={setConfirmPw} />
              {pwError && <p className="text-xs text-red-400">{pwError}</p>}
              {pwSaved && <p className="text-xs text-emerald-400">password updated</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 transition-colors"
                >
                  {pwSaving ? 'saving…' : 'save'}
                </button>
              </div>
            </form>
          </Section>

        </div>
      </div>

    </div>
  )
}

export default function SettingsPageWrapper() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  )
}
