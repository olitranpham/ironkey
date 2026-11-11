import { Download, Loader2 } from 'lucide-react'

// Shared icon-only "export csv" button (members, guest passes) — white, the
// same 28px height as the header's "add member" button, with a hover tooltip.
// `busy` swaps the icon for a spinner while an export is in progress.
export default function ExportButton({ onClick, disabled = false, busy = false }) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        aria-label="export csv"
        className="h-7 w-7 flex items-center justify-center rounded-lg bg-white text-black hover:bg-neutral-200 disabled:opacity-40 transition-colors"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full mt-1.5 z-20 whitespace-nowrap rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100"
      >
        export csv
      </span>
    </span>
  )
}
