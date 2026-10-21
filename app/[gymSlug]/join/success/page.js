'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

export default function JoinSuccessPage() {
  const { gymSlug }     = useParams()
  const searchParams    = useSearchParams()
  const sessionId       = searchParams.get('session_id')

  const [gymName,    setGymName]    = useState('')
  const [gymLogo,    setGymLogo]    = useState(null)
  const [sentTo,     setSentTo]     = useState(null)
  const [lockboxCode, setLockboxCode] = useState(null)   // only sent for a verified paid session
  const [accessProvider, setAccessProvider] = useState('SEAM')
  const [loading,    setLoading]    = useState(Boolean(sessionId))

  useEffect(() => {
    fetch(`/api/${gymSlug}/join`)
      .then(r => r.json())
      .then(({ gym }) => {
        setGymName(gym?.name ?? gymSlug)
        setGymLogo(gym?.logoUrl ?? null)
        setAccessProvider(gym?.accessProvider ?? 'SEAM')
      })
      .catch(() => {})
  }, [gymSlug])

  useEffect(() => {
    if (!sessionId) return
    if (accessProvider === 'KISI') {
      // No PIN to poll for — the Kisi grant/invite happens server-side.
      setLoading(false)
      return
    }
    // Poll briefly — the session must be paid and the webhook must have saved
    // (and emailed) the code. The code itself is never returned.
    let attempts = 0
    const maxAttempts = 6
    const interval = 2000

    async function fetchResult() {
      try {
        const res  = await fetch(`/api/${gymSlug}/join/session-result?session_id=${encodeURIComponent(sessionId)}`)
        const json = await res.json()
        if (json.lockboxCode) setLockboxCode(json.lockboxCode)
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
  }, [gymSlug, sessionId, accessProvider])

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-8 flex flex-col items-center text-center gap-5 shadow-2xl">

        {gymLogo && (
          <img src={gymLogo} alt={gymName} className="w-14 h-14 object-contain" />
        )}

        <h1 className="text-xl font-bold text-white">welcome to {gymName || gymSlug}!</h1>

        {/* Shared lockbox code — only present after the session was verified as paid */}
        {!loading && lockboxCode && (
          <div className="w-full bg-neutral-900 rounded-xl p-4 flex items-center justify-between">
            <span className="text-xs text-neutral-400">front lockbox</span>
            <span className="text-lg font-bold text-white font-mono tracking-widest">{lockboxCode}</span>
          </div>
        )}

        {loading ? (
          <div className="w-full bg-neutral-900 rounded-xl p-4 flex items-center justify-center gap-2">
            <Loader2 size={14} className="text-neutral-500 animate-spin" />
            <span className="text-xs text-neutral-500">loading your access code…</span>
          </div>
        ) : accessProvider === 'KISI' ? (
          <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-2">
            <p className="text-xs text-neutral-400 flex items-start gap-2">
              <span className="text-neutral-500 shrink-0">•</span>
              your membership is now active.
            </p>
            <p className="text-xs text-neutral-400 flex items-start gap-2">
              <span className="text-neutral-500 shrink-0">•</span>
              check your email for an invite to the kisi app — download it to unlock the door.
            </p>
          </div>
        ) : sentTo ? (
          <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-3">
            {/* The door code is never shown here — it's emailed to the member's address */}
            <p className="text-sm text-neutral-300">
              your access code was emailed to <span className="text-white font-semibold">{sentTo}</span>.
              check your inbox (and spam).
            </p>
          </div>
        ) : (
          <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-2">
            <p className="text-xs text-neutral-400 flex items-start gap-2">
              <span className="text-neutral-500 shrink-0">•</span>
              your membership is now active.
            </p>
            <p className="text-xs text-neutral-400 flex items-start gap-2">
              <span className="text-neutral-500 shrink-0">•</span>
              a copy of your code and additional information will be sent to your email shortly.
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
