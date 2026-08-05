// Shared styling primitives for public-facing gym pages (join, guest,
// concessions, membership) — one source of truth instead of each page
// copy-pasting (and drifting from) the same class strings.

export function Field({ label, required, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-neutral-300 tracking-wide">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export function SectionDivider({ label }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 border-t border-white/8" />
      <span className="text-[10px] font-semibold tracking-widest text-neutral-600 uppercase">{label}</span>
      <div className="flex-1 border-t border-white/8" />
    </div>
  )
}

export const INPUT  = "w-full bg-[#242424] border border-neutral-700/60 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-neutral-500 transition-all duration-150"
export const SELECT = "w-full bg-[#242424] border border-neutral-700/60 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/10 focus:border-neutral-500 transition-all duration-150 appearance-none"

// Primary CTA button (submit / continue / checkout). Compose with your own
// margin utilities where needed (e.g. `${BUTTON_PRIMARY} mt-1`).
export const BUTTON_PRIMARY = "w-full py-3.5 rounded-xl text-sm font-semibold bg-white text-[#1c1c1c] hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2"

// Main content/form card — the page's primary container.
export const CARD = "bg-[#1c1c1c] border border-white/10 rounded-2xl shadow-2xl"
