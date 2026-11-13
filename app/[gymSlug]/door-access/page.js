'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, KeyRound, AlertTriangle, X, Search, UserPlus } from 'lucide-react'
import MemberDrawer from '@/components/member-drawer/MemberDrawer'
import { useMemberParam } from '@/components/member-drawer/useMemberParam'
import { fillSuggestedPin } from '@/lib/suggestPin'

// ── Constants ─────────────────────────────────────────────────────────────────

const CODE_TYPE_BORDER = {
  member: 'border-blue-400 text-blue-400',
  guest:  'border-amber-400 text-amber-400',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeLeft(endsAt) {
  if (!endsAt) return null
  const ms = new Date(endsAt) - Date.now()
  if (ms <= 0) return 'expired'
  const totalH = Math.floor(ms / 3_600_000)
  const d = Math.floor(totalH / 24)
  const h = totalH % 24
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

/** Created date of a lock code, YYYY-MM-DD in the gym's timezone (America/New_York). */
function createdDay(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// guests first, then members, unknown codes last
const TYPE_ORDER = { guest: 0, member: 1, unknown: 2 }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DoorAccessPage() {
  const { gymSlug } = useParams()

  const [codes,         setCodes]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [fetchErr,      setFetchErr]      = useState(null)
  const [noDevice,      setNoDevice]      = useState(false)
  const [search,        setSearch]        = useState('')
  const [accessProvider, setAccessProvider] = useState(null) // null while loading
  const [resendingId,    setResendingId]    = useState(null)
  const [changeModal,   setChangeModal]   = useState(null)
  const [removeModal,   setRemoveModal]   = useState(null)
  // Unknown codes can only be removed by OWNER / ADMIN (enforced server-side too)
  const [canRemoveUnknown, setCanRemoveUnknown] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)
  const [newCode,       setNewCode]       = useState('')

  // ── Add member modal ──────────────────────────────────────────────────────
  const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '', membershipType: '', accessCode: '', joinDate: '' }
  const [addOpen,       setAddOpen]       = useState(false)
  const [addForm,       setAddForm]       = useState(EMPTY_FORM)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError,      setAddError]      = useState(null)
  // After save: the code actually assigned (staff-only page, door.manage) — may differ from the typed one
  const [addResult,     setAddResult]     = useState(null)   // { name, code, requested } | null

  function openAddModal() {
    setAddForm(EMPTY_FORM)
    setAddError(null)
    setAddResult(null)
    setAddOpen(true)
  }

  function setField(field) {
    return e => setAddForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  async function handleAddSubmit(e) {
    e.preventDefault()
    if (!addForm.firstName.trim())      { setAddError('first name is required');      return }
    if (!addForm.lastName.trim())       { setAddError('last name is required');       return }
    if (!addForm.email.trim())          { setAddError('email is required');            return }
    if (!addForm.phone.trim())          { setAddError('phone is required');            return }
    if (!addForm.membershipType.trim()) { setAddError('membership type is required'); return }
    if (accessProvider !== 'KISI' && !addForm.accessCode.trim()) { setAddError('door code is required'); return }
    if (!addForm.joinDate)              { setAddError('joined date is required');     return }
    setAddSubmitting(true)
    setAddError(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/members`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          firstName:      addForm.firstName.trim(),
          lastName:       addForm.lastName.trim(),
          email:          addForm.email.trim(),
          phone:          addForm.phone.trim(),
          membershipType: addForm.membershipType.trim(),
          accessCode:     addForm.accessCode.trim(),
          joinDate:       addForm.joinDate,
        }),
      })
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({}))
        throw new Error(msg || `${res.status}`)
      }
      const { member } = await res.json()
      if (accessProvider === 'KISI') {
        // Kisi grant happens server-side (members/route.js) — just refetch
        // the list rather than guessing at its shape optimistically.
        fetchCodes()
      } else {
        // Append optimistically — Seam won't index the new code instantly
        const fullName = `${member.firstName} ${member.lastName}`.trim()
        setCodes(prev => [...prev, {
          id:             `pending-${member.id}`,
          type:           'member',
          name:           fullName,
          code:           member.accessCode,
          endsAt:         null,
          memberId:       member.id,
          email:          member.email,
          phone:          member.phone          ?? null,
          membershipType: member.membershipType ?? 'general',
          memberStatus:   member.status,
          joinDate:       member.dateAccessed   ?? member.createdAt,
        }])
        // Show the code that was really assigned — the server issues a new one
        // if the typed code was already in use at this gym.
        setAddResult({ name: fullName, code: member.accessCode ?? null, requested: addForm.accessCode.trim() })
        return
      }
      setAddOpen(false)
    } catch (err) {
      setAddError(err.message || 'something went wrong — please try again')
    } finally {
      setAddSubmitting(false)
    }
  }

  // ── Member profile drawer — ?member=<id>&tab=<tab>, access tab by default ──
  const drawer = useMemberParam('access')
  // The open member's row in this page's lock-code list (code status, delete)
  const selectedCode = drawer.memberId ? codes.find(c => c.type === 'member' && c.memberId === drawer.memberId) ?? null : null

  async function handleDeleteCode() {
    if (!selectedCode) return
    try {
      const token = localStorage.getItem('ik_token')
      const qs    = selectedCode.code ? `?code=${encodeURIComponent(selectedCode.code)}` : ''
      const res   = await fetch(`/api/${gymSlug}/seam/codes/${selectedCode.id}${qs}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      setCodes(prev => prev.filter(c => c.id !== selectedCode.id))
      drawer.close()
    } catch (err) {
      console.error('[door-access] delete code failed', err.message)
      // Don't re-throw — the drawer has no error boundary around onDeleteCode
    }
  }

  // Resolve the gym's door-access provider first — everything else below
  // waits on this so it only fetches from the right source once.
  useEffect(() => {
    if (!gymSlug) return
    const token = localStorage.getItem('ik_token')
    fetch(`/api/${gymSlug}/gym`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => setAccessProvider(data?.gym?.accessProvider ?? 'SEAM'))
      .catch(() => setAccessProvider('SEAM'))
  }, [gymSlug])

  const fetchCodes = useCallback(async () => {
    if (!accessProvider) return
    setLoading(true)
    setNoDevice(false)
    try {
      const token = localStorage.getItem('ik_token')

      if (accessProvider === 'KISI') {
        // No Seam "codes" concept for Kisi — list members directly and
        // derive invite status from kisiUserId/kisiRoleAssignmentId.
        const res = await fetch(`/api/${gymSlug}/all`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`${res.status}`)
        const { members } = await res.json()
        setCodes((members ?? []).map(m => ({
          id:                   m.id,
          type:                 'member',
          name:                 `${m.firstName} ${m.lastName}`.trim(),
          memberId:              m.id,
          kisiUserId:            m.kisiUserId ?? null,
          kisiRoleAssignmentId:  m.kisiRoleAssignmentId ?? null,
        })))
        setFetchErr(null)
        return
      }

      const res   = await fetch(`/api/${gymSlug}/seam/codes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = res.ok ? await res.json() : null
      // No Seam key or device on this gym → no lock connected (no Seam call was made)
      if (res.status === 422 || json?.noLock) {
        setNoDevice(true)
        setCodes([])
        setFetchErr(null)
        return
      }
      if (!res.ok) throw new Error(`${res.status}`)
      setCodes(json.codes)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load door codes')
    } finally {
      setLoading(false)
    }
  }, [gymSlug, accessProvider])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  useEffect(() => {
    const token = localStorage.getItem('ik_token')
    fetch(`/api/${gymSlug}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(me => setCanRemoveUnknown(['OWNER', 'ADMIN'].includes(me?.role)))
      .catch(() => setCanRemoveUnknown(false))
  }, [gymSlug])

  async function handleResendInviteRow(memberId) {
    setResendingId(memberId)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/members/${memberId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ resendKisiInvite: true }),
      })
      if (!res.ok) throw new Error('Failed')
      fetchCodes()
    } catch {
      // non-fatal
    } finally {
      setResendingId(null)
    }
  }

  // Tab + search filter
  const visible = codes.filter(c => {
    const q = search.trim().toLowerCase()
    if (q) return `${c.name} ${c.code}`.toLowerCase().includes(q)
    return true
  }).sort((a, b) => {
    // guests, then members (alphabetical), then unknown codes (newest first)
    if (a.type !== b.type) return (TYPE_ORDER[a.type] ?? 1) - (TYPE_ORDER[b.type] ?? 1)
    if (a.type === 'unknown') return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
    return a.name.localeCompare(b.name)
  })

  async function handleChangeCode() {
    if (!changeModal?.memberId) return
    setActionLoading(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/seam/codes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ memberId: changeModal.memberId, codeId: changeModal.id, code: newCode || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'something went wrong — please try again')
      }
      setChangeModal(null)
      setNewCode('')
      fetchCodes()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleRemove() {
    if (!removeModal) return
    setActionLoading(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('ik_token')
      const qs  = removeModal.code ? `?code=${encodeURIComponent(removeModal.code)}` : ''
      const res = await fetch(`/api/${gymSlug}/seam/codes/${removeModal.id}${qs}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Request failed')
      setCodes(prev => prev.filter(c => c.id !== removeModal.id))
      setRemoveModal(null)
    } catch {
      setActionError('something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">door access</h1>
        <button
          onClick={openAddModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-black hover:bg-neutral-200 transition-colors"
        >
          <UserPlus size={12} />
          add member
        </button>
      </header>

      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Search bar */}
        <div className="shrink-0 relative w-full sm:w-80">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            placeholder="search name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-neutral-700/50 border border-neutral-600/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
          />
        </div>

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">

          {/* Body */}
          <div className="md:flex-1 md:overflow-y-auto overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 gap-2">
                <RefreshCw size={16} className="text-neutral-600 animate-spin" />
                <span className="text-sm text-neutral-600">loading…</span>
              </div>
            ) : noDevice ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <KeyRound size={20} className="text-neutral-700" />
                <p className="text-sm text-neutral-500">no lock connected</p>
                <p className="text-xs text-neutral-600">add this gym's seam api key and device id in the admin portal to enable door access</p>
              </div>
            ) : fetchErr ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <p className="text-sm text-red-400">{fetchErr}</p>
                <button onClick={fetchCodes} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                  retry
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-neutral-600">no door codes found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {visible.map((c, i) => {
                    const tl = c.codeType === 'time_bound' ? timeLeft(c.endsAt) : null
                    const unknown = c.type === 'unknown'
                    return (
                      <tr
                        key={c.id}
                        onClick={() => c.type === 'member' && c.memberId && drawer.openMember(c.memberId)}
                        className={`group hover:bg-white/5 transition-colors ${c.type === 'member' && c.memberId ? 'cursor-pointer' : ''} ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                      >
                        {/* Name + type + time left */}
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${unknown ? 'bg-neutral-800' : 'bg-white'}`}>
                              <span className={`font-medium text-[10px] select-none ${unknown ? 'text-neutral-500' : 'text-black'}`}>
                                {unknown ? '?' : c.name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className={`text-sm leading-tight ${unknown ? 'text-neutral-500' : 'text-white'}`}>{c.name}</p>
                              {unknown && (
                                <p className="text-[11px] text-neutral-600 mt-0.5">
                                  unknown code
                                  {c.code && <> · pin <span className="font-mono">{c.code}</span></>}
                                  {createdDay(c.createdAt) && <> · created {createdDay(c.createdAt)}</>}
                                  {tl && <> · {tl}</>}
                                </p>
                              )}
                              {c.type === 'guest' && (
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[11px] text-amber-400">guest</span>
                                  {tl && (
                                    <span className={`text-[11px] ${tl === 'expired' ? 'text-red-400' : 'text-neutral-500'}`}>
                                      · {tl}
                                    </span>
                                  )}
                                </div>
                              )}
                              {accessProvider === 'KISI' && (
                                <p className="text-[11px] text-neutral-500 mt-0.5">
                                  access via kisi app
                                  {' — '}
                                  {!c.kisiUserId
                                    ? 'not yet invited'
                                    : c.kisiRoleAssignmentId ? 'active' : 'invited, access pending'}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Action — remove for guest / unknown codes (Seam); resend invite (Kisi) */}
                        <td className="px-4 py-3 text-right" onClick={e => (accessProvider === 'KISI' || c.type === 'guest' || unknown) && e.stopPropagation()}>
                          {accessProvider === 'KISI' ? (
                            <button
                              onClick={() => handleResendInviteRow(c.memberId)}
                              disabled={resendingId === c.memberId}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-neutral-400 hover:text-white disabled:opacity-40 transition-colors"
                            >
                              {resendingId === c.memberId ? '…' : 'resend invite'}
                            </button>
                          ) : (c.type === 'guest' || (unknown && canRemoveUnknown)) && (
                            <button
                              onClick={() => { setRemoveModal(c); setActionError(null) }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-red-400/60 hover:text-red-400 transition-colors"
                            >
                              remove
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {/* ── Change code modal ────────────────────────────────────────────────── */}
      {changeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={!actionLoading ? () => setChangeModal(null) : undefined} />
          <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                <KeyRound size={16} className="text-neutral-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">change door code</p>
                <p className="text-xs text-neutral-500">{changeModal.name}</p>
              </div>
              <button onClick={() => setChangeModal(null)} disabled={actionLoading} className="ml-auto p-1.5 rounded-lg text-neutral-600 hover:text-white hover:bg-white/5 transition-colors">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              enter a new 4-6 digit code, or randomly generate one automatically
            </p>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="4–6 digits"
                maxLength={6}
                value={newCode}
                onChange={e => setNewCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="flex-1 bg-[#292929] border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 font-mono tracking-widest"
              />
              <button
                type="button"
                onClick={() => fillSuggestedPin(gymSlug, setNewCode)}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 border border-neutral-700 transition-colors whitespace-nowrap"
              >
                generate
              </button>
            </div>
            {actionError && <p className="text-xs text-red-400 mb-3">{actionError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setChangeModal(null)}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleChangeCode}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-neutral-500/10 text-neutral-300 hover:bg-neutral-500/20 disabled:opacity-40 transition-colors"
              >
                {actionLoading ? 'please wait…' : 'update code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove modal ─────────────────────────────────────────────────────── */}
      {removeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={!actionLoading ? () => setRemoveModal(null) : undefined} />
          <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} className="text-neutral-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">remove door code?</p>
                <p className="text-xs text-neutral-500">
                  {removeModal.name}
                  {removeModal.type === 'unknown' && removeModal.code && <> · pin <span className="font-mono">{removeModal.code}</span></>}
                </p>
              </div>
            </div>
            <ul className="space-y-1.5 mb-5">
              {[
                'the code will be deleted from all connected locks',
                'this action cannot be undone',
              ].map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-neutral-400">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-600 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
            {actionError && <p className="text-xs text-red-400 mb-3">{actionError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setRemoveModal(null)}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleRemove}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
              >
                {actionLoading ? 'please wait…' : 'yes, remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add member modal ─────────────────────────────────────────────────── */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={!addSubmitting ? () => setAddOpen(false) : undefined} />
          <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-md p-6 shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm font-semibold text-white">add member</p>
              <button onClick={() => setAddOpen(false)} disabled={addSubmitting} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors">
                <X size={15} />
              </button>
            </div>

            {addResult ? (
              <div className="space-y-4">
                <p className="text-sm text-neutral-300">
                  <span className="text-white font-semibold">{addResult.name}</span> was added.
                </p>
                <div className="flex items-center justify-between bg-neutral-900 rounded-lg px-4 py-3">
                  <span className="text-xs text-neutral-400">door code</span>
                  <span className="text-lg font-bold text-white font-mono tracking-widest">{addResult.code ?? '—'}</span>
                </div>
                {addResult.code && addResult.requested && addResult.code !== addResult.requested && (
                  <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    the code you entered (<span className="font-mono">{addResult.requested}</span>) was already in use,
                    so this member was assigned <span className="font-mono font-semibold">{addResult.code}</span> instead.
                    give them this code.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => { setAddOpen(false); setAddResult(null) }}
                  className="w-full py-2 rounded-lg text-xs font-medium bg-white text-black hover:bg-neutral-200 transition-colors"
                >
                  done
                </button>
              </div>
            ) : (
            <form onSubmit={handleAddSubmit} className="space-y-3">

              {/* Name row */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] text-neutral-500 mb-1">first name</label>
                  <input value={addForm.firstName} onChange={setField('firstName')} placeholder="jane"
                    className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] text-neutral-500 mb-1">last name</label>
                  <input value={addForm.lastName} onChange={setField('lastName')} placeholder="smith"
                    className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">email</label>
                <input value={addForm.email} onChange={setField('email')} type="email" placeholder="jane@example.com"
                  className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">phone</label>
                <input value={addForm.phone} onChange={setField('phone')} type="tel" placeholder="(555) 000-0000"
                  className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
              </div>

              {/* Membership type */}
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">membership type</label>
                <input value={addForm.membershipType} onChange={setField('membershipType')} placeholder="e.g. general, student, vip"
                  className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
              </div>

              {/* Access code (Seam only) + joined date */}
              <div className="flex gap-3">
                {accessProvider !== 'KISI' && (
                  <div className="flex-1">
                    <label className="block text-[11px] text-neutral-500 mb-1">door code</label>
                    <input
                      value={addForm.accessCode}
                      onChange={e => setAddForm(p => ({ ...p, accessCode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      placeholder="4–6 digits" maxLength={6}
                      className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 font-mono"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <label className="block text-[11px] text-neutral-500 mb-1">joined date</label>
                  <input value={addForm.joinDate} onChange={setField('joinDate')} type="date"
                    className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
                </div>
              </div>
              {accessProvider === 'KISI' && (
                <p className="text-[11px] text-neutral-500">access will be granted via the kisi app — an invite is sent automatically.</p>
              )}

              {addError && <p className="text-xs text-red-400">{addError}</p>}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setAddOpen(false)} disabled={addSubmitting}
                  className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors">
                  cancel
                </button>
                <button type="submit" disabled={addSubmitting}
                  className="flex-1 py-2 rounded-lg text-xs font-medium bg-white text-black hover:bg-neutral-200 disabled:opacity-40 transition-colors">
                  {addSubmitting ? 'adding…' : 'add member'}
                </button>
              </div>

            </form>
            )}
          </div>
        </div>
      )}

      <MemberDrawer
        gymSlug={gymSlug}
        memberId={drawer.memberId}
        initialTab={drawer.tab}
        onClose={drawer.close}
        onTabChange={drawer.setTab}
        onMemberUpdated={() => fetchCodes()}
        onMemberRemoved={() => fetchCodes()}
        onDeleteCode={selectedCode && accessProvider !== 'KISI' ? handleDeleteCode : undefined}
      />

    </div>
  )
}
