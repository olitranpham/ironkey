'use client'

import { useState, useEffect } from 'react'
import { X, KeyRound, Phone, User, ShieldAlert } from 'lucide-react'
import { formatPhone } from '@/lib/phone'

// ── Shared constants ──────────────────────────────────────────────────────────

export const PASS_TYPE_LABEL = {
  SINGLE:     'single',
  THREE_PACK: '3-pack',
  FIVE_PACK:  '5-pack',
  TEN_PACK:   '10-pack',
  VALUE:      'value',
  DELUXE:     'deluxe',
}

const PASS_TYPE_INITIAL = {
  SINGLE:     1,
  VALUE:      1,
  DELUXE:     1,
  THREE_PACK: 3,
  FIVE_PACK:  5,
  TEN_PACK:   10,
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
}

export function totalVisits(guest) {
  return (guest.passes ?? []).reduce((sum, p) => {
    const initial = PASS_TYPE_INITIAL[p.passType] ?? 1
    if (initial === 1) return sum + 1
    const used = p.passesLeft != null ? initial - p.passesLeft : initial
    return sum + used
  }, 0)
}

// ── GSection ──────────────────────────────────────────────────────────────────

export function GSection({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={11} className="text-neutral-500" />
        <p className="text-[11px] font-semibold tracking-widest text-neutral-500">{title.toUpperCase()}</p>
      </div>
      <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

// ── GuestProfilePanel ─────────────────────────────────────────────────────────

export function GuestProfilePanel({ profile, passTypeBorder, onClose, onSaveCode, saving, onSavePassesLeft, onSaveProfile, source }) {
  const [codeInput,    setCodeInput]    = useState(profile.accessCode ?? '')
  const [passEdits,    setPassEdits]    = useState({})
  const [savingPassId, setSavingPassId] = useState(null)

  // Contact
  const [nameInput,  setNameInput]  = useState(profile.name  ?? '')
  const [emailInput, setEmailInput] = useState(profile.email ?? '')
  const [phoneInput, setPhoneInput] = useState(profile.phone ?? '')

  // Personal info
  const [dobInput,  setDobInput]  = useState(profile.dateOfBirth ?? '')
  const [addrInput, setAddrInput] = useState(profile.address     ?? '')

  // Emergency contact
  const [ecNameInput,  setEcNameInput]  = useState(profile.emergencyContactName         ?? '')
  const [ecPhoneInput, setEcPhoneInput] = useState(profile.emergencyContactPhone        ?? '')
  const [ecRelInput,   setEcRelInput]   = useState(profile.emergencyContactRelationship ?? '')

  const visits     = totalVisits(profile)
  const isUnlinked = profile._unlinked === true
  const nameParts  = profile.name.trim().split(/\s+/)
  const initials   = (nameParts[0]?.[0] ?? '') + (nameParts[1]?.[0] ?? '')

  useEffect(() => {
    setCodeInput(profile.accessCode ?? '')
    setPassEdits({})
    setNameInput(profile.name  ?? '')
    setEmailInput(profile.email ?? '')
    setPhoneInput(profile.phone ?? '')
    setDobInput(profile.dateOfBirth ?? '')
    setAddrInput(profile.address    ?? '')
    setEcNameInput(profile.emergencyContactName         ?? '')
    setEcPhoneInput(profile.emergencyContactPhone       ?? '')
    setEcRelInput(profile.emergencyContactRelationship  ?? '')
  }, [profile.id])

  function handleSaveCode() {
    onSaveCode(profile.id, codeInput.trim())
  }

  async function handleSavePassesLeft(passId, value) {
    setSavingPassId(passId)
    try {
      await onSavePassesLeft(passId, value)
      setPassEdits(prev => { const n = { ...prev }; delete n[passId]; return n })
    } catch {
      // non-fatal
    } finally {
      setSavingPassId(null)
    }
  }

  const GEditField = ({ label, value, setValue, onSave, saved, type = 'text', onBlur, placeholder }) => (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-zinc-400 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 ml-4 flex-1 justify-end">
        <input
          type={type}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={onBlur}
          disabled={isUnlinked}
          placeholder={placeholder}
          className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-36 disabled:opacity-40"
        />
        {!isUnlinked && (
          <button
            onClick={onSave}
            disabled={value === saved}
            className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            save
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
        <p className="text-sm font-semibold text-white">guest profile</p>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* Avatar + name + stats */}
        <div className="flex flex-col items-center text-center gap-2 pt-1 pb-2">
          <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-black font-bold text-lg tracking-tight select-none">
              {initials.toUpperCase() || '?'}
            </span>
          </div>
          <p className="text-white font-semibold text-base leading-tight">{profile.name}</p>
          <div className="flex items-center gap-2.5 text-xs text-neutral-500">
            <span><span className="text-white font-semibold">{visits}</span> visits</span>
            <span className="text-neutral-700">·</span>
            <span><span className="text-white font-semibold">{(profile.passes ?? []).length}</span> passes</span>
          </div>
        </div>

        {/* Contact */}
        <GSection icon={Phone} title="contact">
          <GEditField
            label="name"
            value={nameInput}
            setValue={setNameInput}
            saved={profile.name ?? ''}
            onSave={() => onSaveProfile({ name: nameInput.trim() })}
          />
          <GEditField
            label="email"
            value={emailInput}
            setValue={setEmailInput}
            saved={profile.email ?? ''}
            onSave={() => onSaveProfile({ email: emailInput.trim() })}
          />
          {source !== 'partner' && (
            <GEditField
              label="phone"
              value={phoneInput}
              setValue={setPhoneInput}
              saved={profile.phone ?? ''}
              onSave={() => onSaveProfile({ phone: phoneInput })}
              onBlur={() => setPhoneInput(v => formatPhone(v) ?? v)}
              placeholder="(555) 000-0000"
            />
          )}
        </GSection>

        {/* Personal info — hidden for partner check-in source */}
        {source !== 'partner' && (
          <GSection icon={User} title="personal info">
            <GEditField
              label="date of birth"
              value={dobInput}
              setValue={setDobInput}
              saved={profile.dateOfBirth ?? ''}
              onSave={() => onSaveProfile({ dateOfBirth: dobInput.trim() })}
              type="date"
            />
            <GEditField
              label="address"
              value={addrInput}
              setValue={setAddrInput}
              saved={profile.address ?? ''}
              onSave={() => onSaveProfile({ address: addrInput.trim() })}
              placeholder="123 main st, boston, ma"
            />
          </GSection>
        )}

        {/* Emergency contact — hidden for partner check-in source */}
        {source !== 'partner' && (
          <GSection icon={ShieldAlert} title="emergency contact">
            <GEditField
              label="name"
              value={ecNameInput}
              setValue={setEcNameInput}
              saved={profile.emergencyContactName ?? ''}
              onSave={() => onSaveProfile({ emergencyContactName: ecNameInput.trim() })}
              placeholder="jane smith"
            />
            <GEditField
              label="phone"
              value={ecPhoneInput}
              setValue={setEcPhoneInput}
              saved={profile.emergencyContactPhone ?? ''}
              onSave={() => onSaveProfile({ emergencyContactPhone: ecPhoneInput })}
              onBlur={() => setEcPhoneInput(v => formatPhone(v) ?? v)}
              placeholder="(555) 000-0000"
            />
            <GEditField
              label="relationship"
              value={ecRelInput}
              setValue={setEcRelInput}
              saved={profile.emergencyContactRelationship ?? ''}
              onSave={() => onSaveProfile({ emergencyContactRelationship: ecRelInput.trim() })}
              placeholder="spouse, parent, friend…"
            />
          </GSection>
        )}

        {/* Access code */}
        <GSection icon={KeyRound} title="access code">
          <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
            <span className="text-xs text-zinc-400 shrink-0">pin</span>
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={isUnlinked ? 'no profile linked' : '——'}
                disabled={isUnlinked}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-20 font-mono disabled:opacity-40"
              />
              {!isUnlinked && (
                <>
                  <button
                    type="button"
                    onClick={() => setCodeInput(String(Math.floor(1000 + Math.random() * 9000)))}
                    className="text-[10px] px-2 py-1 rounded bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  >
                    gen
                  </button>
                  <button
                    onClick={handleSaveCode}
                    disabled={saving || codeInput.trim() === (profile.accessCode ?? '')}
                    className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {saving ? '…' : 'save'}
                  </button>
                </>
              )}
            </div>
          </div>
        </GSection>

        {/* Pass history — hidden for partner check-in source */}
        {source !== 'partner' && <div>
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-[11px] font-semibold tracking-widest text-neutral-500">PASS HISTORY</p>
          </div>
          <div className="rounded-lg border border-neutral-800 overflow-hidden">
            {(profile.passes ?? []).length === 0 ? (
              <p className="px-3 py-3 text-xs text-neutral-600">no passes yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left bg-[#1c1c1c]">
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-500 tracking-wider">type</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-500 tracking-wider">left</th>
                    <th className="px-3 py-2 text-[10px] font-semibold text-neutral-500 tracking-wider">purchased</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {(profile.passes ?? []).map(p => (
                    <tr key={p.id} className="bg-[#1c1c1c]">
                      <td className="px-3 py-2.5">
                        <span className={`inline-block text-[10px] font-medium border-l-2 pl-1.5 ${passTypeBorder?.[p.passType] ?? 'border-zinc-400 text-zinc-300'}`}>
                          {PASS_TYPE_LABEL[p.passType]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-neutral-400 tabular-nums">
                        {p.passesLeft === null || p.passesLeft === undefined ? '—' : (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              value={passEdits[p.id] ?? p.passesLeft}
                              onChange={e => {
                                const v = parseInt(e.target.value, 10)
                                if (!isNaN(v) && v >= 0) {
                                  setPassEdits(prev => ({ ...prev, [p.id]: v }))
                                }
                              }}
                              className="w-10 bg-[#252525] border border-neutral-700 rounded px-1.5 py-0.5 text-xs text-white text-center font-mono focus:outline-none focus:border-neutral-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            {passEdits[p.id] !== undefined && passEdits[p.id] !== p.passesLeft && (
                              <button
                                onClick={() => handleSavePassesLeft(p.id, passEdits[p.id])}
                                disabled={savingPassId === p.id}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 transition-colors shrink-0"
                              >
                                {savingPassId === p.id ? '…' : 'save'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-500 whitespace-nowrap">{fmtDate(p.usedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>}

      </div>
    </div>
  )
}
