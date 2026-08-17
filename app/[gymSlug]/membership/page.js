'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ChevronLeft, Snowflake, PlayCircle, XCircle } from 'lucide-react'
import PublicPageHeader from '@/components/PublicPageHeader'
import { Field, INPUT, BUTTON_PRIMARY } from '@/components/PublicPageStyles'

const STATUS_LABEL = {
  ACTIVE:   'active',
  FROZEN:   'frozen',
  CANCELED: 'canceled',
  OVERDUE:  'overdue',
}

const REQUEST_COPY = {
  freeze: {
    icon:        Snowflake,
    title:       'freeze membership',
    description: 'temporarily pause your membership',
  },
  unfreeze: {
    icon:        PlayCircle,
    title:       'unfreeze membership',
    description: 'resume your membership',
  },
  cancel: {
    icon:        XCircle,
    title:       'cancel membership',
    description: 'cancel your membership',
  },
}

export default function MembershipManagerPage() {
  const { gymSlug } = useParams()

  const [gymName,     setGymName]     = useState('')
  const [gymLogo,     setGymLogo]     = useState(null)
  const [pageLoading, setPageLoading] = useState(true)

  // step: email | options | confirm | success
  const [step,      setStep]      = useState('email')
  const [email,     setEmail]     = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [error,     setError]     = useState(null)
  const [member,    setMember]    = useState(null)

  const [selectedAction,    setSelectedAction]    = useState(null) // freeze | unfreeze | cancel
  const [reason,            setReason]            = useState('')
  const [requestedDate,     setRequestedDate]     = useState('')
  const [understandsNotice, setUnderstandsNotice] = useState(false)
  const [submitting,        setSubmitting]        = useState(false)

  useEffect(() => {
    fetch(`/api/${gymSlug}/join`)
      .then(r => r.json())
      .then(({ gym }) => {
        setGymName((gym?.name ?? gymSlug).replace(/-/g, ' '))
        setGymLogo(gym?.logoUrl ?? null)
      })
      .catch(() => {})
      .finally(() => setPageLoading(false))
  }, [gymSlug])

  function clearError() { setError(null) }

  async function handleLookup(e) {
    e.preventDefault()
    clearError()
    if (!email.trim()) { setError('please enter your email address.'); return }
    setLookingUp(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/membership-request?email=${encodeURIComponent(email.trim())}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "we couldn't find a membership associated with that email")
      setMember(json.member)
      setStep('options')
    } catch (err) {
      setError(err.message)
    } finally {
      setLookingUp(false)
    }
  }

  function selectAction(action) {
    clearError()
    setSelectedAction(action)
    setReason('')
    setRequestedDate('')
    setUnderstandsNotice(false)
    setStep('confirm')
  }

  async function handleSubmitRequest(e) {
    e.preventDefault()
    clearError()
    if (selectedAction === 'cancel' && !understandsNotice) {
      setError('please confirm you understand the 30-day notice policy.')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/membership-request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:         member.email,
          requestType:   selectedAction,
          reason:        reason.trim() || undefined,
          requestedDate: requestedDate || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'something went wrong — please try again.')
      setStep('success')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function goBack() {
    clearError()
    if (step === 'options')      { setStep('email') }
    else if (step === 'confirm') { setStep('options'); setSelectedAction(null) }
  }

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-[#292929] flex items-center justify-center">
        <Loader2 size={20} className="text-neutral-500 animate-spin" />
      </div>
    )
  }

  const availableActions = member
    ? [
        (member.status === 'ACTIVE' || member.status === 'OVERDUE') ? 'freeze' : null,
        member.status === 'FROZEN' ? 'unfreeze' : null,
        member.status !== 'CANCELED' ? 'cancel' : null,
      ].filter(Boolean)
    : []

  return (
    <div className={`min-h-screen bg-[#292929] flex flex-col items-center px-4 ${step === 'success' ? 'justify-center' : 'py-12'}`}>

      {step !== 'success' && (
        <PublicPageHeader gymLogo={gymLogo} gymName={gymName} />
      )}

      <div className="w-full max-w-md">

        {step !== 'email' && step !== 'success' && (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors mb-4"
          >
            <ChevronLeft size={14} /> back
          </button>
        )}

        {/* ── Step: email ──────────────────────────────────────────────── */}
        {step === 'email' && (
          <form
            onSubmit={handleLookup}
            className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
          >
            <div>
              <h1 className="text-lg font-bold text-white">manage your membership</h1>
              <p className="text-xs text-neutral-500 mt-1">enter your email to get started</p>
            </div>
            <Field label="email" required>
              <input
                type="email"
                placeholder="jane@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={INPUT}
                required
              />
            </Field>
            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={lookingUp}
              className={BUTTON_PRIMARY}
            >
              {lookingUp ? <><Loader2 size={15} className="animate-spin" /> looking up…</> : 'continue →'}
            </button>
          </form>
        )}

        {/* ── Step: options ─────────────────────────────────────────────── */}
        {step === 'options' && member && (
          <div className="flex flex-col gap-4">
            <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 shadow-2xl">
              <p className="text-sm text-neutral-500">welcome back,</p>
              <h2 className="text-lg font-bold text-white">{member.firstName} {member.lastName}</h2>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-neutral-400">{member.membershipType?.toLowerCase()}</span>
                <span className="text-neutral-700">·</span>
                <span className="text-xs text-neutral-400">{STATUS_LABEL[member.status] ?? member.status?.toLowerCase()}</span>
              </div>
            </div>

            {availableActions.length === 0 ? (
              <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 text-center shadow-2xl">
                <p className="text-sm text-neutral-400">your membership is already canceled — there's nothing to manage here.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {availableActions.map(action => {
                  const copy = REQUEST_COPY[action]
                  const Icon = copy.icon
                  return (
                    <button
                      key={action}
                      onClick={() => selectAction(action)}
                      className="w-full bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-5 flex items-center gap-4 text-left hover:border-neutral-600 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:bg-white/15 transition-colors">
                        <Icon size={18} className="text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{copy.title}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{copy.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Step: confirm ────────────────────────────────────────────── */}
        {step === 'confirm' && selectedAction && (
          <form
            onSubmit={handleSubmitRequest}
            className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
          >
            <div>
              <h1 className="text-lg font-bold text-white">{REQUEST_COPY[selectedAction].title}</h1>
              <p className="text-xs text-neutral-500 mt-1">{REQUEST_COPY[selectedAction].description}</p>
            </div>

            {(selectedAction === 'freeze' || selectedAction === 'cancel') && (
              <Field label="reason">
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  placeholder="let us know why…"
                  className={`${INPUT} resize-none`}
                />
              </Field>
            )}

            {selectedAction === 'freeze' && (
              <Field label="desired start date" required>
                <input
                  type="date"
                  value={requestedDate}
                  onChange={e => setRequestedDate(e.target.value)}
                  className={INPUT}
                  required
                />
              </Field>
            )}

            {selectedAction === 'unfreeze' && (
              <Field label="desired resume date" required>
                <input
                  type="date"
                  value={requestedDate}
                  onChange={e => setRequestedDate(e.target.value)}
                  className={INPUT}
                  required
                />
              </Field>
            )}

            {selectedAction === 'cancel' && (
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={understandsNotice}
                    onChange={e => setUnderstandsNotice(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded border transition-colors ${understandsNotice ? 'bg-white border-white' : 'border-neutral-600 bg-transparent group-hover:border-neutral-400'}`}>
                    {understandsNotice && (
                      <svg viewBox="0 0 12 12" fill="none" className="w-4 h-4 -mt-px -ml-px">
                        <path d="M2.5 6l2.5 2.5 4.5-5" stroke="#1c1c1c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-xs text-neutral-400 leading-relaxed">
                  I understand a 30-day notice policy applies and my membership will remain active through that period.
                </span>
              </label>
            )}

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={BUTTON_PRIMARY}
            >
              {submitting ? <><Loader2 size={15} className="animate-spin" /> submitting…</> : 'submit request'}
            </button>
          </form>
        )}

        {/* ── Step: success ─────────────────────────────────────────────── */}
        {step === 'success' && (
          <div className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-8 flex flex-col items-center text-center gap-5 shadow-2xl">
            {gymLogo && (
              <img src={gymLogo} alt={gymName} className="w-14 h-14 object-contain" />
            )}
            <div>
              <h2 className="text-3xl font-bold text-white">request submitted</h2>
              <p className="text-sm text-neutral-400 mt-1">we'll be in touch shortly.</p>
            </div>
          </div>
        )}

      </div>

      <p className="text-center text-[11px] text-neutral-700 mt-6">powered by <strong>ironkey llc</strong></p>
    </div>
  )
}
