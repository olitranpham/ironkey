'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { getGymTheme } from '@/lib/gymThemes'
import { GuestProfilePanel, fmtDate } from '@/components/GuestProfilePanel'

export default function PartnerCheckinsPage() {
  const { gymSlug } = useParams()
  const { passTypeBorder } = getGymTheme(gymSlug)

  const [checkins,   setCheckins]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState(null)

  const [selectedProfile, setSelectedProfile] = useState(null)
  const [panelOpen,       setPanelOpen]       = useState(false)
  const [profileLoading,  setProfileLoading]  = useState(false)
  const [savingCode,      setSavingCode]      = useState(false)
  const closeTimer = useRef(null)

  useEffect(() => {
    document.body.style.overflow = panelOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [panelOpen])

  const fetchCheckins = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/rep-gym-pass/checkins`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setCheckins(data.checkins ?? [])
      setFetchErr(null)
    } catch {
      setFetchErr('could not load partner check-ins')
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { fetchCheckins() }, [fetchCheckins])

  async function openPanel(email) {
    setProfileLoading(true)
    setPanelOpen(true)
    setSelectedProfile(null)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(
        `/api/${gymSlug}/guest-passes/profiles?email=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) throw new Error(`${res.status}`)
      const { profile } = await res.json()
      setSelectedProfile(profile)
    } catch {
      setPanelOpen(false)
    } finally {
      setProfileLoading(false)
    }
  }

  function closePanel() {
    setPanelOpen(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelectedProfile(null), 300)
  }

  async function saveAccessCode(profileId, code) {
    setSavingCode(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/guest-passes/profiles/${profileId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ accessCode: code }),
      })
      if (!res.ok) throw new Error('Failed')
      const { profile: updated } = await res.json()
      setSelectedProfile(prev => prev?.id === profileId ? { ...prev, ...updated } : prev)
      // Update access code displayed in the table rows
      setCheckins(prev => prev.map(c =>
        c.userEmail === updated.email ? { ...c, accessCode: updated.accessCode ?? c.accessCode } : c
      ))
    } catch {
      // non-fatal
    } finally {
      setSavingCode(false)
    }
  }

  async function saveProfileFields(profileId, fields) {
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/guest-passes/profiles/${profileId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(fields),
      })
      if (!res.ok) throw new Error('Failed')
      const { profile: updated } = await res.json()
      setSelectedProfile(prev => prev?.id === profileId ? { ...prev, ...updated } : prev)
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      {/* Top bar */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-white">partner check-ins</h1>
          {!loading && (
            <span className="text-sm font-normal text-white opacity-40 tabular-nums">
              {checkins.length}
            </span>
          )}
        </div>
      </header>

      <main className="md:flex-1 flex flex-col p-5 gap-4 md:overflow-hidden md:min-h-0">

        {/* Table card */}
        <div className="md:flex-1 flex flex-col bg-white/[0.03] rounded-xl border border-white/5 md:overflow-hidden md:min-h-0">

          {/* Body */}
          <div className="md:flex-1 md:overflow-y-auto overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 gap-2">
                <RefreshCw size={16} className="text-neutral-600 animate-spin" />
                <span className="text-sm text-neutral-600">loading…</span>
              </div>
            ) : fetchErr ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <p className="text-sm text-red-400">{fetchErr}</p>
                <button onClick={fetchCheckins} className="text-xs text-neutral-400 border border-neutral-700 rounded-lg px-3 py-1.5 hover:text-white transition-colors">
                  retry
                </button>
              </div>
            ) : checkins.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-neutral-600">no check-ins yet</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {checkins.map((c, i) => (
                    <tr
                      key={c.id}
                      onClick={() => openPanel(c.userEmail)}
                      className={`group hover:bg-white/5 transition-colors cursor-pointer ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}
                    >
                      {/* Name + avatar */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                            <span className="text-black font-medium text-[10px] select-none">
                              {c.userName.split(' ').map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase()}
                            </span>
                          </div>
                          <p className="text-white text-sm leading-tight">{c.userName}</p>
                        </div>
                      </td>

                      {/* Check-in date */}
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs text-neutral-500">{fmtDate(c.createdAt)}</span>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </main>

      {/* ── Profile panel ─────────────────────────────────────────────────── */}
      <div
        style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
        className={`fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4 transition-opacity duration-200 ${panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={closePanel}
      >
        <div
          className="w-full max-w-[500px] flex flex-col bg-[#171717] rounded-2xl shadow-2xl overflow-hidden"
          style={{ maxHeight: '85vh' }}
          onClick={e => e.stopPropagation()}
        >
          {profileLoading && (
            <div className="flex-1 flex items-center justify-center py-12">
              <RefreshCw size={16} className="text-neutral-600 animate-spin" />
            </div>
          )}
          {!profileLoading && selectedProfile && (
            <GuestProfilePanel
              profile={selectedProfile}
              passTypeBorder={passTypeBorder}
              onClose={closePanel}
              onSaveCode={saveAccessCode}
              saving={savingCode}
              onSavePassesLeft={() => {}}
              onSaveProfile={(fields) => saveProfileFields(selectedProfile.id, fields)}
              source="partner"
            />
          )}
        </div>
      </div>

    </div>
  )
}
