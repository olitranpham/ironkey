'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

const KIND_LABEL = { guest_access: 'guest pass', member_access: 'membership' }

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

function who(job) {
  if (job.guestPass) return `${job.guestPass.guestName} · ${job.guestPass.guestEmail ?? 'no email'}`
  if (job.member)    return `${job.member.firstName} ${job.member.lastName} · ${job.member.email}`
  return '—'
}

/** Access jobs (Seam / Kisi / Zapier after a Stripe purchase) that are failing. */
export default function AccessJobsPage() {
  const { gymSlug } = useParams()
  const [jobs,     setJobs]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [retrying, setRetrying] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/${gymSlug}/webhook-jobs`, { headers: { Authorization: `Bearer ${localStorage.getItem('ik_token')}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${res.status}`)
      setJobs(json.jobs ?? [])
      setError(null)
    } catch (err) {
      setError(`could not load access issues (${err.message})`)
    } finally {
      setLoading(false)
    }
  }, [gymSlug])

  useEffect(() => { load() }, [load])

  async function retry(id) {
    setRetrying(id)
    try {
      const res = await fetch(`/api/${gymSlug}/webhook-jobs/${id}/retry`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('ik_token')}` } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `${res.status}`)
      setTimeout(load, 3000)   // give the retry a moment to run
    } catch (err) {
      setError(`retry failed: ${err.message}`)
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden">
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center justify-between px-6">
        <h1 className="text-sm font-semibold text-white">access issues</h1>
        <button onClick={load} className="text-neutral-400 hover:text-white" aria-label="refresh"><RefreshCw size={14} /></button>
      </header>
      <main className="p-5 flex flex-col gap-3 md:overflow-auto">
        <p className="text-xs text-neutral-500">
          door codes and emails that couldn&apos;t be sent after a purchase. ironkey retries these automatically; &ldquo;gave up&rdquo; rows need a manual retry.
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {loading ? (
          <p className="text-xs text-neutral-500">loading…</p>
        ) : !jobs.length ? (
          <p className="text-xs text-neutral-400">no access issues.</p>
        ) : (
          <div className="bg-white/[0.03] rounded-xl border border-white/5 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 border-b border-white/5">
                  <th className="px-3 py-2 font-medium">purchase</th>
                  <th className="px-3 py-2 font-medium">who</th>
                  <th className="px-3 py-2 font-medium">failed step</th>
                  <th className="px-3 py-2 font-medium">error</th>
                  <th className="px-3 py-2 font-medium">attempts</th>
                  <th className="px-3 py-2 font-medium">status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="border-b border-white/5 last:border-0 align-top">
                    <td className="px-3 py-2.5 text-neutral-300 whitespace-nowrap">{KIND_LABEL[j.kind] ?? j.kind}<br /><span className="text-neutral-500">{fmtDateTime(j.createdAt)}</span></td>
                    <td className="px-3 py-2.5 text-neutral-300">{who(j)}</td>
                    <td className="px-3 py-2.5 text-neutral-300">{j.failedStep ?? '—'}</td>
                    <td className="px-3 py-2.5 text-neutral-400 max-w-xs break-words">{j.lastError ?? '—'}</td>
                    <td className="px-3 py-2.5 text-neutral-300 tabular-nums">{j.attempts}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {j.status === 'failed'
                        ? <span className="text-red-400">gave up</span>
                        : <span className="text-amber-400">retrying {fmtDateTime(j.nextRunAt)}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => retry(j.id)}
                        disabled={retrying === j.id || j.status === 'running'}
                        className="px-2.5 py-1 rounded-lg border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 disabled:opacity-40"
                      >
                        {retrying === j.id ? 'retrying…' : 'retry now'}
                      </button>
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
