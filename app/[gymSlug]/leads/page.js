'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { requestError } from '@/lib/requestError'

const token = () => localStorage.getItem('ik_token')

const fmtDate  = d => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase() : '—')

const STATUS_STYLE = {
  new:       'bg-sky-500/10 text-sky-300 border-sky-500/20',
  contacted: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  converted: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
}


export default function LeadsPage() {
  const { gymSlug } = useParams()

  const [leads,     setLeads]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [notice,    setNotice]    = useState(null)
  const [canManage, setCanManage] = useState(false)
  const [busyId,    setBusyId]    = useState(null)
  const [filter,    setFilter]    = useState('open')   // 'open' (new + contacted) | 'all'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers = { Authorization: `Bearer ${token()}` }
      const [res, meRes] = await Promise.all([
        fetch(`/api/${gymSlug}/leads`, { headers }),
        fetch(`/api/${gymSlug}/me`, { headers }),
      ])
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(requestError(res, json))
      setLeads(json.leads ?? [])
      const me = meRes.ok ? await meRes.json() : null
      setCanManage(Boolean(me?.permissions?.includes('leads.manage')))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { load() }, [load])

  function patchLocal(id, lead) {
    setLeads(prev => prev.map(l => (l.guestProfileId === id ? { ...l, ...lead } : l)))
  }

  async function setStatus(lead, status) {
    setBusyId(lead.guestProfileId)
    setNotice(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/leads/${lead.guestProfileId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body:    JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(requestError(res, json))
      patchLocal(lead.guestProfileId, json.lead)
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    } finally {
      setBusyId(null)
    }
  }

  async function sendLink(lead) {
    setBusyId(lead.guestProfileId)
    setNotice(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/leads/${lead.guestProfileId}/invite`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token()}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(requestError(res, json))
      patchLocal(lead.guestProfileId, json.lead)

      if (json.delivered === 'webhook') {
        setNotice({ type: 'ok', text: `membership link emailed to ${lead.email}.` })
      } else {
        // No lead webhook for this gym — staff send it themselves
        try {
          await navigator.clipboard.writeText(json.joinLink)
          setNotice({ type: 'ok', text: `link copied — paste it into an email to ${lead.email}. marked as contacted.` })
        } catch {
          window.prompt('copy this membership link and email it to the lead:', json.joinLink)
          setNotice({ type: 'ok', text: 'marked as contacted.' })
        }
      }
    } catch (err) {
      setNotice({ type: 'err', text: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const shown = filter === 'open' ? leads.filter(l => l.status !== 'converted') : leads

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">leads</h1>
        <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5">
          {[['open', 'open'], ['all', 'all']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${filter === key ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-5">
        <p className="text-xs text-neutral-500 mb-4">
          guests who bought a pass here but aren't members yet. "send membership link" emails them a link to the join page with their details filled in.
        </p>

        {notice && (
          <p className={`text-xs mb-4 ${notice.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{notice.text}</p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-neutral-500"><Loader2 size={14} className="animate-spin" /> loading leads…</div>
        ) : error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : shown.length === 0 ? (
          <p className="text-xs text-neutral-500">no leads yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full text-xs text-left">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-white/[0.02]">
                <tr>
                  {['name', 'email', 'phone', 'first visit', 'last visit', 'visits', 'status', ''].map(h => (
                    <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(lead => (
                  <tr key={lead.guestProfileId} className="border-t border-white/5 text-neutral-300">
                    <td className="px-3 py-2 text-white whitespace-nowrap">{lead.name?.toLowerCase() || '—'}</td>
                    <td className="px-3 py-2">{lead.email ?? <span className="text-neutral-600">no email</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{lead.phone ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(lead.firstVisit)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(lead.lastVisit)}</td>
                    <td className="px-3 py-2">{lead.visitCount}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select
                          value={lead.status}
                          disabled={busyId === lead.guestProfileId}
                          onChange={e => setStatus(lead, e.target.value)}
                          className={`text-[11px] rounded-md border px-1.5 py-0.5 bg-transparent ${STATUS_STYLE[lead.status]}`}
                        >
                          <option value="new">new</option>
                          <option value="contacted">contacted</option>
                          <option value="converted">converted</option>
                        </select>
                      ) : (
                        <span className={`text-[11px] rounded-md border px-1.5 py-0.5 ${STATUS_STYLE[lead.status]}`}>{lead.status}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {canManage && lead.status !== 'converted' && (
                        <button
                          onClick={() => sendLink(lead)}
                          disabled={!lead.canSend || busyId === lead.guestProfileId}
                          title={lead.canSend ? undefined : 'no email on file'}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 disabled:opacity-40 transition-colors"
                        >
                          {busyId === lead.guestProfileId ? 'sending…' : 'send membership link'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
