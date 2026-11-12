'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CreditCard, RefreshCw, Copy, Mail, Check, Loader2 } from 'lucide-react'
import { DrawerSection, DrawerField } from '@/components/MemberProfileDrawer'
import ConfirmModal from '@/components/ConfirmModal'

function auth() {
  return { Authorization: `Bearer ${localStorage.getItem('ik_token')}` }
}

function formatCard(card) {
  const exp = `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
  return `${card.brand} •••• ${card.last4} · exp ${exp}`
}

function formatExpiry(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

/**
 * Member drawer: card on file + "update payment method". Staff never enter
 * card details — the button makes a Stripe setup link for the member (copy
 * it, or email it when Resend is configured). The webhook saves the card and
 * retries any overdue invoice. Hidden without members.edit.
 */
export default function PaymentMethodSection({ gymSlug, member }) {
  const [info,    setInfo]    = useState(null)   // { card, hasCustomer, emailEnabled } | null while loading
  const [hidden,  setHidden]  = useState(false)
  const [loadErr, setLoadErr] = useState(null)

  const [modal,   setModal]   = useState(null)   // { url, sessionId, expiresAt } | {} while creating
  const [busy,    setBusy]    = useState(null)   // 'create' | 'email' | null
  const [error,   setError]   = useState(null)
  const [copied,  setCopied]  = useState(false)
  const [emailed, setEmailed] = useState(false)

  const load = useCallback(async () => {
    setLoadErr(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/members/${member.id}/payment-method`, { headers: auth() })
      const json = await res.json().catch(() => ({}))
      if (res.status === 403) { setHidden(true); return }
      if (!res.ok) throw new Error(json.error ?? "couldn't load the card on file")
      setInfo(json)
    } catch (err) {
      setLoadErr(err.message)
    }
  }, [gymSlug, member.id])

  useEffect(() => { setInfo(null); load() }, [load])

  async function openModal() {
    setModal({})
    setError(null)
    setCopied(false)
    setEmailed(false)
    setBusy('create')
    try {
      const res  = await fetch(`/api/${gymSlug}/members/${member.id}/payment-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: '{}',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "couldn't make a link")
      setModal(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(modal.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("couldn't copy — select the link and copy it")
    }
  }

  async function emailLink() {
    setError(null)
    setBusy('email')
    try {
      const res  = await fetch(`/api/${gymSlug}/members/${member.id}/payment-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ sessionId: modal.sessionId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "couldn't send the email")
      setEmailed(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  function closeModal() {
    setModal(null)
    load()   // the member may already have used the link
  }

  if (hidden) return null

  const noCustomer = info && !info.hasCustomer

  return (
    <DrawerSection icon={CreditCard} title="payment method">
      <DrawerField label="card on file">
        <div className="flex items-center gap-2 ml-4 min-w-0">
          <span className="text-xs text-white truncate">
            {loadErr ? <span className="text-red-400">{loadErr}</span>
              : !info ? <span className="text-neutral-600">loading…</span>
              : info.card ? formatCard(info.card)
              : 'no payment method on file'}
          </span>
          <button onClick={load} aria-label="refresh card" className="text-neutral-500 hover:text-white transition-colors shrink-0">
            <RefreshCw size={11} />
          </button>
        </div>
      </DrawerField>
      <div className="px-3 py-2.5 bg-[#1c1c1c]">
        <span className="relative inline-flex group">
          <button
            onClick={openModal}
            disabled={!info || noCustomer}
            className="text-[11px] px-2.5 py-1.5 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            update payment method
          </button>
          {noCustomer && (
            <span
              role="tooltip"
              className="pointer-events-none absolute left-0 top-full mt-1.5 z-20 whitespace-nowrap rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              no stripe customer linked to this member
            </span>
          )}
        </span>
      </div>

      {/* Portal: the drawer is transformed, which would trap a fixed modal inside it */}
      {modal && createPortal(
        <ConfirmModal
          title="update payment method"
          subtitle={`${member.firstName} ${member.lastName}`}
          error={error}
          loading={busy !== null}
          cancelLabel="close"
          onClose={closeModal}
        >
          {busy === 'create' && !modal.url ? (
            <p className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> making a secure stripe link…</p>
          ) : modal.url ? (
            <div className="flex flex-col gap-3">
              <p>send the member this stripe link to save a new card. any overdue balance is retried with it once it's saved.</p>
              <input
                readOnly
                value={modal.url}
                onFocus={e => e.target.select()}
                className="w-full bg-[#252525] border border-neutral-700 rounded px-2 py-1.5 text-[11px] text-white font-mono focus:outline-none"
              />
              <p className="text-neutral-500">link expires {formatExpiry(modal.expiresAt)}</p>
              <div className="flex gap-2">
                <button
                  onClick={copyLink}
                  className="flex-1 py-2 rounded-lg text-xs font-medium bg-white text-black hover:bg-neutral-200 transition-colors flex items-center justify-center gap-1.5"
                >
                  {copied ? <><Check size={12} /> copied</> : <><Copy size={12} /> copy link</>}
                </button>
                {info?.emailEnabled && (
                  <button
                    onClick={emailLink}
                    disabled={busy !== null || emailed}
                    className="flex-1 py-2 rounded-lg text-xs font-medium bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {busy === 'email' ? <><Loader2 size={12} className="animate-spin" /> sending…</>
                      : emailed ? <><Check size={12} /> emailed</>
                      : <><Mail size={12} /> email link to member</>}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </ConfirmModal>,
        document.body,
      )}
    </DrawerSection>
  )
}
