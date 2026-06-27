'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import { formatPhone } from '@/lib/phone'

// ── Waiver text ───────────────────────────────────────────────────────────────

const OASIS_WAIVER_SECTIONS = [
  {
    title: 'Membership Agreement',
    body: 'This Membership Agreement is entered into as of the date signed below between the Member ("Member") and Oasis Powerlifting LLC ("Gym"). By signing this, the Member acknowledges and agrees to the following terms regarding membership cancellation and payment policies:',
  },
  {
    title: '1. Payments and Refunds',
    body: '1.1. All membership payments are final and non-refundable. This applies to payments made for the current billing cycle as well as any prior cycles.\n\n1.2. The Member understands and agrees that failure to use the Gym\'s facilities or services does not entitle them to a refund or credit.\n\n1.3. If any payment remains outstanding for more than 30 days, the Member\'s access to the Gym will be AUTOMATICALLY & IMMEDIATELY frozen until all outstanding fees are paid in full.',
  },
  {
    title: '2. Membership Cancellation Requests',
    body: '2.1. Cancellation requests must be submitted online through the Gym\'s official cancellation request form, which can be found on the Gym\'s website or provided upon request.\n\n2.2. To be effective for the upcoming billing cycle, all cancellation requests must be received by the Gym before the next billing cycle begins. Requests received after the billing cycle begins will be processed for the subsequent billing cycle.\n\n2.3. If a membership is canceled, any special pricing or benefits associated with the Member\'s account will be forfeited. Should the Member wish to sign up for a membership again, any applicable new pricing and fees may apply.\n\n2.4. If the Member plans to continue their membership in the near future but requires a temporary pause, the Gym offers membership freeze options. Members are encouraged to inquire about this alternative.',
  },
  {
    title: '3. Membership Termination by Gym',
    body: '3.1. Ownership reserves the right to cancel any Member\'s membership for any reason at any time.\n\n3.2. Memberships may also be terminated if the Member violates the Gym\'s rules or if their behavior does not contribute to the positive, supportive environment the Gym strives to maintain. In such cases, any pre-paid amounts for future billing cycles will be refunded.',
  },
  {
    title: '4. Recurring Billing Terms & Authorization',
    body: '4.1. By becoming a member of Oasis Powerlifting LLC, the Member agrees that all membership fees will be automatically billed on a recurring basis using the payment method provided. The billing cycle and amount will be determined based on the membership plan selected at the time of enrollment.\n\n4.2. Valid Payment Method Requirement: All Members are required to maintain a valid credit card or debit card on file at all times, regardless of the type or duration of membership purchased. The card on file will be used for monthly membership dues, as well as any other fees or charges associated with the Member\'s account (e.g., late fees, additional services, or merchandise purchases, if applicable). It is the Member\'s responsibility to ensure that the payment method on file remains current and valid. Members must promptly notify Oasis Gym of any changes to their payment details, such as a new card number or expiration date. Failure to do so may result in declined payments and additional fees.\n\n4.3. Failed Payments and Late Fees: If a recurring payment is declined or fails for any reason, the Member will be notified and must provide updated payment details within 7 days. If payment is not received within this timeframe, the management reserves the right of a one-time fine of $50.00 for each instance of late payment and risk having their membership temporarily suspended until the balance is paid.\n\n4.4. Agreement to Automated Charges: By signing this agreement, the Member authorizes Oasis Powerlifting LLC to charge the card on file for all recurring dues and fees, as outlined in the membership terms.\n\n4.5. Termination of Membership Due to Non-Payment: Failure to maintain an active, valid payment method or failure to resolve overdue balances within 30 days may result in the termination of the Member\'s contract. Any outstanding balances must be cleared before reactivating a membership or signing a new contract.',
  },
  {
    title: '5. Additional Terms',
    body: '5.1. Bringing a non-member who does not pay for a day pass or sign a waiver is strictly prohibited. Members who violate this policy will be subject to a $100 fine and will assume full liability for the non-member.\n\n5.2. Acknowledgment: By signing below, the Member acknowledges that they have read, understood, and agree to the terms outlined in this contract. The Member further agrees that these terms are binding.',
  },
]

const TRIUMPH_WAIVER_SECTIONS = [
  {
    title: '1. Member Access',
    body: "Access to Triumph Barbell is permitted only when payment for that day (or membership dues) has been made in advance.\n\nDo not open or close external windows unless authorized by staff.\n\nMembers are strictly prohibited from entering any other areas of the building (e.g. freight elevator, other tenants' spaces). Wandering into any spaces beyond Triumph Barbell is not allowed.",
  },
  {
    title: '2. Equipment & Facility Use; Damage Liability',
    body: "Members are responsible for any damage caused to equipment or the premises, except for normal wear and tear.\n\nCosts for repair or replacement due to deliberate or negligent damage will be charged directly to the responsible Member or their guest.\n\nUse of gym equipment and facilities is at the Member's own risk. Triumph Barbell is not liable for accidents, injuries, or damages unless caused by willful misconduct.",
  },
  {
    title: '3. Payment Terms & Entry Fees',
    body: "Any individual entering the facility must have an active membership or purchase a day pass prior to entering.\n\nNo exceptions: failure to pay entry fees before entry may result in fines (see Section 5).",
  },
  {
    title: '4. Facility Restrictions',
    body: "Members must stay within authorized areas. Use of freight elevators or entering other business spaces is strictly forbidden.\n\nViolation may result in suspension or termination of access rights.",
  },
  {
    title: '5. Sneaking In / Unpaid Entry Penalties',
    body: "First time sneaking in without paying: Members must pay a $15 penalty plus the standard day pass fee.\n\nSecond offense: $30 penalty plus the day pass fee.\n\nIf a Member sneaks in or allows someone else to enter without paying (as a member or a guest), a $50 fine is imposed on the Member permitting the unpaid entry.",
  },
  {
    title: '6. Rules & Responsibilities',
    body: "Members must adhere to all safety guidelines and posted rules.\n\nAppropriate attire and conduct are required at all times.\n\nUse of drugs, tobacco, alcohol, or other prohibited substances on the premises is strictly banned.\n\nLost personal items are the Member's responsibility. Triumph Barbell is not liable for any theft or loss.",
  },
  {
    title: '7. Assumption of Risk',
    body: "Members acknowledge the inherent risks associated with strength training, cardio workouts, and all other physical activities that may take place within the facility.\n\nBy signing below, the Member voluntarily assumes full responsibility for all such risks, including but not limited to injury, illness, disability, or death.",
  },
  {
    title: '8. Waiver of Liability',
    body: "To the fullest extent permitted by law, the Member releases and discharges Triumph Barbell, its owners, employees, contractors, and agents from any and all claims or liabilities for injuries, damages, or losses arising out of or related to the Member's use of the facility, including claims arising from the negligence (but not gross negligence or willful misconduct) of Triumph Barbell or its staff.",
  },
  {
    title: '9. Indemnification',
    body: "The Member agrees to indemnify and hold harmless Triumph Barbell, its owners, employees, and agents from any and all claims, demands, or causes of action brought by third parties, including guests, arising from the Member's actions, negligence, or violation of this agreement.",
  },
  {
    title: '10. Medical Acknowledgment & Emergency Authorization',
    body: "The Member affirms that they are in good physical condition and capable of participating in physical activity. The Member agrees to stop exercising if they experience pain, dizziness, or shortness of breath.\n\nIn the event of a medical emergency, the Member authorizes Triumph Barbell staff to seek emergency medical care on their behalf, and agrees to assume responsibility for any associated costs.",
  },
  {
    title: '11. Recording Notice & Media Release',
    body: "Triumph Barbell permits members to record their own training sessions for personal or social media use. By entering the facility, the Member understands and agrees that they may appear in the background of other members' photos or video recordings. Triumph Barbell is not responsible for the content or distribution of footage recorded by members.\n\nThe Member also grants Triumph Barbell the right to use photographs or video recordings taken by staff on-site for promotional or marketing purposes. Members who do not wish to appear in gym-owned content must notify staff in writing.",
  },
  {
    title: '12. Termination & Enforcement',
    body: "Triumph Barbell reserves the right to suspend or terminate membership for rule violations, unpaid fees, or any behavior deemed unsafe or disruptive.\n\nOutstanding charges must be paid in full before access is reinstated.",
  },
  {
    title: '13. Membership Cancellation / Freeze',
    body: "To cancel or freeze a membership, Members must complete and submit the official Membership Manager form, available via email request or Instagram DM.\n\nAll cancellations require a minimum of 30 days' notice prior to the next billing cycle.\n\nAny prepaid fees beyond the final access date may be refunded only as outlined in the plan terms. No exceptions will be made for failure to submit the required form or for insufficient notice.",
  },
  {
    title: '14. Minor Membership & Parental Consent',
    body: "Members under the age of 18 must have a parent or legal guardian co-sign this agreement. The guardian assumes full responsibility for the minor's conduct, safety, and adherence to all facility rules. Triumph Barbell does not provide supervision for minors.",
  },
  {
    title: '15. Governing Law & Dispute Resolution',
    body: "This agreement shall be governed under the laws of the Commonwealth of Massachusetts, where Triumph Barbell is located.\n\nAny disputes arising out of this agreement or use of the facility will first be attempted to be resolved through good-faith negotiation or mediation prior to any legal proceedings.",
  },
  {
    title: '16. Signature & Acknowledgment',
    body: "By signing below, the Member confirms that they have read, understood, and voluntarily agreed to all terms of this agreement, including the waiver of liability and assumption of risk.\n\nBy signing below, the Member acknowledges reading, understanding, and agreeing to abide by these Terms & Conditions.\n\nI understand & agree with the following conditions.",
  },
]

// ── Waiver Modal ──────────────────────────────────────────────────────────────

function WaiverModal({ sections, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 shrink-0">
          <p className="text-sm font-semibold text-white">membership terms & conditions</p>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6 flex-1">
          {sections.map(s => (
            <div key={s.title}>
              <p className="text-xs font-semibold text-white mb-2">{s.title}</p>
              {s.body.split('\n\n').map((para, i) => (
                <p key={i} className="text-xs text-neutral-400 leading-relaxed mb-2">{para}</p>
              ))}
            </div>
          ))}
        </div>
        {/* Footer */}
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

function fmt(n, interval, intervalCount = 1, raw = false) {
  const amt   = Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  // Treat 4-week billing cycles as monthly for display purposes (unless raw=true)
  const isMonthly = !raw && (interval === 'month' || (interval === 'week' && intervalCount === 4))
  const label = isMonthly ? '/month' : intervalCount > 1 ? ` every ${intervalCount} ${interval}s` : `/${interval}`
  return `${amt}${label}`
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

const INPUT = "w-full bg-[#1c1c1c] border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors"
const SELECT = "w-full bg-[#1c1c1c] border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-neutral-500 transition-colors appearance-none"

export default function JoinPage() {
  const { gymSlug } = useParams()

  const [gymName,          setGymName]          = useState('')
  const [membershipPlans,  setMembershipPlans]  = useState([])
  const [addonPlans,       setAddonPlans]       = useState([])
  const [loading,          setLoading]          = useState(true)
  const [submitting,       setSubmitting]       = useState(false)
  const [error,            setError]            = useState(null)
  const [waiverOpen,       setWaiverOpen]       = useState(false)
  const [studentIdFile,    setStudentIdFile]    = useState(null)

  const [form, setForm] = useState({
    firstName:             '',
    lastName:              '',
    email:                 '',
    phone:                 '',
    dob:                   '',
    address1:              '',
    address2:              '',
    city:                  '',
    state:                 '',
    zip:                   '',
    emergencyName:         '',
    emergencyPhone:        '',
    emergencyRelationship: '',
    priceId:               '',
    membershipType:        '',
    addonPriceId:          '',
    waiver:                false,
  })

  const isTriumph  = gymSlug === 'triumph-barbell'
  const isStudent  = form.membershipType.toLowerCase().includes('student')
  useEffect(() => {
    fetch(`/api/${gymSlug}/join`)
      .then(r => r.json())
      .then(({ gym, membershipPlans = [], addonPlans = [] }) => {
        setGymName(gym?.name ?? gymSlug)
        setMembershipPlans(membershipPlans)
        setAddonPlans(addonPlans)
        if (membershipPlans.length) {
          const defaultPlan = membershipPlans.find(p => p.name.toLowerCase().includes('general')) ?? membershipPlans[0]
          setForm(f => ({ ...f, priceId: defaultPlan.priceId, membershipType: defaultPlan.membershipType }))
        }
      })
      .catch(() => setError('Could not load membership options.'))
      .finally(() => setLoading(false))
  }, [gymSlug])

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function selectPlan(priceId) {
    const plan = membershipPlans.find(p => p.priceId === priceId)
    setForm(f => ({ ...f, priceId, membershipType: plan?.membershipType ?? '' }))
    // Clear student ID if switching away from a student plan
    if (!plan?.membershipType?.toLowerCase().includes('student')) setStudentIdFile(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!form.firstName.trim() || !form.lastName.trim()) { setError('First and last name are required.'); return }
    if (!form.email.trim())    { setError('Email is required.'); return }
    if (!form.phone.trim())    { setError('Phone number is required.'); return }
    if (!form.dob)             { setError('Date of birth is required.'); return }
    if (!form.address1.trim()) { setError('Address is required.'); return }
    if (!form.city.trim())     { setError('City is required.'); return }
    if (!form.state.trim())    { setError('State is required.'); return }
    if (!form.zip.trim())      { setError('Zip code is required.'); return }
    if (!form.priceId)         { setError('Please select a membership type.'); return }
    const dobAge = (Date.now() - new Date(form.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (dobAge < 18) { setError('Members under 18 must have a parent or guardian complete this form on their behalf (see Section 14 of the terms).'); return }
    if (!form.emergencyName.trim() || !form.emergencyPhone.trim()) { setError('Emergency contact name and phone are required.'); return }
    if (!form.waiver)          { setError('You must agree to the membership terms.'); return }
    if (isStudent && !studentIdFile) { setError('A student ID photo is required for student memberships.'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/${gymSlug}/join/checkout`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          firstName:             form.firstName.trim(),
          lastName:              form.lastName.trim(),
          email:                 form.email.trim(),
          phone:                 form.phone.trim(),
          dob:                   form.dob,
          address:               [form.address1.trim(), form.address2.trim()].filter(Boolean).join(', '),
          address1:              form.address1.trim(),
          address2:              form.address2.trim(),
          city:                  form.city.trim(),
          state:                 form.state.trim(),
          zip:                   form.zip.trim(),
          emergencyName:         form.emergencyName.trim(),
          emergencyPhone:        form.emergencyPhone.trim(),
          emergencyRelationship: form.emergencyRelationship.trim(),
          priceId:               form.priceId,
          membershipType:        form.membershipType,
          addonPriceId:          form.addonPriceId,
          studentIdUploaded:     isStudent && Boolean(studentIdFile),
        }),
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

      {/* Header */}
      <div className="text-center mb-8">
<h1 className="text-2xl font-bold text-white">{gymName}</h1>
        <p className="text-neutral-500 text-sm mt-1">membership registration</p>
      </div>

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl"
      >

        {/* Name */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="first name" required>
            <input
              type="text"
              placeholder="jane"
              value={form.firstName}
              onChange={e => set('firstName', e.target.value)}
              className={INPUT}
              required
            />
          </Field>
          <Field label="last name" required>
            <input
              type="text"
              placeholder="smith"
              value={form.lastName}
              onChange={e => set('lastName', e.target.value)}
              className={INPUT}
              required
            />
          </Field>
        </div>

        {/* Email */}
        <Field label="email" required>
          <input
            type="email"
            placeholder="jane@example.com"
            value={form.email}
            onChange={e => set('email', e.target.value)}
            className={INPUT}
            required
          />
        </Field>

        {/* Phone */}
        <Field label="phone number" required>
          <input
            type="tel"
            placeholder="(555) 000-0000"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
            onBlur={e => set('phone', formatPhone(e.target.value))}
            className={INPUT}
            required
          />
        </Field>

        {/* Date of birth */}
        <Field label="date of birth" required>
          <input
            type="date"
            value={form.dob}
            onChange={e => set('dob', e.target.value)}
            className={INPUT}
            required
          />
        </Field>

        {/* Address */}
        <Field label="address line 1" required>
          <input
            type="text"
            placeholder="123 main st"
            value={form.address1}
            onChange={e => set('address1', e.target.value)}
            className={INPUT}
            required
          />
        </Field>
        <Field label="address line 2">
          <input
            type="text"
            placeholder="apt, suite, unit (optional)"
            value={form.address2}
            onChange={e => set('address2', e.target.value)}
            className={INPUT}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="city" required>
            <input
              type="text"
              placeholder="boston"
              value={form.city}
              onChange={e => set('city', e.target.value)}
              className={INPUT}
              required
            />
          </Field>
          <Field label="state" required>
            <input
              type="text"
              placeholder="MA"
              value={form.state}
              onChange={e => set('state', e.target.value)}
              className={INPUT}
              required
            />
          </Field>
        </div>
        <Field label="zip code" required>
          <input
            type="text"
            placeholder="02101"
            value={form.zip}
            onChange={e => set('zip', e.target.value)}
            className={INPUT}
            required
          />
        </Field>

        {/* Membership type */}
        <Field label="membership type" required>
          {membershipPlans.length === 0 ? (
            <p className="text-xs text-neutral-600 px-1">No plans available — contact the gym directly.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <select
                  value={form.priceId}
                  onChange={e => selectPlan(e.target.value)}
                  className={SELECT}
                >
                  {(gymSlug === 'oasis-boston'
                    ? (() => {
                        const OASIS_ORDER = [
                          'general membership',
                          'student membership',
                          'flex membership',
                          'semiannual student membership',
                          'semiannual general membership',
                        ]
                        return [...membershipPlans].sort((a, b) => {
                          const ai = OASIS_ORDER.indexOf(a.name.toLowerCase())
                          const bi = OASIS_ORDER.indexOf(b.name.toLowerCase())
                          const ar = ai === -1 ? Infinity : ai
                          const br = bi === -1 ? Infinity : bi
                          return ar - br
                        })
                      })()
                    : gymSlug === 'hydra-athletic-co'
                    ? membershipPlans.filter(p => {
                        const n = p.name.toLowerCase()
                        return n.includes('pre-sale membership') || n.includes('coaching/program')
                      })
                    : membershipPlans
                  ).map(p => {
                    let displayFmt
                    if (gymSlug === 'oasis-boston') {
                      const n = p.name.toLowerCase()
                      if (n.includes('flex')) {
                        displayFmt = fmt(p.amount, p.interval, p.intervalCount)
                      } else if (n.includes('semiannual')) {
                        displayFmt = `${Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} every 6 months`
                      } else {
                        displayFmt = `${Number(p.amount * 2).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} every 4 weeks`
                      }
                    } else {
                      displayFmt = fmt(p.amount, p.interval, p.intervalCount)
                    }
                    return (
                      <option key={p.priceId} value={p.priceId}>
                        {p.name} — {displayFmt}
                      </option>
                    )
                  })}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              {gymSlug === 'oasis-boston' && form.priceId && (() => {
                const selected = membershipPlans.find(p => p.priceId === form.priceId)
                if (!selected) return null
                const n = selected.name.toLowerCase()
                if (n.includes('flex') || n.includes('semiannual')) return null
                const biweekly = Number(selected.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                return (
                  <p className="text-[11px] text-neutral-500 px-0.5">
                    you'll be billed every 2 weeks at {biweekly}.
                  </p>
                )
              })()}
            </div>
          )}
        </Field>

        {/* Student ID upload — triumph-barbell student plans only */}
        {isStudent && (
          <Field label="student ID" required>
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-center gap-2 w-full border border-dashed border-neutral-600 rounded-lg px-3 py-4 cursor-pointer hover:border-neutral-400 transition-colors">
                <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-xs text-neutral-400">
                  {studentIdFile ? studentIdFile.name : 'upload student ID photo'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="sr-only"
                  onChange={e => setStudentIdFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="text-[11px] text-neutral-600">photo or scan of a valid student ID — membership will be verified before activation</p>
            </div>
          </Field>
        )}

        {/* Coaching / Programming Add-on */}
        {addonPlans.length > 0 && (
          <Field label="coaching / programming add-on (optional)">
            <div className="relative">
              <select
                value={form.addonPriceId}
                onChange={e => set('addonPriceId', e.target.value)}
                className={SELECT}
              >
                <option value="">None</option>
                {addonPlans.map(p => (
                  <option key={p.priceId} value={p.priceId}>
                    {p.name} — {fmt(p.amount, p.interval, p.intervalCount)}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </Field>
        )}

        <div className="border-t border-neutral-800 pt-1" />

        {/* Emergency contact */}
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider -mb-2">emergency contact</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="name" required>
            <input
              type="text"
              placeholder="john smith"
              value={form.emergencyName}
              onChange={e => set('emergencyName', e.target.value)}
              className={INPUT}
              required
            />
          </Field>
          <Field label="phone" required>
            <input
              type="tel"
              placeholder="(555) 000-0000"
              value={form.emergencyPhone}
              onChange={e => set('emergencyPhone', e.target.value)}
              onBlur={e => set('emergencyPhone', formatPhone(e.target.value))}
              className={INPUT}
              required
            />
          </Field>
        </div>
        <Field label="relationship">
          <input
            type="text"
            placeholder="spouse, parent, friend…"
            value={form.emergencyRelationship}
            onChange={e => set('emergencyRelationship', e.target.value)}
            className={INPUT}
          />
        </Field>

        <div className="border-t border-neutral-800 pt-1" />

        {/* Waiver */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative mt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={form.waiver}
              onChange={e => set('waiver', e.target.checked)}
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
              membership terms and release of liability
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
          disabled={submitting || membershipPlans.length === 0}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {submitting ? (
            <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
          ) : (
            'continue to payment'
          )}
        </button>

        <p className="text-center text-[11px] text-neutral-600">
          powered by <span className="text-neutral-500 font-medium">ironkey</span> · secured by Stripe
        </p>

      </form>

      {waiverOpen && (
        <WaiverModal
          sections={gymSlug === 'oasis-boston' ? OASIS_WAIVER_SECTIONS : TRIUMPH_WAIVER_SECTIONS}
          onClose={() => setWaiverOpen(false)}
        />
      )}
    </div>
  )
}
