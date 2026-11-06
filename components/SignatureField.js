'use client'

import { SignatureText } from '@/components/SignatureText'
import { normalizeSignature, SIGNATURE_MISMATCH } from '@/lib/signature'

/**
 * Typed signature for a waiver / agreement: the statement (children), a
 * "type your full name to sign" input and a cursive preview. Shows the
 * mismatch error once something has been typed; the form disables submit
 * via signatureError() from lib/signature.
 *
 * @param {{ value: string, onChange: (v: string) => void, expectedName: string, children: React.ReactNode }} props
 */
export function SignatureField({ value, onChange, expectedName, children }) {
  const typed    = normalizeSignature(value)
  const mismatch = typed !== '' && typed !== normalizeSignature(expectedName)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-400 leading-relaxed">{children}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] text-neutral-500">type your full name to sign</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-invalid={mismatch}
          className={`w-full bg-neutral-700/50 border rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-1 transition-colors ${
            mismatch ? 'border-rose-500/60 focus:ring-rose-500/60' : 'border-neutral-600/50 focus:border-neutral-500 focus:ring-neutral-500'
          }`}
        />
      </label>
      <div className="min-h-[2.5rem] border-b border-neutral-700 px-1 flex items-end">
        {value.trim() && <SignatureText className="text-2xl text-white leading-none pb-1">{value.trim()}</SignatureText>}
      </div>
      {mismatch && <p className="text-xs text-rose-400">{SIGNATURE_MISMATCH}</p>}
    </div>
  )
}
