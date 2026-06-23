'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw, KeyRound, AlertTriangle, X, Search, UserPlus } from 'lucide-react'
import { getGymTheme } from '@/lib/gymThemes'
import MemberProfileDrawer from '@/components/MemberProfileDrawer'

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DoorAccessPage() {
  const { gymSlug } = useParams()
  const { membershipBorder } = getGymTheme(gymSlug)

  const [codes,         setCodes]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [fetchErr,      setFetchErr]      = useState(null)
  const [noDevice,      setNoDevice]      = useState(false)
  const [search,        setSearch]        = useState('')
  const [changeModal,   setChangeModal]   = useState(null)
  const [removeModal,   setRemoveModal]   = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)
  const [newCode,       setNewCode]       = useState('')

  // ── Add member modal ──────────────────────────────────────────────────────
  const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '', membershipType: '', accessCode: '', joinDate: '' }
  const [addOpen,       setAddOpen]       = useState(false)
  const [addForm,       setAddForm]       = useState(EMPTY_FORM)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError,      setAddError]      = useState(null)

  function openAddModal() {
    setAddForm(EMPTY_FORM)
    setAddError(null)
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
    if (!addForm.accessCode.trim())     { setAddError('access code is required');     return }
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
      setAddOpen(false)
    } catch (err) {
      setAddError(err.message || 'something went wrong — please try again')
    } finally {
      setAddSubmitting(false)
    }
  }

  // ── Member profile drawer ─────────────────────────────────────────────────
  const [selectedMember, setSelectedMember] = useState(null)
  const [selectedCode,   setSelectedCode]   = useState(null) // Seam code obj for the open member
  const [panelOpen,      setPanelOpen]      = useState(false)
  const closeTimer = useRef(null)

  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedMember(null), 220)
  }

  async function openMemberPanel(code) {
    if (code.type !== 'member' || !code.memberId) return
    setSelectedCode(code)
    setPanelOpen(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/members/${code.memberId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { member } = await res.json()
      setSelectedMember(member)
    } catch {
      closePanel()
    }
  }

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
      closePanel()
    } catch (err) {
      console.error('[door-access] delete code failed', err.message)
      // Don't re-throw — MemberProfileDrawer has no error boundary around onDeleteCode
    }
  }

  async function handleSaveAccessCode(memberId, code) {
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/members/${memberId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ accessCode: code }),
      })
      if (!res.ok) throw new Error('Failed')
      const { member: updated } = await res.json()
      setSelectedMember(prev => prev?.id === memberId ? { ...prev, ...updated } : prev)
      fetchCodes()
    } catch {
      // non-fatal
    }
  }

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    setNoDevice(false)
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/seam/codes`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 422) {
        setNoDevice(true)
        setCodes([])
        setFetchErr(null)
        return
      }
      if (!res.ok) throw new Error(`${res.status}`)
      const { codes } = await res.json()
      setCodes(codes)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load access codes')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  // Tab + search filter
  const visible = codes.filter(c => {
    const q = search.trim().toLowerCase()
    if (q) return `${c.name} ${c.code}`.toLowerCase().includes(q)
    return true
  }).sort((a, b) => {
    // guests first, then members; alphabetical within each group
    if (a.type !== b.type) return a.type === 'guest' ? -1 : 1
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
      if (!res.ok) throw new Error('Request failed')
      setChangeModal(null)
      setNewCode('')
      fetchCodes()
    } catch {
      setActionError('something went wrong — please try again')
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
                <p className="text-sm text-neutral-500">no device configured</p>
                <p className="text-xs text-neutral-600">add a Seam device ID in the admin portal to enable door access</p>
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
                <p className="text-sm text-neutral-600">no access codes found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {visible.map((c, i) => {
                    const tl        = c.codeType === 'time_bound' ? timeLeft(c.endsAt) : null
                    const typeLabel = tl ? `${c.type} · ${tl}` : c.type
                    return (
                      <tr
                        key={c.id}
                        onClick={() => openMemberPanel(c)}
                        className={`group hover:bg-white/5 transition-colors ${c.type === 'member' && c.memberId ? 'cursor-pointer' : ''} ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                      >
                        {/* Name + type + time left */}
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                              <span className="text-black font-medium text-[10px] select-none">
                                {c.name.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-white text-sm leading-tight">{c.name}</p>
                              {c.endsAt !== null && (
                                <span className={`text-[11px] mt-0.5 ${CODE_TYPE_BORDER[c.type] ?? 'text-zinc-400'} ${tl === 'expired' ? '!text-red-400' : ''}`}>
                                  {typeLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Action — remove for guests only */}
                        <td className="px-4 py-3 text-right" onClick={e => c.type === 'guest' && e.stopPropagation()}>
                          {c.type === 'guest' && (
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
                <p className="text-sm font-semibold text-white">change access code</p>
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
                placeholder="e.g. 8472"
                maxLength={6}
                value={newCode}
                onChange={e => setNewCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="flex-1 bg-[#292929] border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 font-mono tracking-widest"
              />
              <button
                type="button"
                onClick={() => setNewCode(String(Math.floor(1000 + Math.random() * 9000)))}
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
                <p className="text-sm font-semibold text-white">remove access code?</p>
                <p className="text-xs text-neutral-500">{removeModal.name}</p>
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

              {/* Access code + joined date */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[11px] text-neutral-500 mb-1">access code</label>
                  <input
                    value={addForm.accessCode}
                    onChange={e => setAddForm(p => ({ ...p, accessCode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    placeholder="e.g. 4821" maxLength={6}
                    className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 font-mono"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] text-neutral-500 mb-1">joined date</label>
                  <input value={addForm.joinDate} onChange={setField('joinDate')} type="date"
                    className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
                </div>
              </div>

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
          </div>
        </div>
      )}

      <MemberProfileDrawer
        member={selectedMember}
        open={panelOpen}
        gymSlug={gymSlug}
        membershipBorder={membershipBorder}
        onClose={closePanel}
        onSaveAccessCode={handleSaveAccessCode}
        onDeleteCode={handleDeleteCode}
        simplified={true}
      />

    </div>
  )
}
