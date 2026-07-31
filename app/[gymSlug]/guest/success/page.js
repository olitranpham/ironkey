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
  const [accessCode, setAccessCode] = useState(null)
  const [passesLeft, setPassesLeft] = useState(null)
  const [passType,   setPassType]   = useState(null)
  const [loading,    setLoading]    = useState(Boolean(sessionId))

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
    // Poll briefly to give the webhook time to fire and save the access code
    let attempts = 0
    const maxAttempts = 6
    const interval = 2000

    async function fetchResult() {
      try {
        const res  = await fetch(`/api/${gymSlug}/guest/session-result?session_id=${sessionId}`)
        const json = await res.json()
        if (json.accessCode) {
          setAccessCode(json.accessCode)
          setPassesLeft(json.passesLeft)
          setPassType(json.passType)
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

  const isSingle     = passType === 'SINGLE' || passesLeft === null
  const isReturning  = passesLeft !== null && !isSingle

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
        ) : accessCode ? (
          <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-400">your door code</span>
              <span className="text-lg font-bold text-white font-mono tracking-widest">{accessCode}</span>
            </div>
            {!isSingle && passesLeft !== null && (
              <div className="flex items-center justify-between border-t border-neutral-800 pt-3">
                <span className="text-xs text-neutral-400">passes remaining</span>
                <span className="text-sm font-semibold text-white">{passesLeft}</span>
              </div>
            )}
            <div className="border-t border-neutral-800 pt-3 space-y-2">
              {isReturning ? (
                <p className="text-xs text-neutral-400 flex items-start gap-2">
                  <span className="text-neutral-500 shrink-0">•</span>
                  your door code <span className="font-mono text-white">{accessCode}</span> is already active — you can use it to enter right now. your passes remaining have been updated.
                </p>
              ) : (
                <p className="text-xs text-neutral-400 flex items-start gap-2">
                  <span className="text-neutral-500 shrink-0">•</span>
                  your access code is active and can be used at the entrance.
                </p>
              )}
              <p className="text-xs text-neutral-400 flex items-start gap-2">
                <span className="text-neutral-500 shrink-0">•</span>
                a copy of your code and additional information will be sent to your email shortly.
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-2">
            <p className="text-xs text-neutral-400 flex items-start gap-2">
              <span className="text-neutral-500 shrink-0">•</span>
              your guest pass is now active.
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
        powered by <span className="text-neutral-600 font-medium">ironkey</span>
      </p>
    </div>
  )
}
