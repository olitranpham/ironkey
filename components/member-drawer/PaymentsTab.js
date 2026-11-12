'use client'

import { useState, useEffect, useCallback } from 'react'
import { CreditCard, Receipt } from 'lucide-react'
import PaymentMethodSection from '@/components/PaymentMethodSection'
import { DrawerSection, DrawerField } from '@/components/DrawerParts'
import { EditableRow, ListState, money, fmtDate } from '@/components/member-drawer/fields'
import { requestError } from '@/lib/requestError'

const STATUS_CLS = {
  paid:          'text-emerald-400',
  open:          'text-amber-400',
  uncollectible: 'text-red-400',
  void:          'text-neutral-500',
  draft:         'text-neutral-500',
}

/**
 * Payments: card on file + update payment method (PaymentMethodSection),
 * the member's Stripe subscription / customer ids (editable — the PATCH
 * route itself requires billing.act to change them), and the last 12
 * invoices. Retry is shown only to users with billing.act.
 */
export default function PaymentsTab({ member, gymSlug, perms, save }) {
  const [invoices, setInvoices] = useState(null)   // null = loading
  const [loadError, setLoadError] = useState(null)
  const [retrying, setRetrying] = useState(null)   // invoice id
  const [retryResult, setRetryResult] = useState(null) // { id, ok, text }
  const canRetry = perms.has('billing.act')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/members/${member.id}/invoices`, { headers: { Authorization: `Bearer ${localStorage.getItem('ik_token')}` } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(requestError(res, json))
      setInvoices(json.invoices ?? [])
    } catch (err) {
      setInvoices([])
      setLoadError(err.message)
    }
  }, [gymSlug, member.id])

  useEffect(() => { setInvoices(null); setRetryResult(null); load() }, [load, member.stripeCustomerId])

  async function retry(inv) {
    setRetrying(inv.id)
    setRetryResult(null)
    try {
      const res  = await fetch(`/api/${gymSlug}/stripe/retry`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ik_token')}` },
        body:    JSON.stringify({ invoiceId: inv.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(requestError(res, json))
      setRetryResult({ id: inv.id, ok: json.invoice?.status === 'paid', text: json.invoice?.status === 'paid' ? 'paid' : `still ${json.invoice?.status ?? 'unpaid'}` })
      load()
    } catch (err) {
      setRetryResult({ id: inv.id, ok: false, text: err.message })
    } finally {
      setRetrying(null)
    }
  }

  // The PATCH route only lets billing.act change these — read-only for everyone else
  const canEditIds = perms.has('billing.act')

  return (
    <>
      <PaymentMethodSection gymSlug={gymSlug} member={member} />

      {/* Billing ids — moved from the old payments panel */}
      <DrawerSection icon={CreditCard} title="billing">
        {canEditIds ? (
          <>
            <EditableRow label="subscription" value={member.stripeSubscriptionId} onSave={v => save({ stripeSubscriptionId: v })} mono />
            <EditableRow label="customer" value={member.stripeCustomerId} onSave={v => save({ stripeCustomerId: v })} mono />
          </>
        ) : (
          <>
            <DrawerField label="subscription" value={member.stripeSubscriptionId} mono />
            <DrawerField label="customer" value={member.stripeCustomerId} mono />
          </>
        )}
      </DrawerSection>

      <DrawerSection icon={Receipt} title="invoices">
        {loadError ? (
          <div className="px-3 py-2.5 bg-[#1c1c1c]"><span className="text-xs text-red-400">{loadError}</span></div>
        ) : (
          <ListState rows={invoices} empty={member.stripeCustomerId ? 'no invoices' : 'no stripe customer linked'}>
            {invoices?.map(inv => (
              <div key={inv.id} className="px-3 py-2.5 bg-[#1c1c1c] space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-white truncate">
                      {inv.hostedInvoiceUrl
                        ? <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{inv.number ?? 'invoice'}</a>
                        : (inv.number ?? 'invoice')}
                    </p>
                    <p className="text-[11px] text-neutral-500">{fmtDate(inv.created)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-white">{money(inv.status === 'paid' ? inv.amountPaid : inv.amountDue, inv.currency)}</span>
                    <span className={`text-[11px] ${STATUS_CLS[inv.status] ?? 'text-neutral-400'}`}>{inv.status}</span>
                    {canRetry && inv.status === 'open' && (
                      <button
                        onClick={() => retry(inv)}
                        disabled={retrying !== null}
                        className="text-[10px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                      >
                        {retrying === inv.id ? '…' : 'retry'}
                      </button>
                    )}
                  </div>
                </div>
                {retryResult?.id === inv.id && (
                  <p className={`text-[11px] ${retryResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{retryResult.text}</p>
                )}
              </div>
            ))}
          </ListState>
        )}
      </DrawerSection>
    </>
  )
}
