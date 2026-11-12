// Section + row building blocks shared by the member drawer and other
// per-record panels (overdue page, payment method section).

export function DrawerSection({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={11} className="text-neutral-500" />
        <p className="text-[11px] font-semibold tracking-widest text-neutral-500">{title.toUpperCase()}</p>
      </div>
      <div className="rounded-lg border border-neutral-800 divide-y divide-neutral-800 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

export function DrawerField({ label, value, mono = false, children }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[#1c1c1c]">
      <span className="text-xs text-zinc-400 shrink-0">{label}</span>
      {children ?? (
        <span className={`text-xs text-white text-right ml-4 truncate max-w-[240px] ${mono ? 'font-mono text-[11px]' : ''}`}>
          {value || '—'}
        </span>
      )}
    </div>
  )
}
