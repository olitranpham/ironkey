'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import PublicPageHeader from '@/components/PublicPageHeader'
import { Field, SectionDivider, INPUT, SELECT, BUTTON_PRIMARY } from '@/components/PublicPageStyles'
function maskPhone(value) {
  const d = value.replace(/\D/g, '').slice(0, 10)
  if (d.length < 4) return d.length ? `(${d}` : ''
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

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

const HYDRA_WAIVER_SECTIONS = [
  {
    title: 'Express Assumption of Risk',
    body: 'I, the undersigned, am aware that there are significant risks involved in any physical training regimen. These risks include, but are not limited to: falls which can result in serious injury or death, injury or death due to negligence on the part of me, my training partner, or other people around me, injury or death due to improper use or failure of equipment. Injury may also result simply from the fact of physical training itself. By its very nature, physical training seeks to have me push beyond my limits in order to produce a physical adaptation by my body. This requires feedback from me to my trainer regarding what is happening with my body. Excessive work can result (in rare cases) in exertional rhabdomyolysis. I should look for signs of excessive soreness, darkened urine, and pain in the kidney areas in the days following a particularly intense workout. While this type of injury is relatively rare, it can occur due to a number of factors, including (but not limited to) genetic predisposition or dehydration that may be beyond the control of my trainer. I am aware that any of these above mentioned risks might result in serious injury or death to me and or my partner(s). I willingly assume full responsibility for the risks that I am exposing myself to and accept full responsibility for any injury or death that may result from participation in any activity or class while training. I, the undersigned acknowledge that I have no physical impairments or illnesses that I know of that will endanger others or myself.',
  },
  {
    title: 'Release',
    body: 'In consideration of the above mentioned risks and hazards and in consideration of the fact that I am willingly and voluntarily participating in the activities available at Hydra Athletic Co. in-person or online, I, the undersigned hereby release Hydra Athletic Co., their principals, agents, employees, and volunteers from any and all liability, claims, demands, actions or rights of action, which are related to, arise out of, or are in any way connected with my participation in this activity, including those allegedly attributed to the negligent acts or omissions of the above mentioned parties.\n\nThis agreement shall be binding upon successors, my representatives, heirs, executors, assigns, transferees, or me. If any portion of this agreement is held invalid, I agree that the remainder of the agreement shall remain in full legal force and effect.',
  },
  {
    title: 'Equipment Use, Safety Waiver, and Member Negligence Release',
    body: 'I expressly acknowledge that the use of strength training equipment, free weights, machines, squat racks, platforms, cables, resistance systems, specialty bars, attachments, and all other fitness equipment at Hydra Athletic Co. involves inherent and substantial risks of serious bodily injury, permanent disability, paralysis, or death. These risks exist regardless of the presence of staff, posted instructions, or safety features.\n\nI acknowledge that safety mechanisms may be available on certain equipment, including but not limited to safety arms, spotter arms, rack pins, safety bars, collars, clips, catches, and other protective devices. I understand and agree that it is solely my responsibility to properly set up, inspect, and utilize all safety mechanisms before engaging in any lift or activity.\n\nI expressly agree that failure to properly use available safety mechanisms, improper loading of equipment, lifting beyond my physical capacity, failure to secure weights or collars, failure to use a spotter when reasonably necessary, misuse of equipment, distraction, impairment, fatigue, reckless conduct, or failure to follow staff instruction constitutes my own negligence and assumption of risk.\n\nSpotter Acknowledgment. I acknowledge that Hydra Athletic Co. does not provide spotters unless expressly agreed to by an authorized employee or coach. It is solely my responsibility to determine whether a spotter is necessary for any exercise I choose to perform. If I elect to perform any lift without a spotter, I voluntarily assume all risks associated with that decision, including the risk of serious bodily injury, permanent disability, or death.\n\nTo the fullest extent permitted by law, I hereby RELEASE, WAIVE, DISCHARGE, AND COVENANT NOT TO SUE Hydra Athletic Co. and its owners, officers, employees, agents, and affiliates from any and all claims, liabilities, demands, causes of action, damages, costs, or expenses arising out of or related to misuse of equipment, failure to use safety mechanisms, or my own negligent conduct.',
  },
  {
    title: 'Photo and Video Release',
    body: 'I hereby grant Hydra Athletic Co. permission to use my photograph/video image in any and all publications for Hydra Athletic Co., including website entries, without payment or any other consideration in perpetuity. I hereby authorize Hydra Athletic Co. to edit, alter, copy, exhibit, publish or distribute all photos and images. I waive the right to inspect or approve the finished product. Additionally, I waive any right to royalties or other compensation arising or related to the use of the photograph or video images.',
  },
  {
    title: 'Gym Membership Payment Terms',
    body: 'I understand that membership commences on the date of sign up and the membership fee will be charged every four (4) weeks from my initial sign up unless otherwise noted. All memberships paid every four (4) weeks are non-refundable in part or full after auto-draft has gone through under any circumstances. All memberships are subject to Hydra Athletic Co. annual maintenance fee of $29.99 on January 30th each year. Memberships paid upfront are not refundable under any circumstances. All memberships will renew automatically regardless of if it\'s a weekly, monthly, or annual membership.\n\nFor cancellations, holds, and/or changes to memberships for any reason, member must notify Hydra Athletic Co. via email or in person through management at least 30 days prior to the next auto-draft. If you are cancelling a 12 month contract agreement, fees may apply: $150 before your 6 month mark and $95 after your 6 month mark.\n\nMembership upgrades to a higher price will not be subject to any fees. Membership downgrades to a lower price will be subject to all new expiration and cancellation dates, terms & fees applying, including registration and early cancellation fees. Membership rates are subject to change.',
  },
  {
    title: 'Day Pass Policy',
    body: 'Day passes grant access to Hydra Athletic Co. for a 24-hour period. A guest pass may only be used and assigned to a single individual. Any misuse of Day Pass policies may result in extra fees or banning from the premises. Please note that day passes provide access to the main gym floor only and do not include use of the recovery lounge or any recovery room amenities.',
  },
  {
    title: 'Facility Access and Anti-Tailgating Policy',
    body: 'Access credentials, key fobs, mobile credentials, door codes, or any other method of entry issued by Hydra Athletic Co. are assigned exclusively to the individual Member and may not be shared, loaned, transferred, duplicated, or used to admit any other person into the facility. Members shall not permit any individual to enter the facility by following them through a secured entrance ("tailgating" or "piggybacking") unless that individual has independently obtained authorized access or has been properly checked in as a guest. Any violation of this policy may result in immediate suspension or termination of membership, revocation of 24-hour access privileges, and assessment of applicable fees or damages.',
  },
  {
    title: 'Personal Belongings Policy',
    body: 'Hydra Athletic Co. is not responsible for any lost, stolen, or misplaced personal items within the facility, including but not limited to items left on the gym floor, in locker rooms, or in common areas. Members and visitors are strongly encouraged to secure all personal belongings in a locker and use a personal lock at all times while in the facility. Any items left unattended are done so at the individual\'s own risk. Hydra Athletic Co. assumes no liability for the loss, theft, or damage of personal property under any circumstances.',
  },
  {
    title: 'Minor Membership Policy',
    body: 'Members under the age of eighteen (18) may participate in Hydra Athletic Co. programs only with the written consent of a parent or legal guardian. The parent or legal guardian represents that they have the legal authority to execute this Agreement on behalf of the minor and agrees to all terms, conditions, waivers, releases, and obligations contained herein, both individually and on behalf of the minor participant.',
  },
  {
    title: 'Cancellation Policy for Online Coaching and Personal Training Services',
    body: 'All coaching plans continue month-to-month indefinitely until you submit a written cancellation request. If a Personal Training Package is purchased, it cannot be refunded. Client no-shows can result in an extra charge determined by the Personal Trainer. Clients may cancel their coaching or training plan at any time after the package period has been fulfilled.\n\nClient acknowledges that assignment to a specific personal trainer/coach is not guaranteed for the duration of this Agreement. If the assigned trainer/coach becomes unavailable for any reason, Hydra may reassign Client to another qualified trainer/coach at the same rate. Such reassignment shall not constitute a breach of this Agreement and does not entitle Client to a refund, credit, or cancellation.\n\nSession Cancellation Policy: Clients must provide at least 12 hours\' notice to cancel or reschedule a coaching session. Failure to do so will result in the session being counted as used and charged accordingly.',
  },
  {
    title: 'Gym Policy',
    body: 'Hydra Athletic Co. is committed to providing a safe environment for all its employees free from discrimination on any ground and from harassment at work including sexual harassment. Hydra Athletic Co. will operate a zero tolerance policy for any form of sexual harassment in the workplace. Any person found to have sexually harassed another will face disciplinary action, up to and including dismissal from employment or termination of membership.\n\nHydra Athletic Co. has a zero tolerance policy on being disrespectful to the gym itself, other members, or staff. Violation of this policy can result in membership termination, damage fine, and refusal of service. Hydra Athletic Co. has the right to terminate any membership at any point in time if deemed necessary by management/ownership.',
  },
  {
    title: 'Marketing Consent Policy',
    body: 'By signing below, you explicitly consent to receive marketing communications from Hydra Athletic Co. via email and SMS. These communications may include promotional offers and discounts, product updates and announcements, newsletters, and special events.\n\nYou may unsubscribe from marketing emails at any time by clicking the "unsubscribe" link in any email. To opt out of SMS messages, reply with "STOP" to any message you receive.',
  },
  {
    title: 'Waiver of Liability and Hold Harmless Agreement',
    body: 'In consideration for receiving permission (24/7 access) to be on premises at Hydra Athletic Co., I hereby acknowledge and agree to indemnify, defend and hold harmless Hydra Athletic Co. and all related parties from and against any and all claims, demands, suits, judgments, losses or expenses of any nature whatsoever (including attorneys\' fees), arising from or out of, or relating to, directly or indirectly, the infection of COVID-19 or any other illness or injury.\n\nIN SIGNING THIS AGREEMENT, I ACKNOWLEDGE AND REPRESENT THAT I have read the foregoing Waiver of Liability and Hold Harmless Agreement, understand it and sign it voluntarily as my own free act and deed. I am at least eighteen (18) years of age and fully competent, and I execute this Agreement for full, adequate and complete consideration fully intending to be bound by same.\n\nThis waiver & agreement applies for Hydra Athletic Co. in-person and online coaching services including training and nutrition.',
  },
  {
    title: 'Pre-Sale Membership Addendum',
    body: 'By enrolling in the Hydra Athletic Co. Pre-Sale Membership, the Member acknowledges and agrees that the promotional membership rate of Fifty Dollars ($50.00) every four (4) weeks is offered exclusively in exchange for a minimum commitment of twelve (12) consecutive months from the Member\'s enrollment date.\n\nThe promotional membership rate shall remain fixed for the initial twelve (12) month commitment period, provided the Member remains in good standing. Any cancellation prior to the expiration of the initial commitment period shall be subject to the applicable early termination provisions.\n\nUpon completion of the initial twelve (12) month commitment period, the membership shall automatically continue on a recurring four (4) week billing cycle at Hydra Athletic Co.\'s then-current membership rate unless cancelled in accordance with the Membership Agreement.',
  },
]

const WAIVER_BY_GYM = {
  'oasis-boston':      OASIS_WAIVER_SECTIONS,
  'triumph-barbell':   TRIUMPH_WAIVER_SECTIONS,
  'hydra-athletic-co': HYDRA_WAIVER_SECTIONS,
}

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


export default function JoinPage() {
  const { gymSlug } = useParams()
  const router = useRouter()

  const [gymName,          setGymName]          = useState('')
  const [gymLogo,          setGymLogo]          = useState(null)
  const [membershipPlans,   setMembershipPlans]   = useState([])
  const [addonPlans,        setAddonPlans]        = useState([])
  const [ptPlans,           setPtPlans]           = useState([])
  const [programmingPlans,  setProgrammingPlans]  = useState([])
  const [groupTrainingPlans, setGroupTrainingPlans] = useState([])
  const [loading,          setLoading]          = useState(true)
  const [submitting,       setSubmitting]       = useState(false)
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
    addonPriceId:          '',
    groupTrainingPriceId:  '',
    waiver:                false,
  })

  const isTriumph  = gymSlug === 'triumph-barbell'
  const isHydra    = gymSlug === 'hydra-athletic-co'
  const isStudent  = form.membershipType.toLowerCase().includes('student')
  const age        = form.dob ? calculateAge(form.dob) : null
  const isMinor    = age !== null && age < 18
  useEffect(() => {
    fetch(`/api/${gymSlug}/join`)
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
          let defaultPlan
          if (gymSlug === 'hydra-athletic-co') {
            defaultPlan = membershipPlans.find(p => p.name.toLowerCase().includes('standard membership')) ?? membershipPlans[0]
          } else if (gymSlug === 'triumph-barbell') {
            defaultPlan = membershipPlans.find(p => p.name.toLowerCase().includes('general')) ?? membershipPlans[0]
          } else {
            defaultPlan = membershipPlans.find(p => p.name.toLowerCase().includes('general')) ?? membershipPlans[0]
          }
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
    const plan = [...membershipPlans, ...ptPlans, ...programmingPlans].find(p => p.priceId === priceId)
    setForm(f => ({ ...f, priceId, membershipType: plan?.membershipType ?? '' }))
    // Clear student fields if switching away from a student plan
    if (!plan?.membershipType?.toLowerCase().includes('student')) {
      setStudentIdFile(null)
      setGradSemester('')
      setGradYear('')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError(isMinor ? "The member's first and last name are required." : 'First and last name are required.')
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
    if (!form.address1.trim()) { setError('Address is required.'); return }
    if (!form.city.trim())     { setError('City is required.'); return }
    if (!form.state.trim())    { setError('State is required.'); return }
    if (!form.zip.trim())      { setError('Zip code is required.'); return }
    // A selected group training tier bypasses the membership dropdown entirely —
    // the training price is billed on its own, so priceId isn't required there.
    const isGroupTrainingSelected = gymSlug === 'oasis-boston'
      && groupTrainingPlans.some(p => p.priceId === form.groupTrainingPriceId)
    if (!form.priceId && !isGroupTrainingSelected) { setError('Please select a membership type.'); return }
    if (!form.emergencyName.trim() || !form.emergencyPhone.trim()) { setError(isMinor ? "Guardian's emergency contact name and phone are required." : 'Emergency contact name and phone are required.'); return }
    if (!form.emergencyRelationship.trim()) { setError('Emergency contact relationship is required.'); return }
    if (!form.waiver)          { setError('You must agree to the membership terms.'); return }
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
                      setForm(f => ({ ...f, priceId: '', membershipType: '' }))
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
                      setForm(f => ({ ...f, priceId: '', membershipType: '' }))
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
                      setForm(f => ({ ...f, priceId: '', membershipType: '' }))
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
            {isMinor ? (
              <>
                I, {form.guardianFirstName.trim() || 'the undersigned'} {form.guardianLastName.trim()}, as parent/legal guardian of {form.firstName.trim() || 'the member'} {form.lastName.trim()}, agree to the{' '}
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); setWaiverOpen(true) }}
                  className="text-white underline underline-offset-2 hover:text-neutral-200 transition-colors"
                >
                  membership terms and release of liability
                </button>
                {' '}on their behalf.
              </>
            ) : (
              <>
                I agree to the{' '}
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); setWaiverOpen(true) }}
                  className="text-white underline underline-offset-2 hover:text-neutral-200 transition-colors"
                >
                  membership terms and release of liability
                </button>
              </>
            )}
          </span>
        </label>

        {error && (
          <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3.5 py-3">
            <span className="text-rose-400 mt-px shrink-0">⚠</span>
            <p className="text-xs text-rose-400 leading-relaxed">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || membershipPlans.length === 0 || (isMinor
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
          sections={WAIVER_BY_GYM[gymSlug] ?? TRIUMPH_WAIVER_SECTIONS}
          onClose={() => setWaiverOpen(false)}
        />
      )}
    </div>
  )
}
