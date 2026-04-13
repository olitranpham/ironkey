'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()

  const [gymSlug, setGymSlug]   = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  function handleSlugChange(e) {
    // Normalise on the way in: lowercase, spaces → hyphens
    setGymSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gymSlug, email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Login failed. Please check your credentials.')
        return
      }

      localStorage.setItem('ik_token', data.token)
      localStorage.setItem('ik_gym',   JSON.stringify(data.gym))
      localStorage.setItem('ik_role',  data.role)

      router.push(`/${data.gym.slug}/dashboard`)
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#292929] px-4">
      <div className="w-full max-w-sm">

        {/* ── Card ─────────────────────────────────────────────────────── */}
        <div className="bg-[#1c1c1c] rounded-2xl px-8 py-10 shadow-2xl ring-1 ring-white/5">

          {/* ── Logo ───────────────────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white mb-3">
              <span className="text-[#1c1c1c] font-black text-lg tracking-tighter select-none">
                IK
              </span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">ironkey</h1>
            <p className="text-xs text-neutral-500 mt-0.5">staff portal</p>
          </div>

          {/* ── Form ───────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* Gym slug */}
            <div>
              <label
                htmlFor="gymSlug"
                className="block text-[11px] font-semibold text-neutral-400 tracking-widest mb-1.5"
              >
                gym
              </label>
              <input
                id="gymSlug"
                type="text"
                value={gymSlug}
                onChange={handleSlugChange}
                placeholder="your-gym"
                required
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                className="
                  w-full bg-[#252525] border border-neutral-700 rounded-lg
                  px-3.5 py-2.5 text-sm text-white placeholder-neutral-600
                  focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500
                  transition-colors
                "
              />
            </div>

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-[11px] font-semibold text-neutral-400 tracking-widest mb-1.5"
              >
                email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@gym.com"
                required
                autoComplete="email"
                className="
                  w-full bg-[#252525] border border-neutral-700 rounded-lg
                  px-3.5 py-2.5 text-sm text-white placeholder-neutral-600
                  focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500
                  transition-colors
                "
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-[11px] font-semibold text-neutral-400 tracking-widest mb-1.5"
              >
                password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="
                  w-full bg-[#252525] border border-neutral-700 rounded-lg
                  px-3.5 py-2.5 text-sm text-white placeholder-neutral-600
                  focus:outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500
                  transition-colors
                "
              />
            </div>

            {/* Error message */}
            {error && (
              <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3.5 py-2.5 leading-snug">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="
                w-full mt-1 bg-white text-[#1c1c1c] font-semibold rounded-lg
                py-2.5 text-sm
                hover:bg-neutral-100 active:bg-neutral-200
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors
              "
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

          </form>
        </div>

        {/* ── Footer note ──────────────────────────────────────────────── */}
        <p className="text-center text-xs text-neutral-600 mt-5">
          Need access?{' '}
          <span className="text-neutral-500">Contact your gym administrator.</span>
        </p>

      </div>
    </main>
  )
}
