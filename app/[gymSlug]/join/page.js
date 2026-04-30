'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, X } from 'lucide-react'

// ── Waiver text ───────────────────────────────────────────────────────────────

const WAIVER_SECTIONS = [
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

function WaiverModal({ onClose }) {
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
          {WAIVER_SECTIONS.map(s => (
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

function fmt(n, interval) {
  const amt = Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  return `${amt}/${interval}`
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

  const [gymName, setGymName]   = useState('')
  const [plans,   setPlans]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error,   setError]     = useState(null)
  const [waiverOpen, setWaiverOpen] = useState(false)

  const [form, setForm] = useState({
    firstName:             '',
    lastName:              '',
    email:                 '',
    phone:                 '',
    dob:                   '',
    address:               '',
    emergencyName:         '',
    emergencyPhone:        '',
    emergencyRelationship: '',
    priceId:               '',
    membershipType:        '',
    waiver:                false,
  })
  const [studentId, setStudentId] = useState(null)

  useEffect(() => {
    fetch(`/api/${gymSlug}/join`)
      .then(r => r.json())
      .then(({ gym, plans }) => {
        setGymName(gym?.name ?? gymSlug)
        setPlans(plans ?? [])
        if (plans?.length) {
          setForm(f => ({ ...f, priceId: plans[0].priceId, membershipType: plans[0].membershipType }))
        }
      })
      .catch(() => setError('Could not load membership options.'))
      .finally(() => setLoading(false))
  }, [gymSlug])

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function selectPlan(priceId) {
    const plan = plans.find(p => p.priceId === priceId)
    setForm(f => ({ ...f, priceId, membershipType: plan?.membershipType ?? 'GENERAL' }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!form.firstName.trim() || !form.lastName.trim()) { setError('First and last name are required.'); return }
    if (!form.email.trim())    { setError('Email is required.'); return }
    if (!form.phone.trim())    { setError('Phone number is required.'); return }
    if (!form.dob)             { setError('Date of birth is required.'); return }
    if (!form.address.trim())  { setError('Address is required.'); return }
    if (!form.priceId)         { setError('Please select a membership type.'); return }
    const dobAge = (Date.now() - new Date(form.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (dobAge < 18) { setError('Members under 18 must have a parent or guardian complete this form on their behalf (see Section 14 of the terms).'); return }
    if (form.membershipType === 'STUDENT' && !studentId) { setError('Please upload your student ID to qualify for the student membership.'); return }
    if (!form.emergencyName.trim() || !form.emergencyPhone.trim()) { setError('Emergency contact name and phone are required.'); return }
    if (!form.waiver)          { setError('You must agree to the membership terms.'); return }

    setSubmitting(true)
    try {
      // If student ID was uploaded, send it as a multipart form so the file goes with the request
      let res
      if (form.membershipType === 'STUDENT' && studentId) {
        const fd = new FormData()
        fd.append('firstName',             form.firstName.trim())
        fd.append('lastName',              form.lastName.trim())
        fd.append('email',                 form.email.trim())
        fd.append('phone',                 form.phone.trim())
        fd.append('dob',                   form.dob)
        fd.append('address',               form.address.trim())
        fd.append('emergencyName',         form.emergencyName.trim())
        fd.append('emergencyPhone',        form.emergencyPhone.trim())
        fd.append('emergencyRelationship', form.emergencyRelationship.trim())
        fd.append('priceId',               form.priceId)
        fd.append('membershipType',        form.membershipType)
        fd.append('studentId',             studentId)
        res = await fetch(`/api/${gymSlug}/join/checkout`, { method: 'POST', body: fd })
      } else {
        res = await fetch(`/api/${gymSlug}/join/checkout`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            firstName:             form.firstName.trim(),
            lastName:              form.lastName.trim(),
            email:                 form.email.trim(),
            phone:                 form.phone.trim(),
            dob:                   form.dob,
            address:               form.address.trim(),
            emergencyName:         form.emergencyName.trim(),
            emergencyPhone:        form.emergencyPhone.trim(),
            emergencyRelationship: form.emergencyRelationship.trim(),
            priceId:               form.priceId,
            membershipType:        form.membershipType,
          }),
        })
      }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
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
        <p className="text-neutral-500 text-sm mt-1">membership signup</p>
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
              placeholder="Jane"
              value={form.firstName}
              onChange={e => set('firstName', e.target.value)}
              className={INPUT}
              required
            />
          </Field>
          <Field label="last name" required>
            <input
              type="text"
              placeholder="Smith"
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
        <Field label="address" required>
          <input
            type="text"
            placeholder="123 Main St, Boston, MA 02101"
            value={form.address}
            onChange={e => set('address', e.target.value)}
            className={INPUT}
            required
          />
        </Field>

        {/* Membership type */}
        <Field label="membership type" required>
          {plans.length === 0 ? (
            <p className="text-xs text-neutral-600 px-1">No plans available — contact the gym directly.</p>
          ) : (
            <div className="relative">
              <select
                value={form.priceId}
                onChange={e => selectPlan(e.target.value)}
                className={SELECT}
              >
                {plans.map(p => (
                  <option key={p.priceId} value={p.priceId}>
                    {p.name} — {fmt(p.amount, p.interval)}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          )}
        </Field>

        {/* Student ID upload — shown only for student plans */}
        {form.membershipType === 'STUDENT' && (
          <Field label="student ID" required>
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-neutral-700 rounded-lg px-4 py-5 cursor-pointer hover:border-neutral-500 transition-colors bg-neutral-900/50">
              <input
                type="file"
                accept="image/*,.pdf"
                className="sr-only"
                onChange={e => setStudentId(e.target.files?.[0] ?? null)}
              />
              {studentId ? (
                <span className="text-xs text-emerald-400 font-medium">{studentId.name}</span>
              ) : (
                <>
                  <span className="text-xs text-neutral-500">click to upload student ID</span>
                  <span className="text-[11px] text-neutral-700">JPG, PNG, or PDF</span>
                </>
              )}
            </label>
            {studentId && (
              <button
                type="button"
                onClick={() => setStudentId(null)}
                className="text-[11px] text-neutral-600 hover:text-rose-400 transition-colors mt-1"
              >
                remove
              </button>
            )}
          </Field>
        )}

        <div className="border-t border-neutral-800 pt-1" />

        {/* Emergency contact */}
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider -mb-2">emergency contact</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="name" required>
            <input
              type="text"
              placeholder="John Smith"
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
              className={INPUT}
              required
            />
          </Field>
        </div>
        <Field label="relationship">
          <input
            type="text"
            placeholder="Spouse, parent, friend…"
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
          disabled={submitting || plans.length === 0}
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

      {waiverOpen && <WaiverModal onClose={() => setWaiverOpen(false)} />}
    </div>
  )
}
