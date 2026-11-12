'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ChevronLeft, Snowflake, PlayCircle, XCircle, CreditCard } from 'lucide-react'
import PublicPageHeader from '@/components/PublicPageHeader'
import { Field, INPUT, BUTTON_PRIMARY } from '@/components/PublicPageStyles'
import { overdueMessage } from '@/lib/overdueMessage'

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

// Every member endpoint needs the session cookie from the email code; a 401
// means it's missing or expired (30 min) and the member verifies again
const SESSION_EXPIRED = 'your session expired. verify your email to continue.'
class SessionExpired extends Error {}

async function memberFetch(url, options = {}) {
  const res  = await fetch(url, { credentials: 'same-origin', ...options })
  const json = await res.json().catch(() => ({}))
  if (res.status === 401 && json.error === 'verification_required') throw new SessionExpired(SESSION_EXPIRED)
  return { res, json }
}

function formatCard(card) {
  if (card.label) return card.label   // non-card default (link, bank, …)
  const exp = `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
  return `${card.brand} •••• ${card.last4} · exp ${exp}`
}

const CARD_KEY = 'ik_card_before'   // sessionStorage: card id before leaving for stripe

export default function MembershipManagerPage() {
  const { gymSlug } = useParams()

  const [gymName,     setGymName]     = useState('')
  const [gymLogo,     setGymLogo]     = useState(null)
  const [pageLoading, setPageLoading] = useState(true)

  // step: email | code | options | confirm | success
  const [step,      setStep]      = useState('email')
  const [email,     setEmail]     = useState('')
  const [code,      setCode]      = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [error,     setError]     = useState(null)
  const [notice,    setNotice]    = useState(null)
  const [member,    setMember]    = useState(null)

  // Card on file — "update payment method" opens Stripe's setup page; the
  // webhook saves the card and retries any overdue invoice with it
  const [card,        setCard]        = useState(undefined) // undefined = loading, null = none on file
  const [canUpdate,   setCanUpdate]   = useState(false)
  const [cardError,   setCardError]   = useState(null)
  const [openingCard, setOpeningCard] = useState(false)
  const [cardBanner,  setCardBanner]  = useState(null)      // after returning from stripe

  const [selectedAction,    setSelectedAction]    = useState(null) // freeze | unfreeze | cancel
  const [reason,            setReason]            = useState('')
  const [requestedDate,     setRequestedDate]     = useState('')
  const [understandsNotice, setUnderstandsNotice] = useState(false)
  const [submitting,        setSubmitting]        = useState(false)

  // Overdue balance — "pay now" retries the open invoice; a decline links to
  // Stripe's hosted page for that invoice
  const [payState,         setPayState]         = useState(null) // null | 'paying' | 'paid' | 'nothing' | 'declined'
  const [updatePaymentUrl, setUpdatePaymentUrl] = useState(null)

  useEffect(() => {
    fetch(`/api/${gymSlug}/join`)
      .then(r => r.json())
      .then(({ gym }) => {
        setGymName((gym?.name ?? gymSlug).replace(/-/g, ' '))
        setGymLogo(gym?.logoUrl ?? null)
      })
      .catch(() => {})

    // Back from Stripe (or a reload) inside the 30-minute session → straight to options
    const cardParam = new URLSearchParams(window.location.search).get('card')
    if (cardParam) window.history.replaceState(null, '', window.location.pathname)
    memberFetch(`/api/${gymSlug}/membership-request`)
      .then(({ res, json }) => {
        if (res.ok && json.member) {
          setMember(json.member)
          setStep('options')
          if (cardParam === 'saved') watchCardUpdate()
          if (cardParam === 'canceled') setCardBanner({ tone: 'neutral', text: 'no changes made to your card.' })
        }
      })
      .catch(() => {
        // No session (e.g. a link staff sent) — the card is saved either way
        if (cardParam === 'saved') setNotice('card saved — thank you. verify your email to see your membership.')
      })
      .finally(() => setPageLoading(false))
  }, [gymSlug])

  useEffect(() => {
    if (step === 'options') loadCard()
  }, [step])

  function clearError() { setError(null) }

  function sessionExpired() {
    setMember(null)
    setCode('')
    setStep('email')
    setError(SESSION_EXPIRED)
  }

  async function loadCard() {
    try {
      const { res, json } = await memberFetch(`/api/${gymSlug}/membership-request/payment-method`)
      if (!res.ok) { setCard(null); setCardError(json.error ?? "we couldn't load your card right now."); return null }
      setCard(json.card ?? null)
      setCanUpdate(Boolean(json.canUpdate))
      setCardError(null)
      return json.card ?? null
    } catch (err) {
      if (err instanceof SessionExpired) sessionExpired()
      return null
    }
  }

  async function refreshMember() {
    const { res, json } = await memberFetch(`/api/${gymSlug}/membership-request`)
    if (res.ok && json.member) setMember(json.member)
    return res.ok ? json.member : null
  }

  // The webhook saves the card a moment after Stripe redirects back: poll a
  // few times until the new card shows (and any overdue invoice is retried)
  async function watchCardUpdate() {
    let before = null
    try { before = sessionStorage.getItem(CARD_KEY); sessionStorage.removeItem(CARD_KEY) } catch {}
    setCardBanner({ tone: 'neutral', text: 'card saved — updating your account…' })
    try {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const [fresh, freshMember] = await Promise.all([loadCard(), refreshMember()])
        if (fresh && fresh.id !== before) {
          setCardBanner({
            tone: 'good',
            text: freshMember?.overdue
              ? "card saved. your overdue balance couldn't be charged to it yet — try pay now or contact the gym."
              : 'card saved.',
          })
          return
        }
      }
      setCardBanner({ tone: 'neutral', text: 'card saved. it may take a minute to show here.' })
    } catch (err) {
      if (err instanceof SessionExpired) sessionExpired()
    }
  }

  async function handleUpdateCard() {
    setCardError(null)
    setOpeningCard(true)
    try {
      const { res, json } = await memberFetch(`/api/${gymSlug}/membership-request/payment-method`, { method: 'POST' })
      if (!res.ok || !json.url) throw new Error(json.error ?? "we couldn't open the payment page. please try again.")
      try { sessionStorage.setItem(CARD_KEY, card?.id ?? '') } catch {}
      window.location.href = json.url
    } catch (err) {
      if (err instanceof SessionExpired) return sessionExpired()
      setCardError(err.message)
      setOpeningCard(false)
    }
  }

  async function handleSendCode(e) {
    e?.preventDefault()
    clearError()
    if (!email.trim()) { setError('please enter your email address.'); return }
    setLookingUp(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/membership-request/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'something went wrong — please try again.')
      setNotice(json.message ?? null)
      setCode('')
      setStep('code')
    } catch (err) {
      setError(err.message.toLowerCase())
    } finally {
      setLookingUp(false)
    }
  }

  async function handleConfirmCode(e) {
    e.preventDefault()
    clearError()
    if (!/^\d{6}$/.test(code.trim())) { setError('enter the 6-digit code from the email.'); return }
    setLookingUp(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/membership-request/verify/confirm`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message ?? json.error ?? 'something went wrong — please try again.')
      const { res: lookup, json: found } = await memberFetch(`/api/${gymSlug}/membership-request`)
      if (!lookup.ok) throw new Error(found.error ?? 'something went wrong — please try again.')
      setMember(found.member)
      setNotice(null)
      setStep('options')
    } catch (err) {
      setError(err.message.toLowerCase())
    } finally {
      setLookingUp(false)
    }
  }

  async function handleSignOut() {
    await fetch(`/api/${gymSlug}/membership-request/verify`, { method: 'DELETE' }).catch(() => {})
    setMember(null)
    setCode('')
    setCard(undefined)
    setCardBanner(null)
    setPayState(null)
    setStep('email')
  }

  async function handlePayNow() {
    clearError()
    setPayState('paying')
    try {
      const { res, json } = await memberFetch(`/api/${gymSlug}/membership-request/pay`, { method: 'POST' })
      if (res.ok && (json.paid || json.nothingOwed)) {
        setPayState(json.nothingOwed ? 'nothing' : 'paid')
        // Re-read the membership so freeze / cancel come back once the balance is clear
        const fresh = await memberFetch(`/api/${gymSlug}/membership-request`).then(r => r.json).catch(() => null)
        setMember(prev => ({ ...prev, ...(fresh?.member ?? {}), overdue: fresh?.member?.overdue ?? json.overdue }))
        return
      }
      if (json.updatePaymentUrl) {
        setUpdatePaymentUrl(json.updatePaymentUrl)
        setPayState('declined')
        return
      }
      setPayState(null)
      setError((json.error ?? 'something went wrong — please try again.').toLowerCase())
    } catch (err) {
      setPayState(null)
      if (err instanceof SessionExpired) return sessionExpired()
      setError('something went wrong — please try again.')
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
      const { res, json } = await memberFetch(`/api/${gymSlug}/membership-request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          requestType:   selectedAction,
          reason:        reason.trim() || undefined,
          requestedDate: requestedDate || undefined,
        }),
      })
      if (!res.ok) throw new Error(json.error ?? 'something went wrong — please try again.')
      setStep('success')
    } catch (err) {
      if (err instanceof SessionExpired) return sessionExpired()
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function goBack() {
    clearError()
    if (step === 'code')         { setStep('email'); setNotice(null) }
    else if (step === 'options') { handleSignOut() }
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
            <ChevronLeft size={14} /> {step === 'options' ? 'sign out' : 'back'}
          </button>
        )}

        {/* ── Step: email ──────────────────────────────────────────────── */}
        {step === 'email' && (
          <form
            onSubmit={handleSendCode}
            className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
          >
            <div>
              <h1 className="text-lg font-bold text-white">manage your membership</h1>
              <p className="text-xs text-neutral-500 mt-1">enter your email and we'll send you a code to sign in</p>
            </div>
            {notice && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{notice}</p>
            )}
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
              {lookingUp ? <><Loader2 size={15} className="animate-spin" /> sending code…</> : 'send code →'}
            </button>
          </form>
        )}

        {/* ── Step: code ───────────────────────────────────────────────── */}
        {step === 'code' && (
          <form
            onSubmit={handleConfirmCode}
            className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
          >
            <div>
              <h1 className="text-lg font-bold text-white">check your email</h1>
              <p className="text-xs text-neutral-500 mt-1">{notice ?? 'we sent you a 6-digit code.'} it expires in 10 minutes.</p>
            </div>
            <Field label="code" required>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${INPUT} tracking-[0.4em] font-mono`}
                autoFocus
                required
              />
            </Field>
            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>
            )}
            <button type="submit" disabled={lookingUp} className={BUTTON_PRIMARY}>
              {lookingUp ? <><Loader2 size={15} className="animate-spin" /> checking…</> : 'continue →'}
            </button>
            <button
              type="button"
              onClick={() => handleSendCode()}
              disabled={lookingUp}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-40"
            >
              send a new code
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

            {member.overdue && (
              <div className="bg-[#1c1c1c] border border-amber-500/20 rounded-2xl p-5 flex flex-col gap-3 shadow-2xl">
                <p className="text-sm text-amber-300">{overdueMessage()}</p>
                {payState === 'declined' ? (
                  <>
                    <p className="text-xs text-neutral-400">your card on file was declined.</p>
                    {updatePaymentUrl && (
                      <a href={updatePaymentUrl} target="_blank" rel="noopener noreferrer" className={BUTTON_PRIMARY}>
                        pay this invoice with another card →
                      </a>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={handlePayNow} disabled={payState === 'paying'} className={BUTTON_PRIMARY}>
                    {payState === 'paying' ? <><Loader2 size={15} className="animate-spin" /> paying…</> : 'pay now'}
                  </button>
                )}
                {error && <p className="text-xs text-rose-400">{error}</p>}
              </div>
            )}
            {payState === 'nothing' && !member.overdue && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                nothing owed.
              </p>
            )}
            {payState === 'paid' && !member.overdue && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                payment received — thank you. you can now freeze or cancel your membership.
              </p>
            )}

            {/* ── Payment method ──────────────────────────────────────── */}
            <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-5 flex flex-col gap-3 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <CreditCard size={18} className="text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">payment method</p>
                  <p className="text-xs text-neutral-400 mt-0.5 truncate">
                    {card === undefined ? 'loading…' : card ? formatCard(card) : 'no payment method on file'}
                  </p>
                </div>
              </div>
              {cardBanner && (
                <p className={`text-xs rounded-lg px-3 py-2 border ${cardBanner.tone === 'good' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-neutral-300 bg-white/5 border-white/10'}`}>
                  {cardBanner.text}
                </p>
              )}
              {canUpdate && (
                <button type="button" onClick={handleUpdateCard} disabled={openingCard} className={BUTTON_PRIMARY}>
                  {openingCard ? <><Loader2 size={15} className="animate-spin" /> opening…</> : 'update payment method'}
                </button>
              )}
              {cardError && <p className="text-xs text-rose-400">{cardError}</p>}
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
                  // Freeze / cancel stay disabled until an overdue balance is paid
                  const blocked = member.overdue && (action === 'freeze' || action === 'cancel')
                  return (
                    <button
                      key={action}
                      onClick={() => !blocked && selectAction(action)}
                      disabled={blocked}
                      className="w-full bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-5 flex items-center gap-4 text-left hover:border-neutral-600 transition-colors group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-neutral-800"
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

      <p className="text-center text-[11px] text-neutral-700 mt-6">© 2026 · powered by <a href="https://ironkeyentry.com" target="_blank" rel="noopener noreferrer" className="underline"><strong>ironkey llc</strong></a></p>
    </div>
  )
}
