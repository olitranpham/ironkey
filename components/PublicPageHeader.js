// Shared header for all public-facing gym pages (join, guest, concessions,
// membership) — gym logo if set, otherwise the gym name as text. Each page
// still fetches its own gym info (different endpoints return different extra
// data), this just renders it consistently.
export default function PublicPageHeader({ gymLogo, gymName }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 mb-8">
      {gymLogo && (
        <img src={gymLogo} alt={gymName} className="w-24 h-24 object-contain" />
      )}
      {!gymLogo && <h1 className="text-xl font-bold text-white">{gymName}</h1>}
    </div>
  )
}
