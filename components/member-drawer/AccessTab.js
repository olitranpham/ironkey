'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { KeyRound, DoorOpen } from 'lucide-react'
import { fillSuggestedPin } from '@/lib/suggestPin'
import { DrawerSection, DrawerField } from '@/components/DrawerParts'
import { ListState, INPUT_CLS, SAVE_CLS, fmtDate, fmtDateTime } from '@/components/member-drawer/fields'

// Seam code state → lock status. Errors win; `none` = no code for this member on the lock.
const LOCK_STATUS = {
  onLock:    { text: 'on lock',     cls: 'text-emerald-400' },
  syncing:   { text: 'syncing',     cls: 'text-amber-400' },
  failed:    { text: 'failed',      cls: 'text-red-400' },
  notOnLock: { text: 'not on lock', cls: 'text-neutral-400' },
}
function lockStatus({ status, failed }) {
  if (failed) return LOCK_STATUS.failed
  if (status === 'set') return LOCK_STATUS.onLock
  if (status === 'setting' || status === 'removing' || status === 'unknown') return LOCK_STATUS.syncing
  return LOCK_STATUS.notOnLock   // 'unset' or 'none'
}

/**
 * Access: door PIN (Seam) or Kisi invite status, the lock code's status,
 * Oasis flex check-ins and door visits.
 *
 * `codeStatus` — the member's row from the door-access page's own Seam list
 * ({ status, failed, codeType, endsAt }, or { status: 'none' } when the member
 * has no code on the lock), passed only there; other pages show the stored
 * PIN and link to door access instead (no per-member Seam call).
 * `onDeleteCode` — door access only: remove this code from the lock.
 */
export default function AccessTab({ member, gymSlug, accessProvider, save, codeStatus, onDeleteCode }) {
  const [visits, setVisits] = useState(null)   // null = loading
  const [codeError, setCodeError] = useState(null)
  const [resending, setResending] = useState(false)
  const [deleting, setDeleting]   = useState(false)

  useEffect(() => {
    if (!gymSlug || !member.id) return
    setVisits(null)
    fetch(`/api/${gymSlug}/members/${member.id}/visits`, { headers: { Authorization: `Bearer ${localStorage.getItem('ik_token')}` } })
      .then(r => (r.ok ? r.json() : { visits: [] }))
      .then(({ visits }) => setVisits(visits ?? []))
      .catch(() => setVisits([]))
  }, [member.id, gymSlug])

  useEffect(() => { setCodeError(null) }, [member.id])

  async function saveCode(code) {
    setCodeError(null)
    const result = await save({ accessCode: code })
    if (result?.error) setCodeError(result.error)   // e.g. 409 "that pin is already in use"
  }

  async function resendInvite() {
    setResending(true)
    await save({ resendKisiInvite: true })
    setResending(false)
  }

  async function deleteCode() {
    setDeleting(true)
    await onDeleteCode()
    setDeleting(false)
  }

  const lock = codeStatus ? lockStatus(codeStatus) : null

  return (
    <>
      <DrawerSection icon={KeyRound} title="access">
        {/* Kisi gyms get an invite-status row instead of a PIN editor */}
        {accessProvider === 'KISI' ? (
          <DrawerField label="access">
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-white">
                access via kisi app
                {member.loadedFull && (
                  <span className="text-neutral-500">
                    {' — '}
                    {!member.kisiUserId ? 'not yet invited' : member.kisiRoleAssignmentId ? 'active' : 'invited, access pending'}
                  </span>
                )}
              </span>
              {save && (
                <button onClick={resendInvite} disabled={resending} className={SAVE_CLS}>
                  {resending ? '…' : 'resend invite'}
                </button>
              )}
            </div>
          </DrawerField>
        ) : (
          <>
            <PinRow member={member} gymSlug={gymSlug} onSave={save ? saveCode : undefined} />
            {codeError && (
              <div className="px-3 py-2 bg-[#1c1c1c]"><p className="text-[11px] text-red-400">{codeError}</p></div>
            )}
            {lock ? (
              <DrawerField label="lock status">
                <span className={`text-xs ml-4 text-right ${lock.cls}`}>
                  {lock.text}
                  {codeStatus.codeType === 'time_bound' && codeStatus.endsAt ? ` · until ${fmtDate(codeStatus.endsAt)}` : ''}
                </span>
              </DrawerField>
            ) : (
              <DrawerField label="lock status">
                <Link href={`/${gymSlug}/door-access`} className="text-xs text-neutral-400 hover:text-white underline ml-4">
                  view on door access
                </Link>
              </DrawerField>
            )}
          </>
        )}

        {/* Flex check-ins — oasis-boston only (count comes from the members list) */}
        {gymSlug === 'oasis-boston' && member.membershipType?.toLowerCase().includes('flex') && member.flexCheckInsThisMonth !== undefined && (
          <DrawerField label="check-ins this month">
            <span className={`text-xs font-semibold ml-4 ${(member.flexCheckInsThisMonth ?? 0) >= 5 ? 'text-amber-400' : 'text-white'}`}>
              {member.flexCheckInsThisMonth ?? 0} / 5
            </span>
          </DrawerField>
        )}
      </DrawerSection>

      {/* Visit history — every door entry for this member's access code */}
      <DrawerSection icon={DoorOpen} title="visits">
        <ListState rows={visits} empty="no visits recorded">
          {visits?.map(v => (
            <div key={v.id} className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
              <span className="text-xs text-white">entered</span>
              <span className="text-xs text-neutral-500 ml-4 shrink-0">{fmtDateTime(v.createdAt) ?? '—'}</span>
            </div>
          ))}
        </ListState>
      </DrawerSection>

      {onDeleteCode && (
        <button
          onClick={deleteCode}
          disabled={deleting}
          className="w-full py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
        >
          {deleting ? 'removing…' : 'delete code'}
        </button>
      )}
    </>
  )
}

function PinRow({ member, gymSlug, onSave }) {
  const [input, setInput]   = useState(member.accessCode ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setInput(member.accessCode ?? '') }, [member.id, member.accessCode])

  async function save() {
    setSaving(true)
    await onSave(input.trim())
    setSaving(false)
  }

  return (
    <DrawerField label="door code">
      <div className="flex items-center gap-2 ml-4">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="——"
          maxLength={6}
          className={`${INPUT_CLS} w-20 font-mono`}
        />
        <button
          onClick={() => fillSuggestedPin(gymSlug, setInput)}
          className="text-[10px] px-2 py-1 rounded bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
        >
          gen
        </button>
        {onSave && (
          <button onClick={save} disabled={saving || input.trim() === (member.accessCode ?? '')} className={SAVE_CLS}>
            {saving ? '…' : 'save'}
          </button>
        )}
      </div>
    </DrawerField>
  )
}
