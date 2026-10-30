'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

export default function GuestSuccessPage() {
  const { gymSlug }     = useParams()
  const searchParams    = useSearchParams()
  const sessionId       = searchParams.get('session_id')

  const [gymName,    setGymName]    = useState('')
  const [gymLogo,    setGymLogo]    = useState(null)
  const [sentTo,      setSentTo]      = useState(null)
  const [loading,     setLoading]     = useState(Boolean(sessionId))
  const [resendState, setResendState] = useState(null)   // null | 'sending' | 'sent'
  const [resendError, setResendError] = useState(null)

  useEffect(() => {
    fetch(`/api/${gymSlug}/guest`)
      .then(r => r.json())
      .then(({ gym }) => {
        setGymName(gym?.name ?? gymSlug)
        setGymLogo(gym?.logoUrl ?? null)
      })
      .catch(() => {})
  }, [gymSlug])

  useEffect(() => {
    if (!sessionId) return
    // Poll briefly — the session must be paid and the webhook must have saved
    // (and emailed) the code. The code itself is never returned.
    let attempts = 0
    const maxAttempts = 6
    const interval = 2000

    async function fetchResult() {
      try {
        const res  = await fetch(`/api/${gymSlug}/guest/session-result?session_id=${encodeURIComponent(sessionId)}`)
        const json = await res.json()
        if (json.ok) {
          setSentTo(json.sentTo)
          setLoading(false)
          return true
        }
      } catch {}
      return false
    }

    async function poll() {
      const found = await fetchResult()
      if (found) return
      attempts++
      if (attempts < maxAttempts) {
        setTimeout(poll, interval)
      } else {
        setLoading(false) // Give up — show generic message
      }
    }

    poll()
  }, [gymSlug, sessionId])

  async function handleResend() {
    setResendState('sending')
    setResendError(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/guest-passes/checkin/resend`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ session_id: sessionId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'could not resend — please contact admin@ironkeyentry.com')
      setResendState('sent')
    } catch (err) {
      setResendState(null)
      setResendError(err.message)
    }
  }

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-8 flex flex-col items-center text-center gap-5 shadow-2xl">

        {gymLogo ? (
          <img src={gymLogo} alt={gymName} className="w-14 h-14 object-contain" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 size={28} className="text-emerald-400" />
          </div>
        )}

        <h1 className="text-xl font-bold text-white">welcome to {gymName || gymSlug}!</h1>

        {loading ? (
          <div className="w-full bg-neutral-900 rounded-xl p-4 flex items-center justify-center gap-2">
            <Loader2 size={14} className="text-neutral-500 animate-spin" />
            <span className="text-xs text-neutral-500">loading your pass info…</span>
          </div>
        ) : sentTo ? (
          <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-3">
            {/* The door code is never shown here — it's emailed to the address on the profile */}
            <p className="text-sm text-neutral-300">
              your access code was emailed to <span className="text-white font-semibold">{sentTo}</span>.
              check your inbox (and spam).
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending'}
              className="text-xs px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 disabled:opacity-40 transition-colors"
            >
              {resendState === 'sending' ? 'sending…' : 'resend'}
            </button>
            {resendState === 'sent' && (
              <p className="text-xs text-emerald-400">if you have an active code, we've sent it again.</p>
            )}
            {resendError && <p className="text-xs text-red-400">{resendError}</p>}
          </div>
        ) : (
          <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-2">
            <p className="text-xs text-neutral-400 flex items-start gap-2">
              <span className="text-neutral-500 shrink-0">•</span>
              thanks — we're finishing up your pass.
            </p>
            <p className="text-xs text-neutral-400 flex items-start gap-2">
              <span className="text-neutral-500 shrink-0">•</span>
              your access code will be sent to your email shortly.
            </p>
          </div>
        )}

        <p className="text-[11px] text-neutral-600">
          questions? contact admin@ironkeyentry.com
        </p>

      </div>

      <p className="mt-6 text-[11px] text-neutral-700">
        © 2026 · powered by <a href="https://ironkeyentry.com" target="_blank" rel="noopener noreferrer" className="text-neutral-600 font-medium underline">ironkey llc</a>
      </p>
    </div>
  )
}
