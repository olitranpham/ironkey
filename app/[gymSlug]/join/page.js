'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import PublicPageHeader from '@/components/PublicPageHeader'
import { Field, SectionDivider, INPUT, SELECT, BUTTON_PRIMARY } from '@/components/PublicPageStyles'
import { SignatureField } from '@/components/SignatureField'
import { signatureError } from '@/lib/signature'
import { agreementSections, agreementVersion } from '@/lib/agreements'
function maskPhone(value) {
  const d = value.replace(/\D/g, '').slice(0, 10)
  if (d.length < 4) return d.length ? `(${d}` : ''
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

// 50 states + DC + US territories, 2-letter USPS abbreviations used as both
// value and display.
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'GU', 'VI', 'AS', 'MP',
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

// Members under 18 can't legally sign the liability waiver or authorize
// payment themselves — this determines whether the join flow branches into
// the guardian-completes-everything path.
function calculateAge(dobStr) {
  const dob = new Date(dobStr)
  if (isNaN(dob.getTime())) return null
  return (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
}

function fmt(n, interval, intervalCount = 1, raw = false) {
  const amt   = Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  // Treat 4-week billing cycles as monthly for display purposes (unless raw=true)
  const isMonthly = !raw && (interval === 'month' || (interval === 'week' && intervalCount === 4))
  const label = isMonthly ? ' / month' : intervalCount > 1 ? ` every ${intervalCount} ${interval}s` : ` / ${interval}`
  return `${amt}${label}`
}


// Hidden-link-gated plan — only requested from the API (and auto-selected
// here) when the join page is loaded with ?plan=rutgers-powerlifting.
const HYDRA_RUTGERS_POWERLIFTING_PRICE_ID = 'price_1U84lzAHpnGUkbkC2kNFvTwD'

export default function JoinPage() {
  const { gymSlug } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const planParam = searchParams.get('plan')
  const inviteToken = searchParams.get('invite')   // lead invite link from the staff portal

  const [gymName,          setGymName]          = useState('')
  const [gymLogo,          setGymLogo]          = useState(null)
  const [membershipPlans,   setMembershipPlans]   = useState([])
  const [addonPlans,        setAddonPlans]        = useState([])
  const [ptPlans,           setPtPlans]           = useState([])
  const [programmingPlans,  setProgrammingPlans]  = useState([])
  const [groupTrainingPlans, setGroupTrainingPlans] = useState([])
  const [loading,          setLoading]          = useState(true)
  const [submitting,       setSubmitting]       = useState(false)
  const [promotionCode,    setPromotionCode]    = useState('')
  const [error,            setError]            = useState(null)
  const [waiverOpen,          setWaiverOpen]          = useState(false)
  const [studentIdFile,       setStudentIdFile]       = useState(null)
  const [gradSemester,        setGradSemester]        = useState('')
  const [gradYear,            setGradYear]            = useState('')
  const [hearAboutUs,         setHearAboutUs]         = useState('')

  const currentYear    = new Date().getFullYear()
  const gradYearOptions = Array.from({ length: 6 }, (_, i) => String(currentYear + i))

  const [form, setForm] = useState({
    firstName:             '',
    lastName:              '',
    email:                 '',
    confirmEmail:          '',
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
    guardianFirstName:     '',
    guardianLastName:      '',
    guardianEmail:         '',
    guardianConfirmEmail:  '',
    guardianPhone:         '',
    guardianRelationship:  '',
    priceId:               '',
    membershipType:        '',
    requiresStudentId:     false,
    addonPriceId:          '',
    groupTrainingPriceId:  '',
    signatureName:         '',
  })

  const isTriumph  = gymSlug === 'triumph-barbell'
  const isHydra    = gymSlug === 'hydra-athletic-co'
  const isStudent  = form.requiresStudentId
  const age        = form.dob ? calculateAge(form.dob) : null
  const isMinor    = age !== null && age < 18
  // Typed signature: the guardian signs for a minor
  const signerName = isMinor
    ? `${form.guardianFirstName.trim()} ${form.guardianLastName.trim()}`.trim()
    : `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
  const signatureMismatch = signatureError(form.signatureName, { isMinor, guardianName: signerName, name: signerName }) !== null
  // Lead invite: exchange the signed token for prefill fields (name, email,
  // phone). They still choose a plan and complete the whole form, agreement
  // and waiver. An invalid/expired token just leaves the form blank.
  useEffect(() => {
    if (!inviteToken) return
    fetch(`/api/${gymSlug}/join/invite?token=${encodeURIComponent(inviteToken)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(p => {
        if (!p) return
        setForm(f => ({
          ...f,
          firstName:    f.firstName    || p.firstName || '',
          lastName:     f.lastName     || p.lastName  || '',
          email:        f.email        || p.email     || '',
          confirmEmail: f.confirmEmail || p.email     || '',
          phone:        f.phone        || (p.phone ? maskPhone(p.phone) : ''),
        }))
      })
      .catch(() => {})
  }, [gymSlug, inviteToken])

  useEffect(() => {
    const query = planParam ? `?plan=${encodeURIComponent(planParam)}` : ''
    fetch(`/api/${gymSlug}/join${query}`)
      .then(r => r.json())
      .then(({ gym, membershipPlans = [], addonPlans = [], ptPlans = [], programmingPlans = [], groupTrainingPlans = [] }) => {
        setGymName((gym?.name ?? gymSlug).replace(/-/g, ' '))
        setGymLogo(gym?.logoUrl ?? null)
        setMembershipPlans(membershipPlans)
        setAddonPlans(addonPlans)
        setPtPlans(ptPlans)
        setProgrammingPlans(programmingPlans)
        setGroupTrainingPlans(groupTrainingPlans)
        if (membershipPlans.length) {
          // Following the hidden Rutgers Powerlifting link auto-selects that
          // plan so it doesn't have to be hunted for in the dropdown — the
          // rest of the list is untouched either way.
          const linkedPlan = planParam === 'rutgers-powerlifting'
            ? membershipPlans.find(p => p.priceId === HYDRA_RUTGERS_POWERLIFTING_PRICE_ID)
            : null

          let defaultPlan
          if (linkedPlan) {
            defaultPlan = linkedPlan
          } else if (gymSlug === 'hydra-athletic-co') {
            defaultPlan = membershipPlans.find(p => p.name.toLowerCase().includes('standard membership')) ?? membershipPlans[0]
          } else if (gymSlug === 'triumph-barbell') {
            defaultPlan = membershipPlans.find(p => p.name.toLowerCase().includes('general')) ?? membershipPlans[0]
          } else {
            defaultPlan = membershipPlans.find(p => p.name.toLowerCase().includes('general')) ?? membershipPlans[0]
          }
          setForm(f => ({ ...f, priceId: defaultPlan.priceId, membershipType: defaultPlan.membershipType, requiresStudentId: defaultPlan.requiresStudentId ?? false }))
        }
      })
      .catch(() => setError('Could not load membership options.'))
      .finally(() => setLoading(false))
  }, [gymSlug, planParam])

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function selectPlan(priceId) {
    const plan = [...membershipPlans, ...ptPlans, ...programmingPlans].find(p => p.priceId === priceId)
    setForm(f => ({ ...f, priceId, membershipType: plan?.membershipType ?? '', requiresStudentId: plan?.requiresStudentId ?? false }))
    // Clear student fields if switching away from a student plan
    if (!plan?.requiresStudentId) {
      setStudentIdFile(null)
      setGradSemester('')
      setGradYear('')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!form.firstName.trim() || !form.lastName.trim() || form.firstName.trim().length < 2 || form.lastName.trim().length < 2) {
      setError(isMinor ? "The member's first and last name must be at least 2 characters." : 'First and last name must be at least 2 characters.')
      return
    }
    if (!form.email.trim())    { setError('Email is required.'); return }
    if (form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase()) { setError('Email addresses don\'t match.'); return }
    if (!form.phone.trim())    { setError('Phone number is required.'); return }
    if (!form.dob)             { setError('Date of birth is required.'); return }
    if (isMinor) {
      if (!form.guardianFirstName.trim() || !form.guardianLastName.trim()) { setError("Guardian's first and last name are required."); return }
      if (!form.guardianEmail.trim()) { setError("Guardian's email is required."); return }
      if (form.guardianEmail.trim().toLowerCase() !== form.guardianConfirmEmail.trim().toLowerCase()) { setError("Guardian's email addresses don't match."); return }
      if (!form.guardianPhone.trim()) { setError("Guardian's phone number is required."); return }
      if (!form.guardianRelationship.trim()) { setError('Relationship to the member is required.'); return }
    }
    if (!form.address1.trim() || form.address1.trim().length < 2) { setError('Address must be at least 2 characters.'); return }
    if (!form.city.trim() || form.city.trim().length < 2)         { setError('City must be at least 2 characters.'); return }
    if (!form.state.trim())    { setError('State is required.'); return }
    if (!/^\d{5}$/.test(form.zip)) { setError('Zip code must be 5 digits.'); return }
    // A selected group training tier bypasses the membership dropdown entirely —
    // the training price is billed on its own, so priceId isn't required there.
    const isGroupTrainingSelected = gymSlug === 'oasis-boston'
      && groupTrainingPlans.some(p => p.priceId === form.groupTrainingPriceId)
    if (!form.priceId && !isGroupTrainingSelected) { setError('Please select a membership type.'); return }
    if (!form.emergencyName.trim() || !form.emergencyPhone.trim()) { setError(isMinor ? "Guardian's emergency contact name and phone are required." : 'Emergency contact name and phone are required.'); return }
    if (!form.emergencyRelationship.trim() || form.emergencyRelationship.trim().length < 2) { setError('Emergency contact relationship must be at least 2 characters.'); return }
    if (signatureMismatch)     { setError('signature must match your name'); return }
    if (isStudent && !studentIdFile)           { setError('A student ID photo is required for student memberships.'); return }
    if (isStudent && !gradSemester)            { setError('Please select a graduation semester.'); return }
    if (isStudent && !gradYear)                { setError('Please select a graduation year.'); return }

    const isPtOrProgramming =
      (isTriumph && (ptPlans.some(p => p.priceId === form.priceId) || programmingPlans.some(p => p.priceId === form.priceId))) ||
      (isHydra   && (ptPlans.some(p => p.priceId === form.priceId) || addonPlans.some(p => p.priceId === form.addonPriceId)))

    // Guardian is the account holder for a minor's membership — their email/
    // phone become the checkout/contact info, not the (blank, unrendered)
    // member email/phone fields.
    const accountEmail = isMinor ? form.guardianEmail.trim() : form.email.trim()
    const accountPhone = isMinor ? form.guardianPhone.trim() : form.phone.trim()

    setSubmitting(true)
    try {
      // Upload student ID before proceeding (student plans only)
      let studentIdUploadId = ''
      if (isStudent && studentIdFile) {
        const fd = new FormData()
        fd.append('file',  studentIdFile)
        fd.append('email', accountEmail.toLowerCase())
        const uploadRes  = await fetch(`/api/${gymSlug}/join/student-id`, { method: 'POST', body: fd })
        const uploadJson = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadJson.error ?? 'Failed to upload student ID')
        studentIdUploadId = uploadJson.uploadId
      }

      const checkoutPayload = {
        firstName:             form.firstName.trim(),
        lastName:              form.lastName.trim(),
        email:                 accountEmail,
        phone:                 accountPhone,
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
        groupTrainingPriceId:  form.groupTrainingPriceId,
        studentIdUploadId,
        gradSemester:          isStudent ? gradSemester : '',
        gradYear:              isStudent ? gradYear     : '',
        hearAboutUs:           hearAboutUs || '',
        isMinor,
        guardianName:          isMinor ? `${form.guardianFirstName.trim()} ${form.guardianLastName.trim()}`.trim() : '',
        guardianEmail:         isMinor ? accountEmail : '',
        guardianPhone:         isMinor ? accountPhone : '',
        guardianRelationship:  isMinor ? form.guardianRelationship.trim() : '',
        signatureName:         form.signatureName.trim(),
        agreementVersion:      await agreementVersion(gymSlug, 'member'),
        promotionCode:         promotionCode.trim(),
      }

      // PT/programming/coaching plans: go to intake form first, then Stripe
      if (isPtOrProgramming) {
        const storageKey = isHydra ? 'hydra_join_payload'             : 'triumph_join_payload'
        const intakePath = isHydra ? '/hydra-athletic-co/join/pt-intake' : '/triumph-barbell/join/pt-intake'
        sessionStorage.setItem(storageKey, JSON.stringify(checkoutPayload))
        router.push(intakePath)
        return
      }

      // All other plans: go directly to Stripe checkout
      const res  = await fetch(`/api/${gymSlug}/join/checkout`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(checkoutPayload),
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
      <PublicPageHeader gymLogo={gymLogo} gymName={gymName} />

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
      >

        <SectionDivider label="membership registration" />

        {/* Name */}
        <div className="grid grid-cols-2 gap-3">
          <Field label={isMinor ? "member's first name" : 'first name'} required>
            <input
              type="text"
              placeholder="jane"
              value={form.firstName}
              onChange={e => set('firstName', e.target.value)}
              className={INPUT}
              required
            />
            {form.firstName.trim() && form.firstName.trim().length < 2 && (
              <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
            )}
          </Field>
          <Field label={isMinor ? "member's last name" : 'last name'} required>
            <input
              type="text"
              placeholder="smith"
              value={form.lastName}
              onChange={e => set('lastName', e.target.value)}
              className={INPUT}
              required
            />
            {form.lastName.trim() && form.lastName.trim().length < 2 && (
              <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
            )}
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

        {/* Confirm Email */}
        <Field label="confirm email" required>
          <input
            type="email"
            placeholder="jane@example.com"
            value={form.confirmEmail}
            onChange={e => set('confirmEmail', e.target.value)}
            autoComplete="off"
            onPaste={e => e.preventDefault()}
            onDrop={e => e.preventDefault()}
            className={INPUT}
            required
          />
          {form.confirmEmail && form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase() && (
            <p className="text-xs text-rose-400 mt-1">email addresses don't match</p>
          )}
        </Field>

        {/* Phone */}
        <Field label="phone number" required>
          <input
            type="tel"
            placeholder="(555) 000-0000"
            value={form.phone}
            onChange={e => set('phone', maskPhone(e.target.value))}
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

        {/* Guardian fields — animated inline reveal, no navigation. A minor
            can't legally sign the waiver or authorize payment, so once their
            DOB shows they're under 18 the guardian becomes the account
            holder for everything below. Collapsed (not unmounted) so the
            layout animates instead of jumping; inputs are only `required`
            while visible so hidden/collapsed fields never block submission
            or trip native validation on the adult path. */}
        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isMinor ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="flex flex-col gap-5 pt-1">
              <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3.5 py-3">
                <span className="text-amber-400 mt-px shrink-0">⚠</span>
                <p className="text-xs text-amber-200 leading-relaxed">
                  members under 18 need a parent or legal guardian to complete signup on their behalf. the guardian below becomes the account holder — they'll sign the waiver and complete payment.
                </p>
              </div>

              <SectionDivider label="guardian information" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="guardian's first name" required={isMinor}>
                  <input
                    type="text"
                    placeholder="john"
                    value={form.guardianFirstName}
                    onChange={e => set('guardianFirstName', e.target.value)}
                    className={INPUT}
                    required={isMinor}
                  />
                </Field>
                <Field label="guardian's last name" required={isMinor}>
                  <input
                    type="text"
                    placeholder="smith"
                    value={form.guardianLastName}
                    onChange={e => set('guardianLastName', e.target.value)}
                    className={INPUT}
                    required={isMinor}
                  />
                </Field>
              </div>
              <Field label="guardian's email" required={isMinor}>
                <input
                  type="email"
                  placeholder="john@example.com"
                  value={form.guardianEmail}
                  onChange={e => set('guardianEmail', e.target.value)}
                  className={INPUT}
                  required={isMinor}
                />
              </Field>
              <Field label="confirm guardian's email" required={isMinor}>
                <input
                  type="email"
                  placeholder="john@example.com"
                  value={form.guardianConfirmEmail}
                  onChange={e => set('guardianConfirmEmail', e.target.value)}
                  autoComplete="off"
                  onPaste={e => e.preventDefault()}
                  onDrop={e => e.preventDefault()}
                  className={INPUT}
                  required={isMinor}
                />
                {form.guardianConfirmEmail && form.guardianEmail.trim().toLowerCase() !== form.guardianConfirmEmail.trim().toLowerCase() && (
                  <p className="text-xs text-rose-400 mt-1">email addresses don't match</p>
                )}
              </Field>
              <Field label="guardian's phone number" required={isMinor}>
                <input
                  type="tel"
                  placeholder="(555) 000-0000"
                  value={form.guardianPhone}
                  onChange={e => set('guardianPhone', maskPhone(e.target.value))}
                  className={INPUT}
                  required={isMinor}
                />
              </Field>
              <Field label="relationship to member" required={isMinor}>
                <input
                  type="text"
                  placeholder="parent, legal guardian, etc."
                  value={form.guardianRelationship}
                  onChange={e => set('guardianRelationship', e.target.value)}
                  className={INPUT}
                  required={isMinor}
                />
              </Field>
            </div>
          </div>
        </div>

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
          {form.address1.trim() && form.address1.trim().length < 2 && (
            <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
          )}
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
            {form.city.trim() && form.city.trim().length < 2 && (
              <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
            )}
          </Field>
          <Field label="state" required>
            <div className="relative">
              <select
                value={form.state}
                onChange={e => set('state', e.target.value)}
                className={SELECT}
                required
              >
                <option value="">select state</option>
                {US_STATES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </Field>
        </div>
        <Field label="zip code" required>
          <input
            type="text"
            placeholder="02101"
            value={form.zip}
            onChange={e => set('zip', e.target.value.replace(/\D/g, '').slice(0, 5))}
            maxLength={5}
            className={INPUT}
            required
          />
        </Field>

        {/* Membership type — hidden for Oasis PT/group training plans, Triumph PT/programming plans, and Hydra PT plans */}
        {!(gymSlug === 'oasis-boston'      && (ptPlans.some(p => p.priceId === form.priceId) || groupTrainingPlans.some(p => p.priceId === form.groupTrainingPriceId))) &&
         !(gymSlug === 'triumph-barbell'   && (ptPlans.some(p => p.priceId === form.priceId) || programmingPlans.some(p => p.priceId === form.priceId))) &&
         !(gymSlug === 'hydra-athletic-co' && ptPlans.some(p => p.priceId === form.priceId)) &&
         <Field label="membership type" required>
          {membershipPlans.length === 0 ? (
            <p className="text-xs text-neutral-600 px-1">No plans available — contact the gym directly.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <select
                  value={membershipPlans.some(p => p.priceId === form.priceId) ? form.priceId : ''}
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
                    : membershipPlans
                  ).map(p => {
                    let displayFmt
                    if (gymSlug === 'oasis-boston') {
                      const n = p.name.toLowerCase()
                      if (n.includes('flex')) {
                        displayFmt = fmt(p.amount, p.interval, p.intervalCount)
                      } else if (n.includes('semiannual')) {
                        displayFmt = `${Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / 6 months`
                      } else {
                        displayFmt = `${Number(p.amount * 2).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / 4 weeks`
                      }
                    } else if (gymSlug === 'hydra-athletic-co' && p.name.toLowerCase().includes('pre-sale membership')) {
                      displayFmt = '$50.00 / 4 weeks'
                    } else if (gymSlug === 'hydra-athletic-co' && !p.interval) {
                      displayFmt = Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                    } else {
                      displayFmt = fmt(p.amount, p.interval, p.intervalCount)
                    }
                    return (
                      <option key={p.priceId} value={p.priceId}>
                        {p.name.toLowerCase()} — {displayFmt}
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
                    billed every 2 weeks at {biweekly}.
                  </p>
                )
              })()}
            </div>
          )}
        </Field>}

        {/* Personal Training — oasis-boston only; hidden while group training is selected */}
        {gymSlug === 'oasis-boston' && ptPlans.length > 0
         && !groupTrainingPlans.some(p => p.priceId === form.groupTrainingPriceId) && (
          <Field label="personal training (optional)">
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <select
                  value={ptPlans.some(p => p.priceId === form.priceId) ? form.priceId : ''}
                  onChange={e => {
                    if (e.target.value) {
                      selectPlan(e.target.value)
                      // Defensively clear group training too — the two are mutually
                      // exclusive and this guarantees that state regardless of path.
                      setForm(f => ({ ...f, groupTrainingPriceId: '' }))
                    } else {
                      // Deselect PT — clear priceId so user must pick a regular plan
                      setForm(f => ({ ...f, priceId: '', membershipType: '', requiresStudentId: false }))
                    }
                  }}
                  className={SELECT}
                >
                  <option value="">— none —</option>
                  {ptPlans.map(p => (
                    <option key={p.priceId} value={p.priceId}>
                      {p.name.replace(/(\d+\s*sessions?)\s*\/\s*week/i, '$1 / week')} — {Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / 4 weeks
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              {ptPlans.some(p => p.priceId === form.priceId) && (
                <p className="text-[11px] text-neutral-500 px-0.5">gym membership included.</p>
              )}
            </div>
          </Field>
        )}

        {/* Group Training — oasis-boston only; additional line item alongside base
            membership; hidden while personal training is selected */}
        {gymSlug === 'oasis-boston' && groupTrainingPlans.length > 0
         && !ptPlans.some(p => p.priceId === form.priceId) && (
          <Field label="group training (optional)">
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <select
                  value={form.groupTrainingPriceId}
                  onChange={e => {
                    const priceId = e.target.value
                    if (priceId) {
                      // Selecting a tier overwrites membershipType with the group
                      // training tier — same pattern PT already uses — so signup
                      // metadata reflects what's actually being billed, not
                      // whatever the now-hidden base membership last held.
                      // Prefixed with "group training: " since the tier names
                      // themselves ("1 session/week" etc) are otherwise identical
                      // strings to PT's own — without this they'd be indistinguishable
                      // and get bucketed under "personal training" by mistake.
                      const plan = groupTrainingPlans.find(p => p.priceId === priceId)
                      setForm(f => ({ ...f, groupTrainingPriceId: priceId, membershipType: plan ? `group training: ${plan.membershipType}` : f.membershipType }))
                    } else {
                      // Deselecting restores membershipType to whatever the base
                      // membership dropdown is currently set to (untouched this
                      // whole time), not PT's clear-to-empty behavior — the base
                      // plan selection is independent and shouldn't be wiped.
                      setForm(f => {
                        const basePlan = membershipPlans.find(p => p.priceId === f.priceId)
                        return { ...f, groupTrainingPriceId: '', membershipType: basePlan?.membershipType ?? f.membershipType }
                      })
                    }
                  }}
                  className={SELECT}
                >
                  <option value="">— none —</option>
                  {groupTrainingPlans.map(p => (
                    <option key={p.priceId} value={p.priceId}>
                      {p.name.replace(/(\d+\s*sessions?)\s*\/\s*week/i, '$1 / week')} — {Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / 4 weeks
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              {groupTrainingPlans.some(p => p.priceId === form.groupTrainingPriceId) && (
                <p className="text-[11px] text-neutral-500 px-0.5">gym membership included.</p>
              )}
            </div>
          </Field>
        )}

        {/* Student fields — shown for any student membership plan */}
        {isStudent && (
          <>
            <Field label="upload student ID" required>
              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-center gap-2 w-full border border-dashed border-neutral-600 rounded-lg px-3 py-4 cursor-pointer hover:border-neutral-400 transition-colors">
                  <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <span className="text-xs text-neutral-400">
                    {studentIdFile ? studentIdFile.name : 'choose photo or PDF'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="sr-only"
                    onChange={e => setStudentIdFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </Field>

            <Field label="expected graduation" required>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <select
                    value={gradSemester}
                    onChange={e => setGradSemester(e.target.value)}
                    className={SELECT}
                  >
                    <option value="">semester</option>
                    <option value="Fall">fall</option>
                    <option value="Spring">spring</option>
                    <option value="Summer">summer</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <div className="relative">
                  <select
                    value={gradYear}
                    onChange={e => setGradYear(e.target.value)}
                    className={SELECT}
                  >
                    <option value="">year</option>
                    {gradYearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              </div>
            </Field>
          </>
        )}

        {/* Personal Training — triumph-barbell only; hidden when a programming plan is selected */}
        {gymSlug === 'triumph-barbell' && ptPlans.length > 0 && !programmingPlans.some(p => p.priceId === form.priceId) && (
          <Field label="personal training (optional)">
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <select
                  value={ptPlans.some(p => p.priceId === form.priceId) ? form.priceId : ''}
                  onChange={e => {
                    if (e.target.value) {
                      selectPlan(e.target.value)
                    } else {
                      setForm(f => ({ ...f, priceId: '', membershipType: '', requiresStudentId: false }))
                    }
                  }}
                  className={SELECT}
                >
                  <option value="">— none —</option>
                  {ptPlans.map(p => {
                    const breakdown = p.amount === 350 ? '1 session / week' : p.amount === 610 ? '2 sessions / week' : p.amount === 830 ? '3 sessions / week' : null
                    const label = breakdown
                      ? `${breakdown} — ${Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / month`
                      : `${p.name} — ${fmt(p.amount, p.interval, p.intervalCount)}`
                    return (
                      <option key={p.priceId} value={p.priceId}>{label}</option>
                    )
                  })}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              {ptPlans.some(p => p.priceId === form.priceId) && (
                <p className="text-[11px] text-neutral-500 px-0.5">gym membership included.</p>
              )}
            </div>
          </Field>
        )}

        {/* Programming — triumph-barbell only; hidden when a PT plan is selected */}
        {gymSlug === 'triumph-barbell' && programmingPlans.length > 0 && !ptPlans.some(p => p.priceId === form.priceId) && (
          <Field label="programming (optional)">
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <select
                  value={programmingPlans.some(p => p.priceId === form.priceId) ? form.priceId : ''}
                  onChange={e => {
                    if (e.target.value) {
                      selectPlan(e.target.value)
                    } else {
                      setForm(f => ({ ...f, priceId: '', membershipType: '', requiresStudentId: false }))
                    }
                  }}
                  className={SELECT}
                >
                  <option value="">— none —</option>
                  {programmingPlans.map(p => {
                    const breakdown = p.amount === 150 ? 'programming only' : p.amount === 225 ? 'weekly check-ins' : p.amount === 300 ? 'daily check-ins' : null
                    const label = breakdown
                      ? `${breakdown} — ${Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / month`
                      : `${p.name} — ${fmt(p.amount, p.interval, p.intervalCount)}`
                    return (
                      <option key={p.priceId} value={p.priceId}>{label}</option>
                    )
                  })}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              {programmingPlans.some(p => p.priceId === form.priceId) && (
                <p className="text-[11px] text-neutral-500 px-0.5">gym membership included.</p>
              )}
            </div>
          </Field>
        )}

        {/* Coaching / Programming Add-on — non-triumph gyms only */}
        {!isTriumph && addonPlans.length > 0 && (
          <Field label={gymSlug === 'hydra-athletic-co' ? 'programming (optional)' : 'coaching / programming add-on (optional)'}>
            <div className="relative">
              <select
                value={form.addonPriceId}
                onChange={e => set('addonPriceId', e.target.value)}
                className={SELECT}
              >
                <option value="">— none —</option>
                {addonPlans.map(p => {
                  const isHydra4Week = gymSlug === 'hydra-athletic-co' &&
                    (p.interval === 'month' || (p.interval === 'week' && p.intervalCount === 4))
                  const addonFmt = isHydra4Week
                    ? `${Number(p.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} / 4 weeks`
                    : fmt(p.amount, p.interval, p.intervalCount)
                  return (
                    <option key={p.priceId} value={p.priceId}>
                      {gymSlug === 'hydra-athletic-co' ? p.name.toLowerCase() : p.name} — {addonFmt}
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
          </Field>
        )}

        <SectionDivider label={isMinor ? "guardian's emergency contact info" : 'emergency contact info'} />
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
              onChange={e => set('emergencyPhone', maskPhone(e.target.value))}
              className={INPUT}
              required
            />
          </Field>
        </div>
        <Field label="relationship" required>
          <input
            type="text"
            placeholder="spouse, parent, friend…"
            value={form.emergencyRelationship}
            onChange={e => set('emergencyRelationship', e.target.value)}
            className={INPUT}
            required
          />
          {form.emergencyRelationship.trim() && form.emergencyRelationship.trim().length < 2 && (
            <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
          )}
        </Field>

        {/* How did you hear about us — triumph-barbell only */}
        {isTriumph && (
          <Field label="how did you hear about us?">
            <div className="relative">
              <select
                value={hearAboutUs}
                onChange={e => setHearAboutUs(e.target.value)}
                className={SELECT}
              >
                <option value="">— select one —</option>
                <option value="google">google</option>
                <option value="instagram">instagram</option>
                <option value="facebook">facebook</option>
                <option value="tiktok">tiktok</option>
                <option value="a friend / word of mouth">a friend / word of mouth</option>
                <option value="walked by">walked by</option>
                <option value="other">other</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg className="w-4 h-4 text-neutral-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </Field>
        )}

        <SectionDivider label="terms" />

        {/* Waiver — typed signature */}
        <SignatureField
          value={form.signatureName}
          onChange={v => set('signatureName', v)}
          expectedName={signerName}
        >
          {isMinor ? (
            <>
              i, {form.guardianFirstName.trim() || 'the undersigned'} {form.guardianLastName.trim()}, as parent/legal guardian of {form.firstName.trim() || 'the member'} {form.lastName.trim()}, agree to the{' '}
              <button
                type="button"
                onClick={() => setWaiverOpen(true)}
                className="text-white underline underline-offset-2 hover:text-neutral-200 transition-colors"
              >
                membership terms and release of liability
              </button>
              {' '}on their behalf.
            </>
          ) : (
            <>
              i agree to the{' '}
              <button
                type="button"
                onClick={() => setWaiverOpen(true)}
                className="text-white underline underline-offset-2 hover:text-neutral-200 transition-colors"
              >
                membership terms and release of liability
              </button>
            </>
          )}
        </SignatureField>

        <Field label="promo code (optional)">
          <input
            type="text" autoComplete="off" autoCapitalize="characters"
            value={promotionCode} onChange={e => setPromotionCode(e.target.value)}
            className={INPUT}
          />
        </Field>

        {error && (
          <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3.5 py-3">
            <span className="text-rose-400 mt-px shrink-0">⚠</span>
            <p className="text-xs text-rose-400 leading-relaxed">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || membershipPlans.length === 0 || signatureMismatch || (isMinor
            ? (!!form.guardianConfirmEmail && form.guardianEmail.trim().toLowerCase() !== form.guardianConfirmEmail.trim().toLowerCase())
            : (!!form.confirmEmail && form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase()))}
          className={`${BUTTON_PRIMARY} mt-1`}
        >
          {submitting ? (
            <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
          ) : (
            'continue to payment →'
          )}
        </button>

        <p className="text-center text-[11px] text-neutral-700">© 2026 · powered by <a href="https://ironkeyentry.com" target="_blank" rel="noopener noreferrer" className="underline"><strong>ironkey llc</strong></a></p>

      </form>

      {waiverOpen && (
        <WaiverModal
          sections={agreementSections(gymSlug, 'member')}
          onClose={() => setWaiverOpen(false)}
        />
      )}
    </div>
  )
}
