'use client'

import { SignatureText } from '@/components/SignatureText'

function fmtSigned(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).toLowerCase()
}

/**
 * The signed waiver / agreement for one person at this gym.
 *
 * - typed signature on file → the signature in the cursive font + signed date
 * - a record from before typed signatures → "accepted (checkbox)" + date
 * - no record → "no agreement on file"
 *
 * @param {{
 *   onFile: boolean,             // a waiver / agreement record exists
 *   signatureName?: string|null, // typed signature (null on checkbox-era records)
 *   signedAt?: string|null,
 *   signedByGuardian?: boolean,  // a minor — the guardian signed
 * }} props
 */
export function AgreementSection({ onFile, signatureName, signedAt, signedByGuardian }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold tracking-widest text-neutral-500">agreement</p>
      <div className="rounded-lg border border-neutral-800 bg-[#1c1c1c] px-3 py-3 flex flex-col gap-1.5">
        {!onFile ? (
          <p className="text-xs text-neutral-500">no agreement on file</p>
        ) : signatureName ? (
          <>
            <SignatureText className="text-2xl text-white leading-tight">{signatureName}</SignatureText>
            <p className="text-[11px] text-neutral-500">
              {signedByGuardian ? 'signed by parent/guardian' : 'signed'}
              {signedAt && <> · {fmtSigned(signedAt)}</>}
            </p>
          </>
        ) : (
          <p className="text-xs text-neutral-400">
            accepted (checkbox)
            {signedAt && <span className="text-neutral-500"> · {fmtSigned(signedAt)}</span>}
          </p>
        )}
      </div>
    </div>
  )
}
