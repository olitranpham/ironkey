'use client'

import { useState } from 'react'
import { X, Phone, KeyRound, CreditCard } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TEXT = {
  ACTIVE:    'text-emerald-600',
  FROZEN:    'text-blue-400/70',
  CANCELLED: 'text-zinc-500',
  OVERDUE:   'text-red-400/70',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtStatus(status) {
  return status === 'CANCELLED' ? 'canceled' : (status?.toLowerCase() ?? '—')
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PanelSection({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={11} className="text-neutral-600" />
        <p className="text-[11px] font-semibold tracking-widest text-neutral-600">{title}</p>
      </div>
      <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function PanelField({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-neutral-500 shrink-0">{label}</span>
      <span className={`text-xs text-white text-right ml-4 truncate max-w-[200px] ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '—'}
      </span>
    </div>
  )
}

// ── Drawer content ────────────────────────────────────────────────────────────

function DrawerContent({ member, membershipBorder, onClose, onStatusChange, onSaveAccessCode, updating }) {
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '')
  const [codeInput,  setCodeInput]  = useState(member.accessCode ?? '')
  const [savingCode, setSavingCode] = useState(false)

  async function handleCodeSave() {
    if (!onSaveAccessCode) return
    setSavingCode(true)
    await onSaveAccessCode(member.id, codeInput.trim())
    setSavingCode(false)
  }

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-neutral-800">
        <p className="text-sm font-semibold text-white">member profile</p>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Avatar + name + badges */}
        <div className="flex flex-col items-center text-center gap-3 pt-1 pb-2">
          <div className="w-[60px] h-[60px] rounded-full bg-white flex items-center justify-center shrink-0">
            <span className="text-black font-bold text-lg tracking-tight select-none">
              {initials || '?'}
            </span>
          </div>
          <div>
            <p className="text-white font-semibold text-base leading-tight">
              {member.firstName} {member.lastName}
            </p>
            <p className="text-neutral-500 text-xs mt-0.5">member</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[11px] font-medium ${STATUS_TEXT[member.status] ?? 'text-zinc-500'}`}>
              {fmtStatus(member.status)}
            </span>
            <span className={`text-[11px] font-medium border-l-2 pl-2 ${membershipBorder[member.membershipType] ?? membershipBorder.GENERAL}`}>
              {(member.membershipType ?? 'GENERAL').toLowerCase()}
            </span>
          </div>
        </div>

        {/* Contact */}
        <PanelSection icon={Phone} title="CONTACT">
          <PanelField label="email" value={member.email} />
          <PanelField label="phone" value={member.phone} />
        </PanelSection>

        {/* Membership */}
        <PanelSection icon={KeyRound} title="MEMBERSHIP">
          <PanelField label="type" value={(member.membershipType ?? 'GENERAL').toLowerCase()} />

          {/* Access code — inline editor */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
            <span className="text-xs text-neutral-500 shrink-0">access code</span>
            <div className="flex items-center gap-2 ml-4">
              <input
                type="text"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="——"
                maxLength={6}
                className="bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white text-right placeholder-neutral-600 focus:outline-none focus:border-neutral-500 w-20 font-mono"
              />
              <button
                onClick={() => setCodeInput(String(Math.floor(1000 + Math.random() * 9000)))}
                className="text-[10px] px-2 py-1 rounded bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                gen
              </button>
              {onSaveAccessCode && (
                <button
                  onClick={handleCodeSave}
                  disabled={savingCode || codeInput.trim() === (member.accessCode ?? '')}
                  className="text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {savingCode ? '…' : 'save'}
                </button>
              )}
            </div>
          </div>

          <PanelField label="joined" value={fmtDate(member.createdAt)} />
          {member.status === 'FROZEN'    && <PanelField label="frozen"   value={fmtDate(member.dateFrozen)} />}
          {member.status === 'CANCELLED' && <PanelField label="canceled" value={fmtDate(member.dateCanceled)} />}
        </PanelSection>

        {/* Stripe */}
        {(member.stripeCustomerId || member.stripeSubscriptionId) && (
          <PanelSection icon={CreditCard} title="STRIPE">
            <PanelField label="customer id"     value={member.stripeCustomerId}     mono />
            <PanelField label="subscription id" value={member.stripeSubscriptionId} mono />
          </PanelSection>
        )}

      </div>

      {/* Action buttons */}
      {member.status !== 'CANCELLED' && onStatusChange && (
        <div className="shrink-0 px-5 py-4 border-t border-neutral-800 space-y-2">
          {(member.status === 'ACTIVE' || member.status === 'OVERDUE') && (
            <>
              <button
                onClick={() => onStatusChange(member.id, 'FROZEN')}
                disabled={updating}
                className="w-full py-2 rounded-lg text-sm font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 transition-colors"
              >
                freeze membership
              </button>
              <button
                onClick={() => onStatusChange(member.id, 'CANCELLED')}
                disabled={updating}
                className="w-full py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                cancel membership
              </button>
            </>
          )}
          {member.status === 'FROZEN' && (
            <button
              onClick={() => onStatusChange(member.id, 'ACTIVE')}
              disabled={updating}
              className="w-full py-2 rounded-lg text-sm font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 transition-colors"
            >
              resume membership
            </button>
          )}
        </div>
      )}

    </div>
  )
}

// ── Main export — includes overlay + sliding panel shell ──────────────────────

/**
 * MemberProfileDrawer
 *
 * Renders a full-screen overlay + right-side sliding panel with member info.
 * Width is 480px on sm+ screens (≈ 25% wider than the old 380px panels).
 *
 * Props:
 *   member           – member object (stays populated during close animation)
 *   open             – boolean driving the slide/fade animation
 *   membershipBorder – from getGymTheme(gymSlug).membershipBorder
 *   onClose          – called when overlay or X button is clicked
 *   onStatusChange   – (memberId, newStatus) => void   (freeze / cancel / resume)
 *   onSaveAccessCode – (memberId, code) => void         (optional; hides save button if absent)
 *   updating         – boolean, disables action buttons while a request is in flight
 */
export default function MemberProfileDrawer({
  member,
  open,
  membershipBorder,
  onClose,
  onStatusChange,
  onSaveAccessCode,
  updating = false,
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sliding panel */}
      <div
        className={`fixed inset-y-0 right-0 w-full sm:w-[480px] bg-[#171717] border-l border-neutral-800 z-50 flex flex-col shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {member && (
          <DrawerContent
            member={member}
            membershipBorder={membershipBorder}
            onClose={onClose}
            onStatusChange={onStatusChange}
            onSaveAccessCode={onSaveAccessCode}
            updating={updating}
          />
        )}
      </div>
    </>
  )
}
