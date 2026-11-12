'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Superadmin sign-in — the only place superadmin credentials are accepted
// (POST /api/admin/login). Gym staff use /login.
export default function AdminLoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  useEffect(() => { document.title = 'ironkey admin login' }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError((data.error ?? 'login failed.').toLowerCase()); return }
      localStorage.setItem('ik_admin_token', data.token)
      router.push('/admin')
    } catch {
      setError('unable to reach the server. please try again.')
    } finally {
      setLoading(false)
    }
  }

  const input = 'w-full bg-[#252525] border border-neutral-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors'

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#292929] px-4">
      <div className="w-full max-w-sm">
        <div className="bg-[#1c1c1c] rounded-2xl px-8 py-10 shadow-2xl ring-1 ring-white/5">
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white mb-3">
              <span className="text-[#1c1c1c] font-black text-lg tracking-tighter select-none">IK</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">ironkey</h1>
            <p className="text-xs text-neutral-500 mt-0.5">admin portal</p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="block text-[11px] font-semibold text-neutral-400 tracking-widest mb-1.5">email</label>
              <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" className={input} />
            </div>
            <div>
              <label htmlFor="password" className="block text-[11px] font-semibold text-neutral-400 tracking-widest mb-1.5">password</label>
              <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required autoComplete="current-password" className={input} />
            </div>
            {error && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3.5 py-2.5 leading-snug">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 bg-white text-[#1c1c1c] font-semibold rounded-lg py-2.5 text-sm hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'signing in…' : 'sign in'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
