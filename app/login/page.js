'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [step,     setStep]     = useState('credentials') // 'credentials' | 'pick-gym'
  const [gyms,     setGyms]     = useState([])
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  useEffect(() => { document.title = 'ironkey staff login' }, [])

  useEffect(() => {
    const err = searchParams.get('error')
    if (err === 'not_authorized') setError('no account found for that email.')
    else if (err)                 setError('sign-in failed — please try again.')
  }, [searchParams])

  function storeAndRedirect(data) {
    localStorage.setItem('ik_token', data.token)
    localStorage.setItem('ik_gym',   JSON.stringify(data.gym))
    localStorage.setItem('ik_role',  data.role)
    router.push(`/${data.gym.slug}/dashboard`)
  }

  async function submitCredentials(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'login failed.'); return }

      if (data.superadmin) {
        localStorage.setItem('ik_admin_token', data.token)
        router.push('/admin')
        return
      }

      if (data.multipleGyms) {
        setGyms(data.gyms)
        setStep('pick-gym')
      } else {
        storeAndRedirect(data)
      }
    } catch {
      setError('unable to reach the server. please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function pickGym(slug) {
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password, gymSlug: slug }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'login failed.'); return }
      storeAndRedirect(data)
    } catch {
      setError('unable to reach the server. please try again.')
    } finally {
      setLoading(false)
    }
  }

  function gymInitials(name) {
    return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase()
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#292929] px-4">
      <div className="w-full max-w-sm">

        <div className="bg-[#1c1c1c] rounded-2xl px-8 py-10 shadow-2xl ring-1 ring-white/5">

          {/* ── Logo ─────────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white mb-3">
              <span className="text-[#1c1c1c] font-black text-lg tracking-tighter select-none">IK</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">ironkey</h1>
            <p className="text-xs text-neutral-500 mt-0.5">staff portal</p>
          </div>

          {step === 'credentials' ? (
            <form onSubmit={submitCredentials} className="space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="block text-[11px] font-semibold text-neutral-400 tracking-widest mb-1.5">
                  email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@gym.com"
                  required
                  autoComplete="email"
                  className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-[11px] font-semibold text-neutral-400 tracking-widest mb-1.5">
                  password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full bg-[#252525] border border-neutral-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 transition-colors"
                />
              </div>
              {error && (
                <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3.5 py-2.5 leading-snug">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-1 bg-white text-[#1c1c1c] font-semibold rounded-lg py-2.5 text-sm hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'signing in…' : 'sign in'}
              </button>
            </form>
          ) : (
            <>
              <p className="text-xs text-neutral-500 mb-4 text-center">
                your email is linked to multiple gyms — choose one
              </p>
              <div className="space-y-2">
                {gyms.map(gym => (
                  <button
                    key={gym.slug}
                    onClick={() => pickGym(gym.slug)}
                    disabled={loading}
                    className="w-full flex items-center gap-3 bg-[#252525] hover:bg-[#2e2e2e] border border-neutral-800 hover:border-neutral-700 rounded-xl px-4 py-3 transition-colors disabled:opacity-40 text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0">
                      <span className="text-[#1c1c1c] font-black text-[11px] tracking-tighter select-none">
                        {gymInitials(gym.name)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{gym.name.toLowerCase()}</p>
                      <p className="text-[11px] text-neutral-600">{gym.slug}</p>
                    </div>
                  </button>
                ))}
              </div>
              {error && (
                <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3.5 py-2.5 mt-4 leading-snug">
                  {error}
                </p>
              )}
              <button
                onClick={() => { setStep('credentials'); setError('') }}
                className="w-full mt-4 text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
              >
                ← back
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-neutral-600 mt-5">
          need access? contact{' '}
          <a href="mailto:admin@ironkeyentry.com" className="text-neutral-500 hover:text-neutral-400 transition-colors">
            admin@ironkeyentry.com
          </a>
        </p>

      </div>
    </main>
  )
}

export default function LoginPageWrapper() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  )
}
