'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, X, ShoppingCart, LogIn, CheckCircle2, ChevronLeft } from 'lucide-react'

// ── Waiver text (Triumph Barbell membership T&C) ──────────────────────────────

const WAIVER_SECTIONS = [
  {
    title: '1. Member Access',
    body: `Access to Triumph Barbell is permitted only when payment for that day (or membership dues) has been made in advance.\n\nDo not open or close external windows unless authorized by staff.\n\nMembers are strictly prohibited from entering any other areas of the building (e.g. freight elevator, other tenants' spaces). Wandering into any spaces beyond Triumph Barbell is not allowed.`,
  },
  {
    title: '2. Equipment & Facility Use; Damage Liability',
    body: `Members are responsible for any damage caused to equipment or the premises, except for normal wear and tear.\n\nCosts for repair or replacement due to deliberate or negligent damage will be charged directly to the responsible Member or their guest.\n\nUse of gym equipment and facilities is at the Member's own risk. Triumph Barbell is not liable for accidents, injuries, or damages unless caused by willful misconduct.`,
  },
  {
    title: '3. Payment Terms & Entry Fees',
    body: `Any individual entering the facility must have an active membership or purchase a day pass prior to entering.\n\nNo exceptions: failure to pay entry fees before entry may result in fines (see Section 5).`,
  },
  {
    title: '4. Facility Restrictions',
    body: `Members must stay within authorized areas. Use of freight elevators or entering other business spaces is strictly forbidden.\n\nViolation may result in suspension or termination of access rights.`,
  },
  {
    title: '5. Sneaking In / Unpaid Entry Penalties',
    body: `First time sneaking in without paying: Members must pay a $15 penalty plus the standard day pass fee.\n\nSecond offense: $30 penalty plus the day pass fee.\n\nIf a Member sneaks in or allows someone else to enter without paying (as a member or a guest), a $50 fine is imposed on the Member permitting the unpaid entry.`,
  },
  {
    title: '6. Rules & Responsibilities',
    body: `Members must adhere to all safety guidelines and posted rules.\n\nAppropriate attire and conduct are required at all times.\n\nUse of drugs, tobacco, alcohol, or other prohibited substances on the premises is strictly banned.\n\nLost personal items are the Member's responsibility. Triumph Barbell is not liable for any theft or loss.`,
  },
  {
    title: '7. Assumption of Risk',
    body: `Members acknowledge the inherent risks associated with strength training, cardio workouts, and all other physical activities that may take place within the facility.\n\nBy signing below, the Member voluntarily assumes full responsibility for all such risks, including but not limited to injury, illness, disability, or death.`,
  },
  {
    title: '8. Waiver of Liability',
    body: `To the fullest extent permitted by law, the Member releases and discharges Triumph Barbell, its owners, employees, contractors, and agents from any and all claims or liabilities for injuries, damages, or losses arising out of or related to the Member's use of the facility, including claims arising from the negligence (but not gross negligence or willful misconduct) of Triumph Barbell or its staff.`,
  },
  {
    title: '9. Indemnification',
    body: `The Member agrees to indemnify and hold harmless Triumph Barbell, its owners, employees, and agents from any and all claims, demands, or causes of action brought by third parties, including guests, arising from the Member's actions, negligence, or violation of this agreement.`,
  },
  {
    title: '10. Medical Acknowledgment & Emergency Authorization',
    body: `The Member affirms that they are in good physical condition and capable of participating in physical activity. The Member agrees to stop exercising if they experience pain, dizziness, or shortness of breath.\n\nIn the event of a medical emergency, the Member authorizes Triumph Barbell staff to seek emergency medical care on their behalf, and agrees to assume responsibility for any associated costs.`,
  },
  {
    title: '11. Recording Notice & Media Release',
    body: `Triumph Barbell permits members to record their own training sessions for personal or social media use. By entering the facility, the Member understands and agrees that they may appear in the background of other members' photos or video recordings. Triumph Barbell is not responsible for the content or distribution of footage recorded by members.\n\nThe Member also grants Triumph Barbell the right to use photographs or video recordings taken by staff on-site for promotional or marketing purposes. Members who do not wish to appear in gym-owned content must notify staff in writing.`,
  },
  {
    title: '12. Termination & Enforcement',
    body: `Triumph Barbell reserves the right to suspend or terminate membership for rule violations, unpaid fees, or any behavior deemed unsafe or disruptive.\n\nOutstanding charges must be paid in full before access is reinstated.`,
  },
  {
    title: '13. Membership Cancellation / Freeze',
    body: `To cancel or freeze a membership, Members must complete and submit the official Membership Manager form, available via email request or Instagram DM.\n\nAll cancellations require a minimum of 30 days' notice prior to the next billing cycle.\n\nAny prepaid fees beyond the final access date may be refunded only as outlined in the plan terms. No exceptions will be made for failure to submit the required form or for insufficient notice.`,
  },
  {
    title: '14. Minor Membership & Parental Consent',
    body: `Members under the age of 18 must have a parent or legal guardian co-sign this agreement. The guardian assumes full responsibility for the minor's conduct, safety, and adherence to all facility rules. Triumph Barbell does not provide supervision for minors.`,
  },
  {
    title: '15. Governing Law & Dispute Resolution',
    body: `This agreement shall be governed under the laws of the Commonwealth of Massachusetts, where Triumph Barbell is located.\n\nAny disputes arising out of this agreement or use of the facility will first be attempted to be resolved through good-faith negotiation or mediation prior to any legal proceedings.`,
  },
  {
    title: '16. Signature & Acknowledgment',
    body: `By signing below, the Member confirms that they have read, understood, and voluntarily agreed to all terms of this agreement, including the waiver of liability and assumption of risk.\n\nBy signing below, the Member acknowledges reading, understanding, and agreeing to abide by these Terms & Conditions.\n\nI understand & agree with the following conditions.`,
  },
]

// ── Waiver Modal ───────────────────────────────────────────────────────────────

function WaiverModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 shrink-0">
          <p className="text-sm font-semibold text-white">liability waiver &amp; terms</p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-6 flex-1">
          {WAIVER_SECTIONS.map(s => (
            <div key={s.title}>
              <p className="text-xs font-semibold text-white mb-2">{s.title}</p>
              {s.body.split('\n\n').map((para, i) => (
                <p key={i} className="text-xs text-neutral-400 leading-relaxed mb-2">{para}</p>
              ))}
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-neutral-800 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-xs font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 transition-colors"
          >
            close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function fmt(amount) {
  return Number(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function Field({ label, required, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-neutral-400">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT  = "w-full bg-[#1c1c1c] border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
const SELECT = "w-full bg-[#1c1c1c] border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-neutral-500 transition-colors appearance-none"

// ── Plan selector ──────────────────────────────────────────────────────────────

function PlanSelector({ plans, value, onChange }) {
  if (!plans.length) {
    return <p className="text-xs text-neutral-600 px-1">No plans available — contact the gym directly.</p>
  }
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className={SELECT}>
        {plans.map(p => (
          <option key={p.priceId} value={p.priceId}>
            {p.name} — {fmt(p.amount)}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
        <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function GuestPage() {
  const { gymSlug } = useParams()

  const [gymName,    setGymName]    = useState('')
  const [plans,      setPlans]      = useState([])
  const [pageLoading, setPageLoading] = useState(true)

  // step: intent | new-or-returning | new-form | email-input | returning-confirm | checkin-confirm | checkin-done
  const [step,       setStep]       = useState('intent')
  const [mode,       setMode]       = useState(null)   // 'purchase-new' | 'purchase-returning' | 'checkin'
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)
  const [waiverOpen, setWaiverOpen] = useState(false)

  // New guest form fields
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', dob: '', address: '',
    emergencyName: '', emergencyPhone: '', emergencyRelationship: '',
    waiver: false,
  })

  // Shared
  const [selectedPriceId, setSelectedPriceId] = useState('')
  const [lookupEmail,     setLookupEmail]      = useState('')
  const [lookupResult,    setLookupResult]     = useState(null)   // { profile, passesLeft }
  const [checkinResult,   setCheckinResult]    = useState(null)

  useEffect(() => {
    fetch(`/api/${gymSlug}/guest`)
      .then(r => r.json())
      .then(({ gym, plans }) => {
        setGymName(gym?.name ?? gymSlug)
        const p = plans ?? []
        setPlans(p)
        if (p.length) setSelectedPriceId(p[0].priceId)
      })
      .catch(() => {})
      .finally(() => setPageLoading(false))
  }, [gymSlug])

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function clearError()   { setError(null) }

  function goBack() {
    clearError()
    if (step === 'new-or-returning')   { setStep('intent'); setMode(null) }
    else if (step === 'new-form')      { setStep('new-or-returning') }
    else if (step === 'email-input')   { setStep(mode === 'checkin' ? 'intent' : 'new-or-returning') }
    else if (step === 'returning-confirm') { setStep('email-input') }
    else if (step === 'checkin-confirm')   { setStep('email-input') }
    else { setStep('intent'); setMode(null) }
  }

  // ── Lookup handler (returning purchase + checkin) ──────────────────────────
  async function handleLookup(e) {
    e.preventDefault()
    clearError()
    if (!lookupEmail.trim()) { setError('please enter your email address.'); return }
    setSubmitting(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/guest/lookup`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: lookupEmail.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Lookup failed')

      if (mode === 'checkin') {
        if (!json.profile) {
          setError('no guest profile found for that email. if this is your first visit, purchase a pass first.')
          setSubmitting(false)
          return
        }
        setLookupResult(json)
        setStep('checkin-confirm')
      } else {
        // purchase-returning
        setLookupResult(json)
        setStep('returning-confirm')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Submit new guest checkout ──────────────────────────────────────────────
  async function handleNewGuestSubmit(e) {
    e.preventDefault()
    clearError()

    if (!form.firstName.trim() || !form.lastName.trim()) { setError('first and last name are required.'); return }
    if (!form.email.trim())    { setError('email is required.'); return }
    if (!form.phone.trim())    { setError('phone number is required.'); return }
    if (!form.dob)             { setError('date of birth is required.'); return }
    const dobAge = (Date.now() - new Date(form.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (dobAge < 18) { setError('guests under 18 must have a parent or guardian complete this form on their behalf (see section 14 of the terms).'); return }
    if (!form.address.trim())  { setError('address is required.'); return }
    if (!form.emergencyName.trim() || !form.emergencyPhone.trim()) { setError('emergency contact name and phone are required.'); return }
    if (!form.waiver)          { setError('you must agree to the liability waiver.'); return }
    if (!selectedPriceId)      { setError('please select a pass type.'); return }

    const plan = plans.find(p => p.priceId === selectedPriceId)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/${gymSlug}/guest/checkout`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          priceId:               selectedPriceId,
          passType:              plan?.passType   ?? 'SINGLE',
          passesLeft:            plan?.passesLeft ?? 1,
          firstName:             form.firstName.trim(),
          lastName:              form.lastName.trim(),
          email:                 form.email.trim(),
          phone:                 form.phone.trim(),
          dob:                   form.dob,
          address:               form.address.trim(),
          emergencyName:         form.emergencyName.trim(),
          emergencyPhone:        form.emergencyPhone.trim(),
          emergencyRelationship: form.emergencyRelationship.trim(),
          isNewGuest:            true,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'something went wrong')
      window.location.href = json.url
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  // ── Submit returning guest checkout ───────────────────────────────────────
  async function handleReturningCheckout() {
    clearError()
    if (!selectedPriceId) { setError('please select a pass type.'); return }
    const plan = plans.find(p => p.priceId === selectedPriceId)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/${gymSlug}/guest/checkout`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          priceId:    selectedPriceId,
          passType:   plan?.passType   ?? 'SINGLE',
          passesLeft: plan?.passesLeft ?? 1,
          email:      lookupEmail.trim(),
          isNewGuest: false,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'something went wrong')
      window.location.href = json.url
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  // ── Check in ──────────────────────────────────────────────────────────────
  async function handleCheckin() {
    clearError()
    setSubmitting(true)
    try {
      const res = await fetch(`/api/${gymSlug}/guest-passes/checkin`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email: lookupEmail.trim(),
          name:  lookupResult?.profile?.name ?? '',
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'check-in failed')
      setCheckinResult(json)
      setStep('checkin-done')
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-[#292929] flex items-center justify-center">
        <Loader2 size={20} className="text-neutral-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center py-12 px-4">

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white">{gymName}</h1>
        <p className="text-neutral-500 text-sm mt-1">guest pass</p>
      </div>

      <div className="w-full max-w-md">

        {/* ── Back button ─────────────────────────────────────────────────── */}
        {step !== 'intent' && step !== 'checkin-done' && (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors mb-4"
          >
            <ChevronLeft size={14} /> back
          </button>
        )}

        {/* ── Step: intent ───────────────────────────────────────────────── */}
        {step === 'intent' && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => { clearError(); setStep('new-or-returning'); setMode('purchase') }}
              className="w-full bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex items-center gap-4 text-left hover:border-neutral-600 transition-colors group"
            >
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:bg-white/15 transition-colors">
                <ShoppingCart size={18} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">purchase a guest pass</p>
                <p className="text-xs text-neutral-500 mt-0.5">day pass, 3-pack, 5-pack, and more</p>
              </div>
            </button>

            <button
              onClick={() => { clearError(); setMode('checkin'); setStep('email-input') }}
              className="w-full bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex items-center gap-4 text-left hover:border-neutral-600 transition-colors group"
            >
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:bg-white/15 transition-colors">
                <LogIn size={18} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">check in with existing pass</p>
                <p className="text-xs text-neutral-500 mt-0.5">use a pass you've already purchased</p>
              </div>
            </button>
          </div>
        )}

        {/* ── Step: new-or-returning (purchase path) ─────────────────────── */}
        {step === 'new-or-returning' && (
          <div className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex flex-col gap-4 shadow-2xl">
            <p className="text-sm font-semibold text-white">is this your first visit?</p>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => { clearError(); setStep('new-form'); setMode('purchase-new') }}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 transition-colors"
              >
                yes, first visit
              </button>
              <button
                onClick={() => { clearError(); setStep('email-input'); setMode('purchase-returning') }}
                className="w-full py-3 rounded-xl text-sm font-medium bg-neutral-800 text-neutral-200 hover:bg-neutral-700 transition-colors border border-neutral-700"
              >
                no, i've been before
              </button>
            </div>
          </div>
        )}

        {/* ── Step: new-form ─────────────────────────────────────────────── */}
        {step === 'new-form' && (
          <form
            onSubmit={handleNewGuestSubmit}
            className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl"
          >
            {/* Name */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="first name" required>
                <input
                  type="text" placeholder="Jane"
                  value={form.firstName} onChange={e => setField('firstName', e.target.value)}
                  className={INPUT} required
                />
              </Field>
              <Field label="last name" required>
                <input
                  type="text" placeholder="Smith"
                  value={form.lastName} onChange={e => setField('lastName', e.target.value)}
                  className={INPUT} required
                />
              </Field>
            </div>

            {/* Email */}
            <Field label="email" required>
              <input
                type="email" placeholder="jane@example.com"
                value={form.email} onChange={e => setField('email', e.target.value)}
                className={INPUT} required
              />
            </Field>

            {/* Phone */}
            <Field label="phone number" required>
              <input
                type="tel" placeholder="(555) 000-0000"
                value={form.phone} onChange={e => setField('phone', e.target.value)}
                className={INPUT} required
              />
            </Field>

            {/* DOB */}
            <Field label="date of birth" required>
              <input
                type="date"
                value={form.dob} onChange={e => setField('dob', e.target.value)}
                className={INPUT} required
              />
            </Field>

            {/* Address */}
            <Field label="address" required>
              <input
                type="text" placeholder="123 Main St, Boston, MA 02101"
                value={form.address} onChange={e => setField('address', e.target.value)}
                className={INPUT} required
              />
            </Field>

            <div className="border-t border-neutral-800 pt-1" />

            {/* Emergency contact */}
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider -mb-2">emergency contact</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="name" required>
                <input
                  type="text" placeholder="John Smith"
                  value={form.emergencyName} onChange={e => setField('emergencyName', e.target.value)}
                  className={INPUT} required
                />
              </Field>
              <Field label="phone" required>
                <input
                  type="tel" placeholder="(555) 000-0000"
                  value={form.emergencyPhone} onChange={e => setField('emergencyPhone', e.target.value)}
                  className={INPUT} required
                />
              </Field>
            </div>
            <Field label="relationship">
              <input
                type="text" placeholder="Spouse, parent, friend…"
                value={form.emergencyRelationship} onChange={e => setField('emergencyRelationship', e.target.value)}
                className={INPUT}
              />
            </Field>

            <div className="border-t border-neutral-800 pt-1" />

            {/* Pass type */}
            <Field label="pass type" required>
              <PlanSelector
                plans={plans}
                value={selectedPriceId}
                onChange={setSelectedPriceId}
              />
            </Field>

            <div className="border-t border-neutral-800 pt-1" />

            {/* Waiver */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={form.waiver}
                  onChange={e => setField('waiver', e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded border transition-colors ${form.waiver ? 'bg-white border-white' : 'border-neutral-600 bg-transparent group-hover:border-neutral-400'}`}>
                  {form.waiver && (
                    <svg viewBox="0 0 12 12" fill="none" className="w-4 h-4 -mt-px -ml-px">
                      <path d="M2.5 6l2.5 2.5 4.5-5" stroke="#1c1c1c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-xs text-neutral-400 leading-relaxed">
                I agree to the{' '}
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); setWaiverOpen(true) }}
                  className="text-white underline underline-offset-2 hover:text-neutral-200 transition-colors"
                >
                  liability waiver & terms
                </button>
              </span>
            </label>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || plans.length === 0}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
                : 'continue to payment'
              }
            </button>

            <p className="text-center text-[11px] text-neutral-600">
              powered by <span className="text-neutral-500 font-medium">ironkey</span> · secured by Stripe
            </p>
          </form>
        )}

        {/* ── Step: email-input (returning purchase or check-in) ─────────── */}
        {step === 'email-input' && (
          <form
            onSubmit={handleLookup}
            className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl"
          >
            <div>
              <p className="text-sm font-semibold text-white">
                {mode === 'checkin' ? 'check in' : 'welcome back'}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                {mode === 'checkin'
                  ? 'enter the email you used when you purchased your pass.'
                  : "enter your email and we'll look up your profile."}
              </p>
            </div>

            <Field label="email" required>
              <input
                type="email"
                placeholder="jane@example.com"
                value={lookupEmail}
                onChange={e => setLookupEmail(e.target.value)}
                className={INPUT}
                required
              />
            </Field>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> looking up…</>
                : 'continue'
              }
            </button>
          </form>
        )}

        {/* ── Step: returning-confirm ─────────────────────────────────────── */}
        {step === 'returning-confirm' && lookupResult && (
          <div className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
            {/* Profile card */}
            <div className="bg-neutral-900 rounded-xl p-4 flex flex-col gap-1">
              <p className="text-sm font-semibold text-white">
                {lookupResult.profile ? lookupResult.profile.name : lookupEmail}
              </p>
              <p className="text-xs text-neutral-500">{lookupEmail}</p>
              {lookupResult.passesLeft > 0 && (
                <p className="text-xs text-emerald-400 mt-1">{lookupResult.passesLeft} pass{lookupResult.passesLeft !== 1 ? 'es' : ''} remaining</p>
              )}
            </div>

            {/* Plan selector */}
            <Field label="add a pass" required>
              <PlanSelector
                plans={plans}
                value={selectedPriceId}
                onChange={setSelectedPriceId}
              />
            </Field>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleReturningCheckout}
              disabled={submitting || plans.length === 0}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
                : 'continue to payment'
              }
            </button>

            <p className="text-center text-[11px] text-neutral-600">
              powered by <span className="text-neutral-500 font-medium">ironkey</span> · secured by Stripe
            </p>
          </div>
        )}

        {/* ── Step: checkin-confirm ───────────────────────────────────────── */}
        {step === 'checkin-confirm' && lookupResult && (
          <div className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
            {/* Profile card */}
            <div className="bg-neutral-900 rounded-xl p-4 flex flex-col gap-1">
              <p className="text-sm font-semibold text-white">
                {lookupResult.profile?.name ?? lookupEmail}
              </p>
              <p className="text-xs text-neutral-500">{lookupEmail}</p>
            </div>

            {lookupResult.passesLeft > 0 ? (
              <>
                <div className="flex flex-col gap-2">
                  {(lookupResult.packs ?? []).map((pack, i) => {
                    const LABEL = { SINGLE: 'day pass', THREE_PACK: '3-pack', FIVE_PACK: '5-pack', TEN_PACK: '10-pack' }
                    const label = LABEL[pack.passType] ?? pack.passType.toLowerCase()
                    const isSingle = pack.passType === 'SINGLE'
                    return (
                      <div key={i} className="flex items-center justify-between bg-neutral-900 rounded-xl px-4 py-3">
                        <span className="text-xs text-neutral-400">{label}</span>
                        <span className="text-xs font-semibold text-white">
                          {isSingle
                            ? '1 remaining'
                            : `${pack.passesLeft} of ${pack.total} remaining`}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {error && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  onClick={handleCheckin}
                  disabled={submitting}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {submitting
                    ? <><Loader2 size={15} className="animate-spin" /> checking in…</>
                    : 'check in'
                  }
                </button>
              </>
            ) : (
              <>
                <div className="text-center py-2">
                  <p className="text-sm text-neutral-400">no passes remaining.</p>
                  <p className="text-xs text-neutral-600 mt-1">purchase a new pass to continue.</p>
                </div>
                <button
                  onClick={() => { setStep('returning-confirm'); setMode('purchase-returning') }}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 transition-colors"
                >
                  purchase a pass
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Step: checkin-done ──────────────────────────────────────────── */}
        {step === 'checkin-done' && (
          <div className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-8 flex flex-col items-center text-center gap-5 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">checked in!</h2>
              <p className="text-sm text-neutral-400 mt-1">
                welcome{lookupResult?.profile?.name ? `, ${lookupResult.profile.name.split(' ')[0].toLowerCase()}` : ''}.
              </p>
            </div>
            {checkinResult?.passesLeft != null && (
              <div className="w-full bg-neutral-900 rounded-xl p-4">
                <p className="text-xs text-neutral-400">
                  <span className="text-white font-semibold">{checkinResult.passesLeft}</span>{' '}
                  pass{checkinResult.passesLeft !== 1 ? 'es' : ''} remaining after this visit
                </p>
              </div>
            )}
            <button
              onClick={() => { setStep('intent'); setMode(null); setLookupEmail(''); setLookupResult(null); clearError() }}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              done
            </button>
          </div>
        )}

      </div>

      <p className="mt-8 text-[11px] text-neutral-700">
        powered by <span className="text-neutral-600 font-medium">ironkey</span>
      </p>

      {waiverOpen && <WaiverModal onClose={() => setWaiverOpen(false)} />}
    </div>
  )
}
