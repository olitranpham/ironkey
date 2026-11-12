'use client'

import { useEffect } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

// Shared in-app confirm dialog (dashboard card styling). Closes on Esc, a
// backdrop click or the cancel button — never while `loading`. Errors render
// inside the card. Omit `onConfirm` for an info-only dialog (cancel only).
export default function ConfirmModal({
  title,
  subtitle = null,
  children,
  error = null,
  loading = false,
  confirmLabel = 'confirm',
  confirmClassName = 'bg-white text-black hover:bg-neutral-200',
  cancelLabel = 'cancel',
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={!loading ? onClose : undefined} />

      {/* Card */}
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-neutral-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
          </div>
        </div>

        <div className="text-xs text-neutral-400 mb-5">{children}</div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2 rounded-lg text-xs font-medium text-neutral-400 border border-neutral-700 hover:text-white hover:border-neutral-600 disabled:opacity-40 transition-colors"
          >
            {cancelLabel}
          </button>
          {onConfirm && (
            <button
              onClick={() => onConfirm()}
              disabled={loading}
              className={`flex-1 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5 ${confirmClassName}`}
            >
              {loading ? <><Loader2 size={12} className="animate-spin" /> please wait…</> : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
