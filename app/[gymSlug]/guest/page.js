'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, X, ShoppingCart, LogIn, CheckCircle2, ChevronLeft, Dumbbell } from 'lucide-react'
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

// ── Waiver Modal ───────────────────────────────────────────────────────────────

function WaiverModal({ sections, onClose }) {
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
          {sections.map(s => (
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

// A minor can't legally sign the liability waiver or authorize payment
// themselves — this determines whether the guardian fields reveal inline.
function calculateAge(dobStr) {
  const dob = new Date(dobStr)
  if (isNaN(dob.getTime())) return null
  return (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
}


// ── Plan selector ──────────────────────────────────────────────────────────────

function PlanSelector({ plans, value, onChange }) {
  if (!plans.length) {
    return <p className="text-xs text-neutral-600 px-1">No plans available — contact the gym directly.</p>
  }
  // Student passes sort to the end, regardless of gym or where Stripe's price
  // list happens to place them — everything else keeps its relative order.
  const sortedPlans = [
    ...plans.filter(p => !p.name.toLowerCase().includes('student')),
    ...plans.filter(p => p.name.toLowerCase().includes('student')),
  ]
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className={SELECT}>
        {sortedPlans.map(p => (
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
  const [gymLogo,    setGymLogo]    = useState(null)
  const [plans,      setPlans]      = useState([])
  // Set when a pass bought now gets a later door-code window (outside the
  // gym's access hours / after last entry) — computed server-side
  const [accessNotice, setAccessNotice] = useState(null)
  const [pageLoading, setPageLoading] = useState(true)

  // step: intent | email-input | new-form | returning-confirm | checkin-confirm | checkin-done | flex-confirm | flex-done
  const [step,       setStep]       = useState('intent')
  const [mode,       setMode]       = useState(null)   // 'purchase' | 'checkin' | 'flex'
  const [submitting, setSubmitting] = useState(false)
  const [promotionCode, setPromotionCode] = useState('')
  const [error,      setError]      = useState(null)
  // Sign-only waiver (kiosk check-in without a waiver on file at this gym)
  const [waiverSignature, setWaiverSignature] = useState('')
  const [waiverSignedNote, setWaiverSignedNote] = useState(false)
  const [waiverOpen, setWaiverOpen] = useState(false)

  // New guest form fields
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', confirmEmail: '', phone: '', dob: '',
    address1: '', address2: '', city: '', state: '', zip: '',
    emergencyName: '', emergencyPhone: '', emergencyRelationship: '',
    guardianFirstName: '', guardianLastName: '',
    guardianEmail: '', guardianConfirmEmail: '', guardianPhone: '', guardianRelationship: '',
    signatureName: '',
  })

  const age     = form.dob ? calculateAge(form.dob) : null
  const isMinor = age !== null && age < 18
  // Typed waiver signature: the guardian signs for a minor
  const signerName = isMinor
    ? `${form.guardianFirstName.trim()} ${form.guardianLastName.trim()}`.trim()
    : `${form.firstName.trim()} ${form.lastName.trim()}`.trim()
  const signatureMismatch = signatureError(form.signatureName, { isMinor, guardianName: signerName, name: signerName }) !== null

  // Shared
  const [selectedPriceId, setSelectedPriceId] = useState('')
  const [studentIdFile,   setStudentIdFile]   = useState(null)
  const [lookupEmail,     setLookupEmail]      = useState('')
  const [lookupResult,    setLookupResult]     = useState(null)   // { profile, hasSignedWaiver, passesLeft, packs }
  const [returningName,   setReturningName]    = useState('')
  const [checkinResult,   setCheckinResult]    = useState(null)
  const [resendState,     setResendState]      = useState(null)   // null | 'sending' | 'sent'
  const [resendError,     setResendError]      = useState(null)
  const [flexMember,      setFlexMember]       = useState(null)   // { firstName, lastName }
  const [flexResult,      setFlexResult]       = useState(null)   // { checkInsUsed, checkInsRemaining }

  // "Student Pass" is identified purely by name — no dedicated metadata tag
  // exists (same loose-match convention used elsewhere for guest pass types).
  const selectedPlan     = plans.find(p => p.priceId === selectedPriceId)
  const requiresStudentId = Boolean(selectedPlan?.name?.toLowerCase().includes('student'))

  // Oasis's student pass is weekend-only — checked in the client's own local
  // time (this page is normally used in-person at the gym, so that's the
  // relevant clock here; the server enforces the authoritative check in the
  // gym's own timezone regardless of who's actually looking at the form).
  const isOasisStudentPass = gymSlug === 'oasis-boston' && requiresStudentId
  const isWeekendNow       = [0, 6].includes(new Date().getDay())
  const studentPassBlockedByDay = isOasisStudentPass && !isWeekendNow

  useEffect(() => {
    document.title = 'guest pass registration'
    fetch(`/api/${gymSlug}/guest`)
      .then(r => r.json())
      .then(({ gym, plans }) => {
        setGymName((gym?.name ?? gymSlug).replace(/-/g, ' '))
        setGymLogo(gym?.logoUrl ?? null)
        const p = plans ?? []
        console.log('[guest/page] plans from API:', JSON.stringify(p))
        setPlans(p)
        // Default to "Single Pass" specifically — not just any passType
        // 'SINGLE' plan, since "Student Pass" also collapses to passType
        // 'SINGLE' (its 1-pass count) and would otherwise be picked first.
        // Falls back to the first passType-'SINGLE' match, then the first
        // plan overall, so something is always pre-selected.
        const defaultPlan = p.find(pl => pl.name?.toLowerCase() === 'single pass')
          ?? p.find(pl => pl.passType === 'SINGLE')
          ?? p[0]
        if (defaultPlan) setSelectedPriceId(defaultPlan.priceId)
      })
      .catch(() => {})
      .finally(() => setPageLoading(false))
  }, [gymSlug])

  // Re-checked every minute so the notice appears if closing / last entry
  // passes while the form is open
  useEffect(() => {
    let cancelled = false
    const load = () => fetch(`/api/${gymSlug}/guest/access-notice`)
      .then(r => r.json())
      .then(({ notice }) => { if (!cancelled) setAccessNotice(notice ?? null) })
      .catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [gymSlug])

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function clearError()   { setError(null) }

  function goBack() {
    clearError()
    if (step === 'email-input')            { setStep('intent'); setMode(null) }
    else if (step === 'new-form')          { setStep('email-input') }
    else if (step === 'returning-confirm') {
      // If we jumped here from checkin-confirm (0 passes), go back there
      if (lookupResult?.passesLeft === 0) { setStep('checkin-confirm') }
      else { setStep('email-input') }
    }
    else if (step === 'checkin-confirm')   { setStep('email-input') }
    else if (step === 'waiver-sign')       { setStep('checkin-confirm') }
    else if (step === 'flex-confirm')      { setStep('email-input') }
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
        setWaiverSignedNote(false)
        setStep('checkin-confirm')
      } else {
        // purchase — hasSignedWaiver determines which form to show
        setLookupResult(json)
        if (json.hasSignedWaiver) {
          setReturningName(json.profile?.name ?? '')
          setStep('returning-confirm')
        } else {
          // First time at this gym — pre-fill email and show full form
          setField('email', lookupEmail.trim())
          setStep('new-form')
        }
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

    if (!form.firstName.trim() || !form.lastName.trim() || form.firstName.trim().length < 2 || form.lastName.trim().length < 2) { setError('first and last name must be at least 2 characters.'); return }
    if (!form.email.trim())    { setError('email is required.'); return }
    if (form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase()) { setError('email addresses don\'t match.'); return }
    if (!form.phone.trim())    { setError('phone number is required.'); return }
    if (!form.dob)             { setError('date of birth is required.'); return }
    if (isMinor) {
      if (!form.guardianFirstName.trim() || !form.guardianLastName.trim()) { setError("guardian's first and last name are required."); return }
      if (!form.guardianEmail.trim()) { setError("guardian's email is required."); return }
      if (form.guardianEmail.trim().toLowerCase() !== form.guardianConfirmEmail.trim().toLowerCase()) { setError("guardian's email addresses don't match."); return }
      if (!form.guardianPhone.trim()) { setError("guardian's phone number is required."); return }
      if (!form.guardianRelationship.trim()) { setError('relationship to the guest is required.'); return }
    }
    if (!form.address1.trim() || form.address1.trim().length < 2) { setError('address must be at least 2 characters.'); return }
    if (!form.city.trim() || form.city.trim().length < 2)         { setError('city must be at least 2 characters.'); return }
    if (!form.state.trim())    { setError('state is required.'); return }
    if (!/^\d{5}$/.test(form.zip)) { setError('zip code must be 5 digits.'); return }
    if (!form.emergencyName.trim() || !form.emergencyPhone.trim()) { setError('emergency contact name and phone are required.'); return }
    if (!form.emergencyRelationship.trim() || form.emergencyRelationship.trim().length < 2) { setError('emergency contact relationship must be at least 2 characters.'); return }
    if (signatureMismatch)     { setError('signature must match your name'); return }
    if (!selectedPriceId)      { setError('please select a pass type.'); return }
    if (requiresStudentId && !studentIdFile) { setError('a student ID photo is required for this pass type.'); return }
    if (studentPassBlockedByDay) { setError('student pass is only available on weekends.'); return }

    const plan = selectedPlan
    console.log('[guest/page] new guest checkout — selectedPriceId:', selectedPriceId, '| matched plan:', JSON.stringify(plan), '| sending passType:', plan?.passType ?? 'SINGLE')

    // Guardian is the point of contact for a minor's guest pass — their
    // email/phone become the checkout/contact info, not the minor's own.
    const accountEmail = isMinor ? form.guardianEmail.trim() : form.email.trim()
    const accountPhone = isMinor ? form.guardianPhone.trim() : form.phone.trim()

    setSubmitting(true)
    try {
      // Upload the student ID before checkout — mirrors the join flow
      // exactly, reusing the same staging endpoint/table so payment can
      // still fail/abandon without a file ever landing on a permanent record.
      let studentIdUploadId = ''
      if (requiresStudentId && studentIdFile) {
        const fd = new FormData()
        fd.append('file',  studentIdFile)
        fd.append('email', accountEmail.toLowerCase())
        const uploadRes  = await fetch(`/api/${gymSlug}/join/student-id`, { method: 'POST', body: fd })
        const uploadJson = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadJson.error ?? 'failed to upload student ID')
        studentIdUploadId = uploadJson.uploadId
      }

      const res = await fetch(`/api/${gymSlug}/guest/checkout`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          priceId:               selectedPriceId,
          passType:              plan?.passType   ?? 'SINGLE',
          passesLeft:            plan?.passesLeft ?? 1,
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
          isNewGuest:            true,
          isMinor,
          guardianName:          isMinor ? `${form.guardianFirstName.trim()} ${form.guardianLastName.trim()}`.trim() : '',
          guardianEmail:         isMinor ? accountEmail : '',
          guardianPhone:         isMinor ? accountPhone : '',
          guardianRelationship:  isMinor ? form.guardianRelationship.trim() : '',
          signatureName:         form.signatureName.trim(),
          agreementVersion:      await agreementVersion(gymSlug, 'guest'),
          studentIdUploadId,
          promotionCode:         promotionCode.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'something went wrong')
      if (!json.url) throw new Error('no checkout URL returned — please try again.')
      window.location.href = json.url
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  // ── Submit returning guest checkout ───────────────────────────────────────
  async function handleReturningCheckout() {
    clearError()
    if (!returningName.trim()) { setError('please enter your name.'); return }
    if (!selectedPriceId)      { setError('please select a pass type.'); return }
    if (requiresStudentId && !studentIdFile) { setError('a student ID photo is required for this pass type.'); return }
    if (studentPassBlockedByDay) { setError('student pass is only available on weekends.'); return }
    const plan = selectedPlan
    console.log('[guest/page] returning guest checkout — selectedPriceId:', selectedPriceId, '| matched plan:', JSON.stringify(plan), '| sending passType:', plan?.passType ?? 'SINGLE')
    setSubmitting(true)
    try {
      let studentIdUploadId = ''
      if (requiresStudentId && studentIdFile) {
        const fd = new FormData()
        fd.append('file',  studentIdFile)
        fd.append('email', lookupEmail.trim().toLowerCase())
        const uploadRes  = await fetch(`/api/${gymSlug}/join/student-id`, { method: 'POST', body: fd })
        const uploadJson = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadJson.error ?? 'failed to upload student ID')
        studentIdUploadId = uploadJson.uploadId
      }

      const res = await fetch(`/api/${gymSlug}/guest/checkout`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          priceId:    selectedPriceId,
          passType:   plan?.passType   ?? 'SINGLE',
          passesLeft: plan?.passesLeft ?? 1,
          name:       returningName.trim(),
          email:      lookupEmail.trim(),
          isNewGuest: false,
          studentIdUploadId,
          promotionCode: promotionCode.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'something went wrong')
      if (!json.url) throw new Error('no checkout URL returned — please try again.')
      window.location.href = json.url
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  // ── Check in ──────────────────────────────────────────────────────────────
  async function handleSignWaiver() {
    clearError()
    setSubmitting(true)
    try {
      const res = await fetch(`/api/${gymSlug}/guest/waiver`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:            lookupEmail.trim(),
          signatureName:    waiverSignature.trim(),
          agreementVersion: await agreementVersion(gymSlug, 'guest'),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'could not save the waiver')
      // Back to check-in
      setWaiverSignedNote(true)
      setStep('checkin-confirm')
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

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
      console.log('[guest/checkin] response status=%d body=%o', res.status, json)
      // No active pass (e.g. used up since the lookup) → show the "buy a pass" panel
      if (res.status === 402 && json.needsPass) {
        setLookupResult(prev => ({ ...(prev ?? {}), passesLeft: 0, packs: [] }))
        setStep('checkin-confirm')
        return
      }
      // No waiver signed at this gym → sign it here (no purchase), then back to check-in
      if (res.status === 403 && json.needsWaiver) {
        setWaiverSignature('')
        setStep('waiver-sign')
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'check-in failed')
      setCheckinResult(json)
      setStep('checkin-done')
    } catch (e) {
      console.error('[guest/checkin] failed:', e.message)
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Resend the current door code (emailed; never shown) ──────────────────
  async function handleResendCode() {
    setResendState('sending')
    setResendError(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/guest-passes/checkin/resend`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: lookupEmail.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'could not resend — please see the front desk.')
      setResendState('sent')
    } catch (err) {
      setResendState(null)
      setResendError(err.message)
    }
  }

  // ── Flex member lookup ────────────────────────────────────────────────────
  async function handleFlexLookup(e) {
    e.preventDefault()
    clearError()
    if (!lookupEmail.trim()) { setError('please enter your email address.'); return }
    setSubmitting(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/flex-checkin?email=${encodeURIComponent(lookupEmail.trim())}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'lookup failed')
      setFlexMember(json.member)
      setFlexResult({ checkInsUsed: json.checkInsUsed, checkInsRemaining: json.checkInsRemaining })
      setStep('flex-confirm')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Flex check-in ─────────────────────────────────────────────────────────
  async function handleFlexCheckin() {
    clearError()
    setSubmitting(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/flex-checkin`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: lookupEmail.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'check-in failed')
      setFlexResult(json)
      setStep('flex-done')
    } catch (err) {
      setError(err.message)
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
      <PublicPageHeader gymLogo={gymLogo} gymName={gymName} />

      <div className="w-full max-w-2xl">

        {/* ── Back button ─────────────────────────────────────────────────── */}
        {step !== 'intent' && step !== 'checkin-done' && step !== 'flex-done' && (
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
              onClick={() => { clearError(); setStep('email-input'); setMode('purchase') }}
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
                <p className="text-sm font-semibold text-white">check in with existing pack</p>
                <p className="text-xs text-neutral-500 mt-0.5">use a pack you've already purchased</p>
              </div>
            </button>

            {gymSlug === 'oasis-boston' && (
              <button
                onClick={() => { clearError(); setMode('flex'); setStep('email-input') }}
                className="w-full bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-6 flex items-center gap-4 text-left hover:border-neutral-600 transition-colors group"
              >
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:bg-white/15 transition-colors">
                  <Dumbbell size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">check in with flex membership</p>
                  <p className="text-xs text-neutral-500 mt-0.5">up to 5 check-ins per month</p>
                </div>
              </button>
            )}
          </div>
        )}

        {/* ── Step: new-form ─────────────────────────────────────────────── */}
        {step === 'new-form' && (
          <form
            onSubmit={handleNewGuestSubmit}
            className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
          >
            <SectionDivider label="guest pass registration" />

            {/* Name */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="first name" required>
                <input
                  type="text" placeholder="jane"
                  value={form.firstName} onChange={e => setField('firstName', e.target.value)}
                  className={INPUT} required
                />
                {form.firstName.trim() && form.firstName.trim().length < 2 && (
                  <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
                )}
              </Field>
              <Field label="last name" required>
                <input
                  type="text" placeholder="smith"
                  value={form.lastName} onChange={e => setField('lastName', e.target.value)}
                  className={INPUT} required
                />
                {form.lastName.trim() && form.lastName.trim().length < 2 && (
                  <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
                )}
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

            {/* Confirm Email */}
            <Field label="confirm email" required>
              <input
                type="email" placeholder="jane@example.com"
                value={form.confirmEmail} onChange={e => setField('confirmEmail', e.target.value)}
                autoComplete="off"
                onPaste={e => e.preventDefault()}
                onDrop={e => e.preventDefault()}
                className={INPUT} required
              />
              {form.confirmEmail && form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase() && (
                <p className="text-xs text-rose-400 mt-1">email addresses don't match</p>
              )}
            </Field>

            {/* Phone */}
            <Field label="phone number" required>
              <input
                type="tel" placeholder="(555) 000-0000"
                value={form.phone} onChange={e => setField('phone', maskPhone(e.target.value))}
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

            {/* Guardian fields — animated inline reveal, no navigation. A
                minor can't legally sign the waiver or authorize payment, so
                once their DOB shows they're under 18 the guardian becomes
                the point of contact for everything below. */}
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isMinor ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
                <div className="flex flex-col gap-5 pt-1">
                  <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3.5 py-3">
                    <span className="text-amber-400 mt-px shrink-0">⚠</span>
                    <p className="text-xs text-amber-200 leading-relaxed">
                      guests under 18 need a parent or legal guardian to complete this on their behalf. the guardian below becomes the point of contact — they'll sign the waiver and complete payment.
                    </p>
                  </div>

                  <SectionDivider label="guardian information" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="guardian's first name" required={isMinor}>
                      <input
                        type="text" placeholder="john"
                        value={form.guardianFirstName} onChange={e => setField('guardianFirstName', e.target.value)}
                        className={INPUT} required={isMinor}
                      />
                    </Field>
                    <Field label="guardian's last name" required={isMinor}>
                      <input
                        type="text" placeholder="smith"
                        value={form.guardianLastName} onChange={e => setField('guardianLastName', e.target.value)}
                        className={INPUT} required={isMinor}
                      />
                    </Field>
                  </div>
                  <Field label="guardian's email" required={isMinor}>
                    <input
                      type="email" placeholder="john@example.com"
                      value={form.guardianEmail} onChange={e => setField('guardianEmail', e.target.value)}
                      className={INPUT} required={isMinor}
                    />
                  </Field>
                  <Field label="confirm guardian's email" required={isMinor}>
                    <input
                      type="email" placeholder="john@example.com"
                      value={form.guardianConfirmEmail} onChange={e => setField('guardianConfirmEmail', e.target.value)}
                      autoComplete="off"
                      onPaste={e => e.preventDefault()}
                      onDrop={e => e.preventDefault()}
                      className={INPUT} required={isMinor}
                    />
                    {form.guardianConfirmEmail && form.guardianEmail.trim().toLowerCase() !== form.guardianConfirmEmail.trim().toLowerCase() && (
                      <p className="text-xs text-rose-400 mt-1">email addresses don't match</p>
                    )}
                  </Field>
                  <Field label="guardian's phone number" required={isMinor}>
                    <input
                      type="tel" placeholder="(555) 000-0000"
                      value={form.guardianPhone} onChange={e => setField('guardianPhone', maskPhone(e.target.value))}
                      className={INPUT} required={isMinor}
                    />
                  </Field>
                  <Field label="relationship to guest" required={isMinor}>
                    <input
                      type="text" placeholder="parent, legal guardian, etc."
                      value={form.guardianRelationship} onChange={e => setField('guardianRelationship', e.target.value)}
                      className={INPUT} required={isMinor}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* Address */}
            <Field label="address line 1" required>
              <input
                type="text" placeholder="123 main st"
                value={form.address1} onChange={e => setField('address1', e.target.value)}
                className={INPUT} required
              />
              {form.address1.trim() && form.address1.trim().length < 2 && (
                <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
              )}
            </Field>
            <Field label="address line 2">
              <input
                type="text" placeholder="apt, suite, unit (optional)"
                value={form.address2} onChange={e => setField('address2', e.target.value)}
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="city" required>
                <input
                  type="text" placeholder="boston"
                  value={form.city} onChange={e => setField('city', e.target.value)}
                  className={INPUT} required
                />
                {form.city.trim() && form.city.trim().length < 2 && (
                  <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
                )}
              </Field>
              <Field label="state" required>
                <div className="relative">
                  <select
                    value={form.state} onChange={e => setField('state', e.target.value)}
                    className={SELECT} required
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
                type="text" placeholder="02101"
                value={form.zip} onChange={e => setField('zip', e.target.value.replace(/\D/g, '').slice(0, 5))}
                maxLength={5}
                className={INPUT} required
              />
            </Field>

            <SectionDivider label={isMinor ? "guardian's emergency contact" : 'emergency contact'} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="name" required>
                <input
                  type="text" placeholder="john smith"
                  value={form.emergencyName} onChange={e => setField('emergencyName', e.target.value)}
                  className={INPUT} required
                />
              </Field>
              <Field label="phone" required>
                <input
                  type="tel" placeholder="(555) 000-0000"
                  value={form.emergencyPhone} onChange={e => setField('emergencyPhone', maskPhone(e.target.value))}
                  className={INPUT} required
                />
              </Field>
            </div>
            <Field label="relationship" required>
              <input
                type="text" placeholder="spouse, parent, friend…"
                value={form.emergencyRelationship} onChange={e => setField('emergencyRelationship', e.target.value)}
                className={INPUT} required
              />
              {form.emergencyRelationship.trim() && form.emergencyRelationship.trim().length < 2 && (
                <p className="text-xs text-rose-400 mt-1">must be at least 2 characters</p>
              )}
            </Field>

            <SectionDivider label="pass type" />

            {/* Pass type */}
            <Field label="pass type" required>
              <PlanSelector
                plans={plans}
                value={selectedPriceId}
                onChange={setSelectedPriceId}
              />
              {studentPassBlockedByDay && (
                <p className="text-xs text-rose-400 mt-1">student pass is only available on weekends.</p>
              )}
            </Field>

            {requiresStudentId && (
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
            )}

            <SectionDivider label="terms" />

            {/* Waiver — typed signature */}
            <SignatureField
              value={form.signatureName}
              onChange={v => setField('signatureName', v)}
              expectedName={signerName}
            >
              {isMinor ? (
                <>
                  i, {form.guardianFirstName.trim() || 'the undersigned'} {form.guardianLastName.trim()}, as parent/legal guardian of {form.firstName.trim() || 'the guest'} {form.lastName.trim()}, agree to the{' '}
                  <button
                    type="button"
                    onClick={() => setWaiverOpen(true)}
                    className="text-white underline underline-offset-2 hover:text-neutral-200 transition-colors"
                  >
                    liability waiver & terms
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
                    liability waiver & terms
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

            {accessNotice && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                {accessNotice}
              </p>
            )}

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || plans.length === 0
                || signatureMismatch
                || (!!form.confirmEmail && form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase())
                || (isMinor && !!form.guardianConfirmEmail && form.guardianEmail.trim().toLowerCase() !== form.guardianConfirmEmail.trim().toLowerCase())
                || (requiresStudentId && !studentIdFile)
                || studentPassBlockedByDay}
              className={BUTTON_PRIMARY}
            >
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
                : 'continue to payment →'
              }
            </button>

          </form>
        )}

        {/* ── Step: email-input (returning purchase, check-in, or flex) ──── */}
        {step === 'email-input' && (
          <form
            onSubmit={mode === 'flex' ? handleFlexLookup : handleLookup}
            className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
          >
            <div>
              <p className="text-sm font-semibold text-white">
                {mode === 'flex' ? 'flex check-in' : mode === 'checkin' ? 'check in' : 'enter your email'}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                {mode === 'flex'
                  ? 'enter the email associated with your flex membership.'
                  : mode === 'checkin'
                    ? 'enter the email you used when you purchased your pass.'
                    : "we'll check if you've visited before."}
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
              className={BUTTON_PRIMARY}
            >
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> looking up…</>
                : 'continue'
              }
            </button>
          </form>
        )}

        {/* ── Step: returning-confirm ─────────────────────────────────────── */}
        {step === 'returning-confirm' && (
          <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
            <div>
              <p className="text-sm font-semibold text-white">welcome back</p>
              <p className="text-xs text-neutral-500 mt-1">{lookupEmail}</p>
            </div>

            {/* Name */}
            <Field label="full name" required>
              <input
                type="text"
                placeholder="jane smith"
                value={returningName}
                onChange={e => setReturningName(e.target.value)}
                className={INPUT}
              />
            </Field>

            {/* Plan selector */}
            <Field label="pass type" required>
              <PlanSelector
                plans={plans}
                value={selectedPriceId}
                onChange={setSelectedPriceId}
              />
              {studentPassBlockedByDay && (
                <p className="text-xs text-rose-400 mt-1">student pass is only available on weekends.</p>
              )}
            </Field>

            {requiresStudentId && (
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
            )}

            <Field label="promo code (optional)">
              <input
                type="text" autoComplete="off" autoCapitalize="characters"
                value={promotionCode} onChange={e => setPromotionCode(e.target.value)}
                className={INPUT}
              />
            </Field>

            {accessNotice && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                {accessNotice}
              </p>
            )}

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleReturningCheckout}
              disabled={submitting || plans.length === 0 || (requiresStudentId && !studentIdFile) || studentPassBlockedByDay}
              className={BUTTON_PRIMARY}
            >
              {submitting
                ? <><Loader2 size={15} className="animate-spin" /> redirecting to checkout…</>
                : 'continue to payment →'
              }
            </button>

          </div>
        )}

        {/* ── Step: checkin-confirm ───────────────────────────────────────── */}
        {step === 'checkin-confirm' && lookupResult && (
          <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
            {/* Profile card */}
            <div className="bg-neutral-900 rounded-xl p-4 flex flex-col gap-1">
              <p className="text-sm font-semibold text-white">
                {lookupResult.profile?.name ?? lookupEmail}
              </p>
              <p className="text-xs text-neutral-500">{lookupEmail}</p>
            </div>

            {lookupResult.passesLeft > 0 ? (
              <>
                {waiverSignedNote && (
                  <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    waiver signed — tap check in to continue.
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {(lookupResult.packs ?? []).map((pack, i) => {
                    const LABEL = { SINGLE: 'day pass', THREE_PACK: '3-pack', FIVE_PACK: '5-pack', TEN_PACK: '10-pack', VALUE: 'value pack', DELUXE: 'deluxe pack' }
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
                  className={BUTTON_PRIMARY}
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
                  <p className="text-sm text-neutral-400">no active pass. buy one below.</p>
                </div>
                <button
                  onClick={() => {
                    clearError()
                    setMode('purchase')
                    setReturningName(lookupResult.profile?.name ?? '')
                    setStep('returning-confirm')
                  }}
                  className={BUTTON_PRIMARY}
                >
                  purchase a pass
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Step: waiver-sign (sign-only, no purchase) ──────────────────── */}
        {step === 'waiver-sign' && (
          <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-white">sign the waiver</p>
              <p className="text-xs text-neutral-500">we need a signed waiver on file before you check in. this doesn&apos;t buy anything.</p>
            </div>

            <SignatureField value={waiverSignature} onChange={setWaiverSignature}>
              sign with your full name (parent/guardian signs for minors) to agree to the{' '}
              <button
                type="button"
                onClick={() => setWaiverOpen(true)}
                className="text-white underline underline-offset-2 hover:text-neutral-200 transition-colors"
              >
                liability waiver & terms
              </button>
              .
            </SignatureField>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleSignWaiver}
              disabled={submitting || !waiverSignature.trim()}
              className={BUTTON_PRIMARY}
            >
              {submitting ? <><Loader2 size={15} className="animate-spin" /> saving…</> : 'sign and continue'}
            </button>
          </div>
        )}

        {/* ── Step: flex-confirm ──────────────────────────────────────────── */}
        {step === 'flex-confirm' && flexMember && (
          <div className="bg-[#1c1c1c] border border-white/10 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl">
            {/* Profile card */}
            <div className="bg-neutral-900 rounded-xl p-4 flex flex-col gap-1">
              <p className="text-sm font-semibold text-white">
                {flexMember.firstName} {flexMember.lastName}
              </p>
              <p className="text-xs text-neutral-500">{lookupEmail}</p>
            </div>

            {/* Check-in counter */}
            <div className="flex items-center justify-between bg-neutral-900 rounded-xl px-4 py-3">
              <span className="text-xs text-neutral-400">check-ins this month</span>
              <span className={`text-xs font-semibold ${flexResult?.checkInsRemaining === 0 ? 'text-red-400' : 'text-white'}`}>
                {flexResult?.checkInsUsed ?? 0} / 5 used
              </span>
            </div>

            {flexResult?.checkInsRemaining === 0 ? (
              <div className="text-center py-2">
                <p className="text-sm text-red-400">monthly limit reached.</p>
                <p className="text-xs text-neutral-600 mt-1">you've used all 5 check-ins for this month.</p>
              </div>
            ) : (
              <>
                {error && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}
                <button
                  onClick={handleFlexCheckin}
                  disabled={submitting}
                  className={BUTTON_PRIMARY}
                >
                  {submitting
                    ? <><Loader2 size={15} className="animate-spin" /> checking in…</>
                    : 'check in'
                  }
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Step: flex-done ─────────────────────────────────────────────── */}
        {step === 'flex-done' && (
          <div className="bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-8 flex flex-col items-center text-center gap-5 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
            {flexResult?.alreadyActive ? (
              <div>
                <h2 className="text-xl font-bold text-white">you're already checked in</h2>
                <p className="text-sm text-neutral-400 mt-2">
                  your code is still active. you can enter the gym.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <h2 className="text-xl font-bold text-white">checked in!</h2>
                  <p className="text-sm text-neutral-400 mt-1">
                    welcome{flexMember?.firstName ? `, ${flexMember.firstName.toLowerCase()}` : ''}.
                  </p>
                </div>
                {flexResult && (
                  <div className="w-full bg-neutral-900 rounded-xl p-4">
                    <p className="text-xs text-neutral-400">
                      <span className="text-white font-semibold">{flexResult.checkInsRemaining}</span>{' '}
                      flex check-in{flexResult.checkInsRemaining !== 1 ? 's' : ''} remaining this month
                    </p>
                  </div>
                )}
              </>
            )}
            <button
              onClick={() => { setStep('intent'); setMode(null); setLookupEmail(''); setFlexMember(null); setFlexResult(null); clearError() }}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              done
            </button>
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
            {/* The code is never shown here — it's emailed to the address on the profile */}
            <div className="w-full bg-neutral-900 rounded-xl p-4 space-y-3">
              <p className="text-sm text-neutral-300">
                your access code was emailed to{' '}
                <span className="text-white font-semibold">{checkinResult?.sentTo}</span>.
                check your inbox (and spam).
              </p>
              <button
                type="button"
                onClick={handleResendCode}
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
            {checkinResult?.passesLeft != null && (
              <div className="w-full bg-neutral-900 rounded-xl p-4">
                <p className="text-xs text-neutral-400">
                  <span className="text-white font-semibold">{checkinResult.passesLeft}</span>{' '}
                  pass{checkinResult.passesLeft !== 1 ? 'es' : ''} remaining after this visit
                </p>
              </div>
            )}
            <button
              onClick={() => { setStep('intent'); setMode(null); setLookupEmail(''); setLookupResult(null); setResendState(null); setResendError(null); clearError() }}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              done
            </button>
          </div>
        )}

      </div>

      <p className="text-center text-[11px] text-neutral-700 mt-6">© 2026 · powered by <a href="https://ironkeyentry.com" target="_blank" rel="noopener noreferrer" className="underline"><strong>ironkey llc</strong></a></p>

      {waiverOpen && (
        <WaiverModal
          sections={agreementSections(gymSlug, 'guest')}
          onClose={() => setWaiverOpen(false)}
        />
      )}
    </div>
  )
}
