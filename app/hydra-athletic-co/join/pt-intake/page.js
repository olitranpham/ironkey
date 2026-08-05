'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const QUESTIONS = [
  { key: 'goals',              label: 'what are your primary fitness goals?' },
  { key: 'experience',         label: 'do you have any training experience?' },
  { key: 'injuriesConditions', label: 'do you have any pain, injuries, or medical conditions we should be aware of?' },
  { key: 'additionalInfo',     label: 'is there any additional information you feel is important to mention?' },
  { key: 'consultationTime',   label: 'what day/time works best for a consultation call?' },
]

export default function HydraPTIntakePage() {
  const router = useRouter()

  const [payload,    setPayload]    = useState(null)
  const [answers,    setAnswers]    = useState({ goals: '', experience: '', injuriesConditions: '', additionalInfo: '', consultationTime: '' })
  const [touched,    setTouched]    = useState({})
  const [submitted,  setSubmitted]  = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('hydra_join_payload')
      if (!raw) { router.replace('/hydra-athletic-co/join'); return }
      setPayload(JSON.parse(raw))
    } catch {
      router.replace('/hydra-athletic-co/join')
    }
  }, [router])

  function set(key, value) {
    setAnswers(prev => ({ ...prev, [key]: value }))
    setTouched(prev => ({ ...prev, [key]: true }))
  }

  const emptyKeys = QUESTIONS.map(q => q.key).filter(k => !answers[k].trim())
  const isFieldError = key => (touched[key] || submitted) && !answers[key].trim()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!payload) return
    setSubmitted(true)
    if (emptyKeys.length > 0) return
    setError(null)
    setSubmitting(true)
    try {
      // 1. Save intake responses to DB
      const intakeRes = await fetch('/api/hydra-athletic-co/join/pt-intake', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:  `${payload.firstName ?? ''} ${payload.lastName ?? ''}`.trim(),
          email: payload.email,
          phone: payload.phone ?? '',
          ...answers,
        }),
      })
      const intakeJson = await intakeRes.json()
      if (!intakeRes.ok) throw new Error(intakeJson.error ?? 'Failed to save intake form')

      // 2. Create Stripe checkout session
      const checkoutRes = await fetch('/api/hydra-athletic-co/join/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const checkoutJson = await checkoutRes.json()
      if (!checkoutRes.ok) throw new Error(checkoutJson.error ?? 'Failed to create checkout session')
      if (!checkoutJson.url) throw new Error('No checkout URL returned — please try again.')

      // 3. Clear sessionStorage and redirect to Stripe
      sessionStorage.removeItem('hydra_join_payload')
      window.location.href = checkoutJson.url
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  if (!payload) {
    return (
      <div className="min-h-screen bg-[#292929] flex items-center justify-center">
        <Loader2 size={20} className="text-neutral-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center py-12 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2 pb-1">
          <h1 className="text-xl font-bold text-white">one more step</h1>
          <p className="text-sm text-neutral-500">
            help your trainer get to know you before your first session.
          </p>
        </div>

        {QUESTIONS.map(({ key, label }) => {
          const hasError = isFieldError(key)
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-neutral-300 tracking-wide">
                {label}<span className="text-rose-400 ml-0.5">*</span>
              </label>
              <textarea
                rows={3}
                value={answers[key]}
                onChange={e => set(key, e.target.value)}
                onBlur={() => setTouched(prev => ({ ...prev, [key]: true }))}
                placeholder="type your answer here…"
                className={`w-full bg-[#242424] rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 transition-all duration-150 resize-none border ${
                  hasError
                    ? 'border-rose-500/60 focus:ring-rose-500/20'
                    : 'border-neutral-700/60 focus:ring-white/10 focus:border-neutral-500'
                }`}
              />
              {hasError && (
                <p className="text-[11px] text-rose-400">this field is required</p>
              )}
            </div>
          )
        })}

        {error && (
          <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3.5 py-3">
            <span className="text-rose-400 mt-px shrink-0">⚠</span>
            <p className="text-xs text-rose-400 leading-relaxed">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2 mt-1"
        >
          {submitting ? (
            <><Loader2 size={15} className="animate-spin" /> redirecting to payment…</>
          ) : (
            'continue to payment →'
          )}
        </button>

        <p className="text-center text-[11px] text-neutral-700">powered by <strong>ironkey</strong> · secured by <strong>Stripe</strong></p>
      </form>
    </div>
  )
}
