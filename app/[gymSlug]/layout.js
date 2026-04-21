'use client'

import { useState, useEffect, useLayoutEffect } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  Users,
  Ticket,
  KeyRound,
  CreditCard,
  AlertTriangle,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react'

const NAV_BASE = [
  { label: 'dashboard',    slug: 'dashboard',    icon: LayoutDashboard },
  { label: 'members',      slug: 'members',      icon: Users },
  { label: 'guest passes', slug: 'guest-passes', icon: Ticket },
  { label: 'payments',     slug: 'payments',     icon: CreditCard },
  { label: 'overdue',      slug: 'overdue',      icon: AlertTriangle, warn: true },
]


function gymInitials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export default function GymLayout({ children }) {
  const router   = useRouter()
  const params   = useParams()
  const pathname = usePathname()
  const gymSlug  = params.gymSlug

  const [collapsed,   setCollapsed]   = useState(false)
  const [mobileOpen,  setMobileOpen]  = useState(false)
  const [gymName,     setGymName]     = useState('')
  const [hasSeam,     setHasSeam]     = useState(false)

  // Set title synchronously before first paint — slug as immediate fallback,
  // then overwrite with real gym name from localStorage if available
  useLayoutEffect(() => {
    const slugTitle = gymSlug
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    try {
      const gym  = JSON.parse(localStorage.getItem('ik_gym') || '{}')
      // Only trust stored gym name if its slug matches the current URL
      const name = (gym.slug === gymSlug && gym.name) ? gym.name : slugTitle
      document.title = `${name.toLowerCase()} - staff portal`
    } catch {
      document.title = `${slugTitle.toLowerCase()} - staff portal`
    }
  }, [gymSlug])

  useEffect(() => {
    const token = localStorage.getItem('ik_token')
    if (!token) { router.replace('/login'); return }

    // Fetch gym config from API — authoritative source for name and Seam flag.
    // This also avoids showing a stale gym name if localStorage belongs to a
    // different gym (e.g. after admin opens a portal for a different gym).
    fetch(`/api/${gymSlug}/gym`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(({ gym }) => {
        if (!gym) return
        const name = gym.name.toLowerCase()
        setGymName(name)
        setHasSeam(Boolean(gym.hasSeam))
        document.title = `${name} - staff portal`
        // Keep localStorage in sync with what the API says
        localStorage.setItem('ik_gym', JSON.stringify({ id: gym.id, name: gym.name, slug: gym.slug }))
      })
      .catch(() => {
        // Fall back to URL slug on error
        setGymName(gymSlug.toLowerCase())
      })
  }, [gymSlug, router])

  const isActive = (slug) => pathname === `/${gymSlug}/${slug}`

  return (
    <div className="flex h-screen overflow-hidden bg-[#292929]">

      {/* ── Mobile backdrop ───────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col bg-[#1c1c1c] border-r border-neutral-800
          transition-all duration-200
          md:relative md:z-auto md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          ${collapsed ? 'md:w-[60px]' : 'md:w-56'}
          w-56
        `}
      >
        {/* Header: badge + gym name + collapse toggle */}
        <div className="flex items-center border-b border-neutral-800 h-14 px-3 gap-2.5">
          {!collapsed && (
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white shrink-0">
              <span className="text-[#1c1c1c] font-black text-[11px] tracking-tighter select-none">
                {gymInitials(gymName) || '??'}
              </span>
            </div>
          )}

          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold text-sm truncate leading-tight">{gymName}</p>
              <p className="text-neutral-500 text-[11px] leading-tight">staff portal</p>
            </div>
          )}

          {/* Mobile close button */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden shrink-0 flex items-center justify-center rounded-lg p-1.5 text-neutral-600 hover:text-neutral-300 hover:bg-white/5 transition-colors ml-auto"
          >
            <X size={14} />
          </button>

          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'expand sidebar' : 'collapse sidebar'}
            className={`
              hidden md:flex shrink-0 items-center justify-center rounded-lg p-1.5
              text-neutral-600 hover:text-neutral-300 hover:bg-white/5 transition-colors
              ${collapsed ? 'mx-auto' : 'ml-auto'}
            `}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-hidden">
          {[
              NAV_BASE[0],
              ...(hasSeam ? [{ label: 'door access', slug: 'door-access', icon: KeyRound }] : []),
              ...NAV_BASE.slice(1),
            ].map(({ label, slug, icon: Icon, warn }) => {
            const active = isActive(slug)
            return (
              <Link
                key={slug}
                href={`/${gymSlug}/${slug}`}
                title={collapsed ? label : undefined}
                className={`
                  flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors
                  ${collapsed ? 'justify-center' : ''}
                  ${active
                    ? 'bg-white/10 text-white'
                    : warn
                      ? 'text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/5'
                      : 'text-neutral-400 hover:text-white hover:bg-white/5'
                  }
                `}
              >
                <Icon size={16} className="shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Settings + Logout */}
        <div className="px-2 pb-2 space-y-0.5">
          <Link
            href={`/${gymSlug}/settings`}
            title={collapsed ? 'settings' : undefined}
            className={`
              flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors
              ${collapsed ? 'justify-center' : ''}
              ${isActive('settings')
                ? 'bg-white/10 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }
            `}
          >
            <Settings size={16} className="shrink-0" />
            {!collapsed && <span className="truncate">settings</span>}
          </Link>

          <button
            onClick={() => {
              localStorage.removeItem('ik_token')
              localStorage.removeItem('ik_gym')
              router.replace('/login')
            }}
            title={collapsed ? 'log out' : undefined}
            className={`
              w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors
              ${collapsed ? 'justify-center' : ''}
              text-neutral-400 hover:text-white hover:bg-white/5
            `}
          >
            <LogOut size={16} className="shrink-0" />
            {!collapsed && <span className="truncate">log out</span>}
          </button>
        </div>

        {/* Footer */}
        {!collapsed && (
          <div className="border-t border-neutral-800 px-2 py-3">
            <p className="text-center text-[11px] text-neutral-600">
              powered by <span className="text-neutral-500 font-medium">ironkey</span>
            </p>
          </div>
        )}
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 bg-[#1c1c1c] border-b border-neutral-800 h-14 flex items-center px-4 gap-3 shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Menu size={18} />
          </button>
          <span className="text-white text-sm font-semibold">{gymName}</span>
        </div>
        {children}
      </div>

    </div>
  )
}
