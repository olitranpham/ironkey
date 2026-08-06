'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Search, RefreshCw, AlertTriangle, Download } from 'lucide-react'
import { getGymTheme } from '@/lib/gymThemes'
import MemberProfileDrawer from '@/components/MemberProfileDrawer'
import { CATEGORY_OPTIONS, classifyMembershipType, classifyMembershipTypeAll } from '@/lib/membershipCategory'

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_TABS  = ['active', 'flex', 'frozen', 'canceled']
const FLEX_GYMS = new Set(['oasis-boston'])

const STATUS_TEXT = {
  ACTIVE:    'text-emerald-600',
  FROZEN:    'text-blue-400/70',
  CANCELED: 'text-zinc-500',
  OVERDUE:   'text-red-400/70',
}

const AVATAR_COLOR = 'bg-white'

const CONFIRM_COPY = {
  freeze: {
    title:   'freeze membership?',
    bullets: [
      'access will be removed immediately',
      'maximum freeze duration is 6 months',
      'you can resume the membership at any time',
    ],
    cta:     'yes, freeze',
    ctaCls:  'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20',
  },
  cancel: {
    title:   'cancel membership?',
    bullets: [
      'the member stays active until their billing period ends',
      'their door access is preserved until stripe confirms cancellation',
      'a cancellation scheduled event will be logged today',
    ],
    cta:     'yes, cancel',
    ctaCls:  'bg-red-500/10 text-red-400 hover:bg-red-500/20',
  },
  resume: {
    title:   'resume membership?',
    bullets: [
      'the member will regain immediate access',
      'their membership will return to active status',
    ],
    cta:     'yes, resume',
    ctaCls:  'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  },
  overdue: {
    title:   'mark as overdue?',
    bullets: [
      'the member will appear on the overdue payments page',
      'their access is not affected until you cancel',
    ],
    cta:     'yes, mark overdue',
    ctaCls:  'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
  },
  remove: {
    title:   'remove member?',
    bullets: [
      'their record will be permanently deleted',
      'their door access code will be removed from the lock',
      'this action cannot be undone',
    ],
    cta:     'yes, remove',
    ctaCls:  'bg-red-500/10 text-red-400 hover:bg-red-500/20',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtStatus(status) {
  return status === 'CANCELED' ? 'canceled' : status.toLowerCase()
}


function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const { gymSlug } = useParams()
  const { membershipBorder } = getGymTheme(gymSlug)
  const tabs = FLEX_GYMS.has(gymSlug) ? ALL_TABS : ALL_TABS.filter(t => t !== 'flex')

  const [members,   setMembers]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [fetchErr,  setFetchErr]  = useState(null)
  const [search,     setSearch]     = useState('')
  const [activeTab,  setActiveTab]  = useState('active')
  const [typeFilter, setTypeFilter] = useState('')

  // Slide-out panel
  const [selectedMember, setSelectedMember] = useState(null)
  const [panelOpen,      setPanelOpen]      = useState(false)
  const closeTimer = useRef(null)

  // Confirm modal
  const [confirmModal,  setConfirmModal]  = useState(null) // { action, member }
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError,   setActionError]   = useState(null)

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    try {
      const token = localStorage.getItem('ik_token')
      const res   = await fetch(`/api/${gymSlug}/all`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const { members } = await res.json()
      setMembers(members)
      setFetchErr(null)
    } catch {
      setFetchErr('could not load members')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // ── Panel helpers ────────────────────────────────────────────────────────

  function openPanel(member) {
    setSelectedMember(member)
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedMember(null), 220)
  }

  // ── Action helpers ───────────────────────────────────────────────────────

  async function handleSaveAccessCode(memberId, code) {
    console.log('[handleSaveAccessCode] memberId=%s code=%s', memberId, code)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/members/${memberId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ accessCode: code }),
      })
      console.log('[handleSaveAccessCode] response status:', res.status)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[handleSaveAccessCode] error:', err)
        throw new Error(err.error ?? 'Failed')
      }
      const { member: updated } = await res.json()
      console.log('[handleSaveAccessCode] updated member:', updated)
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === memberId ? { ...prev, ...updated } : prev)
    } catch (err) {
      console.error('[handleSaveAccessCode] caught:', err.message)
    }
  }

  async function handleSaveField(memberId, fields) {
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/members/${memberId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(fields),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed')
      }
      const { member: updated } = await res.json()
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === memberId ? { ...prev, ...updated } : prev)
    } catch (err) {
      console.error('[handleSaveField] caught:', err.message)
    }
  }

  async function confirmAction() {
    const { action, member } = confirmModal
    setActionLoading(true)
    setActionError(null)
    try {
      const token = localStorage.getItem('ik_token')

      if (action === 'remove') {
        const res = await fetch(`/api/${gymSlug}/members/${member.id}`, {
          method:  'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Request failed')
        setMembers(prev => prev.filter(m => m.id !== member.id))
        setConfirmModal(null)
        closePanel()
        return
      }

      const res  = await fetch(`/api/${gymSlug}/${action}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ memberId: member.id }),
      })
      if (!res.ok) throw new Error('Request failed')
      const json = await res.json()
      const { member: updated } = json
      setMembers(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
      setSelectedMember(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev)
      if (json.error === 'stripe_dashboard_sub') {
        setActionError(json.message)
        // Leave modal open so the owner sees the message
      } else {
        setConfirmModal(null)
      }
    } catch (err) {
      console.error('[confirmAction]', err)
      setActionError('something went wrong — please try again')
    } finally {
      setActionLoading(false)
    }
  }

  // ── CSV export ───────────────────────────────────────────────────────────

  function exportCSV() {
    const escape = v => {
      if (v == null) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }

    const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''

    const header = [
      'first name', 'last name', 'email', 'phone',
      'membership type', 'status', 'access code',
      'join date', 'freeze date', 'cancel date',
      'date of birth', 'address',
      'emergency contact name', 'emergency contact phone', 'emergency contact relationship',
      'is minor', 'guardian name', 'guardian email', 'guardian phone', 'guardian relationship',
    ]
    const rows = visible.map(m => [
      m.firstName,
      m.lastName,
      m.email,
      m.phone,
      m.membershipType,
      m.status,
      m.accessCode,
      fmtDate(m.dateAccessed ?? m.createdAt),
      fmtDate(m.dateFrozen),
      fmtDate(m.dateCanceled),
      m.dateOfBirth,
      m.address,
      m.emergencyContactName,
      m.emergencyContactPhone,
      m.emergencyContactRelationship,
      m.isMinor ? 'yes' : 'no',
      m.guardianName,
      m.guardianEmail,
      m.guardianPhone,
      m.guardianRelationship,
    ].map(escape))

    const csv  = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${gymSlug}-members-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  function isFlex(m) {
    return m.membershipType?.toLowerCase().includes('flex')
  }

  function matchesTab(m, tab) {
    if (tab === 'active')   return (m.status === 'ACTIVE' || m.status === 'OVERDUE') && !isFlex(m)
    if (tab === 'flex')     return isFlex(m)
    if (tab === 'frozen')   return m.status === 'FROZEN'
    if (tab === 'canceled') return m.status === 'CANCELED'
    return true
  }

  const tabCount = members.filter(m => matchesTab(m, activeTab)).length

  // Membership types actually present for this gym, so the filter never shows
  // options that don't apply here — pulled from the gym's real member records.
  // PT/programming variants (e.g. "1 session/week", "weekly communication")
  // collapse into two category options instead of one entry per tier.
  const regularTypes = [...new Set(
    members.map(m => m.membershipType).filter(t => t && !classifyMembershipType(t))
  )]
  const presentCategories = CATEGORY_OPTIONS.filter(cat =>
    members.some(m => classifyMembershipTypeAll(m.membershipType).includes(cat))
  )
  const membershipTypes = [...regularTypes, ...presentCategories].sort()

  const visible = members
    .filter(m => {
      const q = search.trim().toLowerCase()
      const matchSearch = !q ||
        `${m.firstName} ${m.lastName} ${m.email} ${m.phone ?? ''}`.toLowerCase().includes(q)
      const matchType = !typeFilter || (
        CATEGORY_OPTIONS.includes(typeFilter)
          ? classifyMembershipTypeAll(m.membershipType).includes(typeFilter)
          : m.membershipType === typeFilter
      )
      return matchesTab(m, activeTab) && matchSearch && matchType
    })
    .sort((a, b) => {
      if (activeTab === 'frozen')   return new Date(b.dateFrozen   ?? 0) - new Date(a.dateFrozen   ?? 0)
      if (activeTab === 'canceled') return new Date(b.dateCanceled ?? 0) - new Date(a.dateCanceled ?? 0)
      return 0
    })

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden">

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-white">members</h1>
          {!loading && (
            <span className="text-sm font-normal text-white opacity-40 tabular-nums">{tabCount}</span>
          )}
        </div>
        {!loading && members.length > 0 && (
          <button
            onClick={exportCSV}
            title="export csv"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Download size={15} />
          </button>
        )}
      </header>

      {/* Main */}
      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Search + type filter */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-80">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              type="text"
              placeholder="search name, email, phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-neutral-700/50 border border-neutral-600/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
            />
          </div>
          {membershipTypes.length > 0 && (
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-neutral-700/50 border border-neutral-600/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors appearance-none pr-7 cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              <option value="">all types</option>
              {membershipTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">

          {/* Tabs */}
          <div className="flex border-b border-neutral-800 px-4 shrink-0">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2.5 px-2.5 mr-1 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-white text-white'
                    : 'border-transparent text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Table body */}
          <div className="md:flex-1 md:overflow-y-auto overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 gap-2">
                <RefreshCw size={16} className="text-neutral-600 animate-spin" />
                <span className="text-sm text-neutral-600">loading…</span>
              </div>
            ) : fetchErr ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <p className="text-sm text-red-400">{fetchErr}</p>
                <button onClick={fetchMembers} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                  retry
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-neutral-600">no members match</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {visible.map((m, i) => (
                    <tr
                      key={m.id}
                      onClick={() => openPanel(m)}
                      className={`group hover:bg-white/5 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                    >
                      {/* Name + email + avatar */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                            <span className="text-black font-medium text-[10px] select-none">
                              {(m.firstName?.[0] ?? '') + (m.lastName?.[0] ?? '')}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-white text-sm leading-tight">{m.firstName} {m.lastName}</p>
                            {m.cancelScheduled && (
                              <p className="text-[10px] text-amber-500/70 leading-tight mt-0.5">cancellation scheduled</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Joined date */}
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs text-neutral-500">{fmtDate(m.createdAt)}</span>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      <MemberProfileDrawer
        member={selectedMember}
        open={panelOpen}
        gymSlug={gymSlug}
        membershipBorder={membershipBorder}
        onClose={closePanel}
        onStatusChange={(memberId, newStatus) => {
          const actionMap = { FROZEN: 'freeze', CANCELED: 'cancel', ACTIVE: 'resume' }
          setActionError(null)
          setConfirmModal({ action: actionMap[newStatus], member: selectedMember })
        }}
        onRemoveMember={() => {
          setActionError(null)
          setConfirmModal({ action: 'remove', member: selectedMember })
        }}
        onSaveAccessCode={handleSaveAccessCode}
        onSaveField={handleSaveField}
        updating={actionLoading}
      />

      {/* ── Confirm modal ─────────────────────────────────────────────────── */}
      {confirmModal && (
        <ConfirmModal
          action={confirmModal.action}
          member={confirmModal.member}
          loading={actionLoading}
          error={actionError}
          onConfirm={confirmAction}
          onClose={() => { setConfirmModal(null); setActionError(null) }}
        />
      )}

    </div>
  )
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({ action, member, loading, error, onConfirm, onClose }) {
  const copy = CONFIRM_COPY[action]
  if (!copy) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={!loading ? onClose : undefined} />

      {/* Card */}
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">

        {/* Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-neutral-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{copy.title}</p>
            <p className="text-xs text-neutral-500">{member.firstName} {member.lastName}</p>
          </div>
        </div>

        {/* Bullets */}
        <ul className="space-y-1.5 mb-5">
          {copy.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-neutral-400">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-neutral-600 shrink-0" />
              {b}
            </li>
          ))}
        </ul>

        {/* Error */}
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
          >
            cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors ${copy.ctaCls}`}
          >
            {loading ? 'please wait…' : copy.cta}
          </button>
        </div>

      </div>
    </div>
  )
}

