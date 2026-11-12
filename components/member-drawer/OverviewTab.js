'use client'

import { useState, useEffect } from 'react'
import { X, Phone, KeyRound, History, User, ShieldAlert, UserCheck } from 'lucide-react'
import { formatPhone } from '@/lib/phone'
import { AgreementSection } from '@/components/AgreementSection'
import { DrawerSection, DrawerField } from '@/components/DrawerParts'
import MembershipTypeControl from '@/components/member-drawer/MembershipTypeControl'
import { EditableRow, ListState, EVENT_LABEL, fmtDate } from '@/components/member-drawer/fields'

// Price ID(s) for Hydra's bundled Student/Military/Police/EMT membership
// product (currently "student membership" — renamed from its original name,
// hence matching by ID rather than name so future renames can't break this).
const HYDRA_STUDENT_MILITARY_EMT_PRICE_IDS = new Set(['price_1TctZyAHpnGUkbkCdCs8HAL3'])

const SEMESTER_OPTIONS = [
  { value: '', label: '—' }, { value: 'Fall', label: 'fall' }, { value: 'Spring', label: 'spring' }, { value: 'Summer', label: 'summer' },
]
const CATEGORY_OPTIONS = [
  { value: '', label: '—' }, { value: 'Student', label: 'student' }, { value: 'Military', label: 'military' }, { value: 'EMT', label: 'emt' },
]

// Full-screen image preview — replaces opening the data: URL in a new tab,
// which Chrome blocks (renders a blank tab) for data: URIs.
function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,.85)' }}
      onClick={onClose}
    >
      <button onClick={onClose} aria-label="close" className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors">
        <X size={24} />
      </button>
      <img
        src={src}
        alt="student id"
        style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

/**
 * Overview: contact, personal info, emergency contact, guardian (minors),
 * membership (plan, student fields, trainer, agreement) and history.
 * `save(fields)` PATCHes the member; undefined → fields are read-only.
 */
export default function OverviewTab({ member, gymSlug, perms, save, onPlanChanged }) {
  const [events, setEvents] = useState(null)   // null = loading, [] = loaded empty
  const [lightbox, setLightbox] = useState(false)
  // Hydra: the student fields depend on the category picked in this session
  const [category, setCategory] = useState(member.studentCategory ?? '')
  useEffect(() => { setCategory(member.studentCategory ?? '') }, [member.id, member.studentCategory])

  useEffect(() => {
    if (!gymSlug || !member.id) return
    setEvents(null)
    fetch(`/api/${gymSlug}/members/${member.id}/events`, { headers: { Authorization: `Bearer ${localStorage.getItem('ik_token')}` } })
      .then(r => (r.ok ? r.json() : { events: [] }))
      .then(({ events }) => setEvents(events ?? []))
      .catch(() => setEvents([]))
  }, [member.id, gymSlug])

  // Student graduation tracking — gated by gym + membershipType.
  // Triumph/Oasis have a standalone "Student" plan; Hydra bundles
  // Student/Military/EMT into one plan and needs a category picker first.
  const typeLower = (member.membershipType || '').toLowerCase()
  const isStandaloneStudentPlan = (gymSlug === 'triumph-barbell' || gymSlug === 'oasis-boston') && typeLower.includes('student')
  const isHydraBundledPlan      = gymSlug === 'hydra-athletic-co' && HYDRA_STUDENT_MILITARY_EMT_PRICE_IDS.has(member.priceId)
  const isMinor = Boolean(member.isMinor || member.guardianName)
  const fullName = `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim()
  const lower = (a, b) => a.trim().toLowerCase() === b.toLowerCase()
  const field = key => (save ? v => save({ [key]: v }) : undefined)

  return (
    <>
      {/* Contact */}
      <DrawerSection icon={Phone} title="contact">
        <EditableRow
          label="name"
          value={fullName}
          onSave={save ? v => {
            const parts = v.split(/\s+/)
            return save({ firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') })
          } : undefined}
        />
        <EditableRow label="email" type="email" value={member.email} onSave={field('email')} compare={lower} />
        <EditableRow label="phone" type="tel" value={member.phone} onSave={field('phone')} onBlurFormat={formatPhone} />
      </DrawerSection>

      {/* Personal info */}
      <DrawerSection icon={User} title="personal info">
        <EditableRow label="date of birth" type="date" value={member.dateOfBirth} onSave={field('dateOfBirth')} />
        <EditableRow label="address" value={member.address} onSave={field('address')} placeholder="123 main st, boston, ma" width="w-44" />
        {/* How did you hear about us — read-only */}
        <DrawerField label="how did you hear about us?">
          <span className="text-xs text-white ml-4">{member.hearAboutUs || '—'}</span>
        </DrawerField>
      </DrawerSection>

      {/* Emergency contact */}
      <DrawerSection icon={ShieldAlert} title="emergency contact">
        <EditableRow label="name" value={member.emergencyContactName} onSave={field('emergencyContactName')} placeholder="jane smith" />
        <EditableRow label="phone" type="tel" value={member.emergencyContactPhone} onSave={field('emergencyContactPhone')} onBlurFormat={formatPhone} placeholder="(555) 000-0000" />
        <EditableRow label="relationship" value={member.emergencyContactRelationship} onSave={field('emergencyContactRelationship')} placeholder="spouse, parent, friend…" />
      </DrawerSection>

      {/* Guardian — minors only. The guardian is the account holder: they
          signed the waiver on the member's behalf and hold the payment
          method, so staff need this visible separately from the member's
          own (nonexistent, for a minor) contact info. */}
      {isMinor && (
        <DrawerSection icon={UserCheck} title="guardian">
          <EditableRow label="name" value={member.guardianName} onSave={field('guardianName')} placeholder="john smith" />
          <EditableRow label="email" type="email" value={member.guardianEmail} onSave={field('guardianEmail')} compare={lower} />
          <EditableRow label="phone" type="tel" value={member.guardianPhone} onSave={field('guardianPhone')} onBlurFormat={formatPhone} />
          <EditableRow label="relationship" value={member.guardianRelationship} onSave={field('guardianRelationship')} placeholder="parent, legal guardian, etc." />
        </DrawerSection>
      )}

      {/* Membership */}
      <DrawerSection icon={KeyRound} title="membership">
        <MembershipTypeControl member={member} gymSlug={gymSlug} allowed={perms.has('billing.act')} onPlanChanged={onPlanChanged} onSaveType={field('membershipType')} />

        {/* Hydra's bundled Student/Military/EMT plan — category picker first */}
        {isHydraBundledPlan && (
          <EditableRow label="category" value={member.studentCategory} options={CATEGORY_OPTIONS} onInput={setCategory} onSave={field('studentCategory')} />
        )}

        {/* Graduation tracking — standalone student plans (Triumph/Oasis), or
            Hydra's bundled plan once "Student" is picked as the category */}
        {(isStandaloneStudentPlan || (isHydraBundledPlan && category === 'Student')) && (
          <>
            <EditableRow label="graduating semester" value={member.gradSemester} options={SEMESTER_OPTIONS} onSave={field('gradSemester')} />
            <EditableRow
              label="graduating year"
              type="number"
              width="w-20"
              mono
              placeholder="——"
              value={member.gradYear != null ? String(member.gradYear) : ''}
              toPayload={v => (v === '' ? null : parseInt(v, 10))}
              onSave={field('gradYear')}
              inputProps={{
                min: new Date().getFullYear(),
                max: new Date().getFullYear() + 6,
                className: 'bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-20 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              }}
            />
          </>
        )}

        {/* Student ID photo — only present once a student plan buyer has
            actually uploaded one; nothing renders otherwise. */}
        {member.studentIdImage && (
          <DrawerField label="student id">
            <button type="button" onClick={() => setLightbox(true)} className="ml-4">
              <img
                src={member.studentIdImage}
                alt="student id"
                className="w-10 h-10 rounded object-cover border border-neutral-700 hover:border-neutral-500 transition-colors"
              />
            </button>
          </DrawerField>
        )}
        {lightbox && <ImageLightbox src={member.studentIdImage} onClose={() => setLightbox(false)} />}

        {member.loadedFull && (
          <DrawerField label="trainer" value={member.assignedTrainer?.name ?? 'none assigned'} />
        )}

        {/* Signed membership agreement — a typed signature, or a
            checkbox-era acceptance backfilled from Stripe + git history */}
        {member.loadedFull && (
          <div className="px-3 py-3 bg-[#1c1c1c]">
            <AgreementSection
              onFile={Boolean(member.agreementSignatureName) || member.agreementSource === 'checkbox_backfill'}
              gymName={member.gymName ?? null}
              personName={fullName}
              signatureName={member.agreementSignatureName ?? null}
              signedAt={member.agreementSignedAt ?? null}
              signedByGuardian={Boolean(member.isMinor)}
              text={member.agreementText ?? null}
              version={member.agreementVersion ?? null}
              source={member.agreementSource ?? null}
            />
          </div>
        )}
      </DrawerSection>

      {/* Membership history */}
      <DrawerSection icon={History} title="history">
        <ListState rows={events} empty="no history recorded">
          {events?.map(ev => (
            <div key={ev.id} className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-white">{EVENT_LABEL[ev.type] ?? ev.type}</span>
              <span className="text-xs text-neutral-500 ml-4 shrink-0">{fmtDate(ev.date)}</span>
            </div>
          ))}
        </ListState>
      </DrawerSection>
    </>
  )
}
