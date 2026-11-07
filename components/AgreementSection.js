'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { SignatureText, signatureFontFamily } from '@/components/SignatureText'

function fmtSigned(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).toLowerCase()
}

/** The signature drawn in the signature font, as a PNG data URL (null if the canvas fails). */
async function signatureImage(name) {
  try {
    const font = `500 64px ${signatureFontFamily}`
    await document.fonts.load(font)
    const canvas = document.createElement('canvas')
    const ctx    = canvas.getContext('2d')
    ctx.font     = font
    canvas.width  = Math.ceil(ctx.measureText(name).width) + 24
    canvas.height = 96
    ctx.font         = font
    ctx.fillStyle    = '#000'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, 12, 48)
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

/** "accepted via checkbox on <date>, backfilled" — a checkbox-era record added later, never a signature. */
function backfilledLine(signedAt) {
  const day = signedAt ? new Date(signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase() : 'an unknown date'
  return `accepted via checkbox on ${day}, backfilled`
}

async function downloadPdf({ gymName, personName, text, version, signatureName, signedAt, signedByGuardian, source }) {
  const { jsPDF } = await import('jspdf')
  const doc    = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 54
  const width  = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  let y = margin

  const ensure = h => { if (y + h > bottom) { doc.addPage(); y = margin } }

  doc.setFont('helvetica', 'bold').setFontSize(14)
  doc.text(gymName || 'signed agreement', margin, y); y += 18
  doc.setFont('helvetica', 'normal').setFontSize(10)
  doc.text(`signed agreement — ${personName}`, margin, y); y += 24

  doc.setFontSize(9.5)
  for (const line of doc.splitTextToSize(text, width)) {
    ensure(13)
    doc.text(line, margin, y); y += 13
  }

  y += 24
  ensure(110)
  if (!signatureName && source === 'checkbox_backfill') {
    // No signature exists — say how the record was made instead of drawing a signature line
    doc.setFontSize(10).text(backfilledLine(signedAt), margin, y); y += 14
    doc.setFontSize(9).text('recorded from the join checkout and the agreement text live on that date; no signature was collected', margin, y); y += 12
    if (version) { doc.text(`agreement version: ${version}`, margin, y); y += 12 }
    const day  = signedAt ? new Date(signedAt).toISOString().slice(0, 10) : 'undated'
    const slug = String(personName || 'agreement').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    doc.save(`agreement-${slug}-${day}.pdf`)
    return
  }
  doc.setFontSize(10).text(signedByGuardian ? 'signature (parent/guardian)' : 'signature', margin, y); y += 8
  const img = signatureName ? await signatureImage(signatureName) : null
  if (img) {
    const h = 40, w = Math.min(width, img.width * (h / img.height))
    doc.addImage(img.dataUrl, 'PNG', margin, y, w, h); y += h + 6
  } else if (signatureName) {
    doc.setFont('times', 'italic').setFontSize(20).text(signatureName, margin, y + 22); y += 32
    doc.setFont('helvetica', 'normal')
  }
  doc.setDrawColor(160).line(margin, y, margin + 260, y); y += 14
  doc.setFontSize(9)
  if (signatureName) { doc.text(`signed by: ${signatureName}`, margin, y); y += 12 }
  if (signedAt)      { doc.text(`signed at: ${new Date(signedAt).toISOString()} (${fmtSigned(signedAt)})`, margin, y); y += 12 }
  if (version)       { doc.text(`agreement version: ${version}`, margin, y); y += 12 }

  const day  = signedAt ? new Date(signedAt).toISOString().slice(0, 10) : 'undated'
  const slug = String(personName || 'agreement').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  doc.save(`agreement-${slug}-${day}.pdf`)
}

/**
 * The signed waiver / agreement for one person at this gym.
 *
 * - typed signature on file → the signature in the cursive font + signed date
 * - a record from before typed signatures → "accepted (checkbox)" + date
 * - source "checkbox_backfill" → "accepted via checkbox on <date>, backfilled"
 *   (recorded later; never shown as a signature)
 * - source "payment_link_pending" → "agreement pending" (bought through a
 *   payment link, nothing signed)
 * - no record → "no agreement on file"
 * - "view" / "download pdf" only when the signed text was snapshotted
 *
 * @param {{
 *   onFile: boolean,             // a waiver / agreement record exists
 *   gymName?: string|null,
 *   personName?: string,         // for the pdf heading / filename
 *   signatureName?: string|null, // typed signature (null on checkbox-era records)
 *   signedAt?: string|null,
 *   signedByGuardian?: boolean,  // a minor — the guardian signed
 *   text?: string|null,          // snapshotted agreement text (null on older records)
 *   version?: string|null,
 *   source?: string|null,        // Member.agreementSource / GuestWaiver.waiverSource
 * }} props
 */
export function AgreementSection({ onFile, gymName, personName, signatureName, signedAt, signedByGuardian, text, version, source }) {
  const [viewing,     setViewing]     = useState(false)
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadPdf({ gymName, personName, text, version, signatureName, signedAt, signedByGuardian, source })
    } catch (err) {
      console.error('[agreement] pdf failed:', err.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold tracking-widest text-neutral-500">agreement</p>
      <div className="rounded-lg border border-neutral-800 bg-[#1c1c1c] px-3 py-3 flex flex-col gap-1.5">
        {gymName && <p className="text-[11px] text-neutral-500">{gymName.toLowerCase()}</p>}
        {!onFile && source === 'payment_link_pending' ? (
          <p className="text-xs text-amber-400">agreement pending — bought through a payment link, not signed yet</p>
        ) : !onFile ? (
          <p className="text-xs text-neutral-500">no agreement on file</p>
        ) : signatureName ? (
          <>
            <SignatureText className="text-2xl text-white leading-tight">{signatureName}</SignatureText>
            <p className="text-[11px] text-neutral-500">
              {signedByGuardian ? 'signed by parent/guardian' : 'signed'}
              {signedAt && <> · {fmtSigned(signedAt)}</>}
            </p>
          </>
        ) : source === 'checkbox_backfill' ? (
          <p className="text-xs text-neutral-400">{backfilledLine(signedAt)}</p>
        ) : (
          <p className="text-xs text-neutral-400">
            accepted (checkbox)
            {signedAt && <span className="text-neutral-500"> · {fmtSigned(signedAt)}</span>}
          </p>
        )}
        {onFile && text && (
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={() => setViewing(true)} className="text-[11px] text-neutral-300 underline underline-offset-2 hover:text-white">
              view
            </button>
            <button type="button" onClick={handleDownload} disabled={downloading} className="text-[11px] text-neutral-300 underline underline-offset-2 hover:text-white disabled:opacity-40">
              {downloading ? 'preparing…' : 'download pdf'}
            </button>
          </div>
        )}
      </div>

      {viewing && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setViewing(false)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-neutral-800 bg-[#161616]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-800 shrink-0">
              <p className="text-sm font-semibold text-white">{gymName ? `${gymName.toLowerCase()} — signed agreement` : 'signed agreement'}</p>
              <button type="button" onClick={() => setViewing(false)} className="text-neutral-500 hover:text-white"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <p className="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap">{text}</p>
              <div className="mt-6 border-t border-neutral-800 pt-4 flex flex-col gap-1">
                {signatureName && <SignatureText className="text-3xl text-white">{signatureName}</SignatureText>}
                <p className="text-[11px] text-neutral-500">
                  {!signatureName && source === 'checkbox_backfill'
                    ? backfilledLine(signedAt)
                    : <>{signedByGuardian ? 'signed by parent/guardian' : 'signed'}{signedAt && <> · {fmtSigned(signedAt)}</>}</>}
                  {version && <> · version {version}</>}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
