'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, ChevronDown, X, Plus, Trash2, RefreshCw, Search } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PT_COLORS = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b',
  '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6',
]

const MONTHS = [
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
]

const MONTHS_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const WEEKDAYS_SHORT = ['sun','mon','tue','wed','thu','fri','sat']
const DAYS = ['su','mo','tu','we','th','fr','sa']

const START_HOUR  = 6   // 6 AM
const END_HOUR    = 21  // 9 PM
const ROW_HEIGHT  = 56  // px per hour
const HOURS_SHOWN = END_HOUR - START_HOUR
const HOUR_LIST   = Array.from({ length: HOURS_SHOWN }, (_, i) => START_HOUR + i)

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
}

function fmtHour(h) {
  if (h === 0)  return '12 am'
  if (h === 12) return '12 pm'
  return h < 12 ? `${h} am` : `${h - 12} pm`
}

function isoDateLocal(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}

function getWeekStart(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function buildCalendarGrid(year, month) {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function sessionsForDay(sessions, year, month, day) {
  return sessions.filter(s => {
    const d = new Date(s.date)
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
  })
}

function memberNames(session) {
  return (session.members ?? []).map(m => `${m.firstName} ${m.lastName}`).join(', ') || '—'
}

function memberNamesShort(session) {
  const ms = session.members ?? []
  if (ms.length === 0) return '—'
  if (ms.length === 1) return `${ms[0].firstName} ${ms[0].lastName[0]}.`
  return `${ms[0].firstName} ${ms[0].lastName[0]}. +${ms.length - 1}`
}

function formatViewHeader(view, calDate) {
  if (view === 'day') {
    return calDate.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).toLowerCase()
  }
  if (view === 'week') {
    const start = getWeekStart(calDate)
    const end   = addDays(start, 6)
    const s = `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}`
    const e = `${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
    return `${s} – ${e}`
  }
  return `${MONTHS[calDate.getMonth()]} ${calDate.getFullYear()}`
}

// ── Member multi-select ───────────────────────────────────────────────────────

function PTMemberMultiSelect({ members, selected, onChange }) {
  const [query,    setQuery]    = useState('')
  const [open,     setOpen]     = useState(false)
  const containerRef            = useRef(null)
  const inputRef                = useRef(null)

  const selectedIds = new Set(selected.map(m => m.id))

  const filtered = members
    .filter(m => {
      if (selectedIds.has(m.id)) return false
      if (!query.trim()) return true
      return `${m.firstName} ${m.lastName}`.toLowerCase().includes(query.toLowerCase())
    })
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))

  useEffect(() => {
    function handle(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function add(member) {
    onChange([...selected, member])
    setQuery('')
    inputRef.current?.focus()
  }

  function remove(id) { onChange(selected.filter(m => m.id !== id)) }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="min-h-[38px] flex flex-wrap gap-1.5 bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-2 cursor-text focus-within:border-neutral-500 transition-colors"
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
      >
        {selected.map(m => (
          <span key={m.id} className="flex items-center gap-1 text-[11px] bg-white/10 border border-white/10 rounded-full pl-2 pr-1 py-0.5 text-white">
            {m.firstName} {m.lastName}
            <button type="button" onMouseDown={e => { e.stopPropagation(); remove(m.id) }} className="text-neutral-400 hover:text-white transition-colors">
              <X size={9} />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1.5 flex-1 min-w-[100px]">
          <Search size={11} className="text-neutral-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={selected.length === 0 ? 'search members…' : ''}
            className="flex-1 bg-transparent text-xs text-white placeholder-neutral-600 focus:outline-none"
          />
        </div>
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#252525] border border-neutral-700 rounded-lg z-20 shadow-xl max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-neutral-600">{query ? 'no members match' : 'all members selected'}</p>
          ) : filtered.map(m => (
            <button key={m.id} type="button" onMouseDown={e => { e.preventDefault(); add(m) }}
              className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors">
              {m.firstName} {m.lastName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Session Modal ─────────────────────────────────────────────────────────────

const HOURS_12 = ['1','2','3','4','5','6','7','8','9','10','11','12']
const MINUTES  = ['00','05','10','15','20','25','30','35','40','45','50','55']

function initTime(date) {
  const h = date.getHours()
  return {
    hour:   String(h % 12 || 12),
    minute: String(date.getMinutes()).padStart(2, '0'),
    ampm:   h >= 12 ? 'PM' : 'AM',
  }
}

function SessionModal({ trainers, members, session, initialDate, onSave, onDelete, onClose, saving }) {
  const defaultDate      = initialDate ? isoDateLocal(initialDate) : isoDateLocal(new Date())
  const defaultTimeState = initialDate ? initTime(initialDate) : { hour: '9', minute: '00', ampm: 'AM' }
  const sessionTimeState = session ? initTime(new Date(session.date)) : null

  const [trainerId,       setTrainerId]       = useState(session?.trainerId ?? trainers[0]?.id ?? '')
  const [selectedMembers, setSelectedMembers] = useState(session?.members ?? [])
  const [date,            setDate]            = useState(session ? isoDateLocal(new Date(session.date)) : defaultDate)
  const [hour,            setHour]            = useState((sessionTimeState ?? defaultTimeState).hour)
  const [minute,          setMinute]          = useState((sessionTimeState ?? defaultTimeState).minute)
  const [ampm,            setAmpm]            = useState((sessionTimeState ?? defaultTimeState).ampm)
  const [title,           setTitle]           = useState(session?.title ?? '')
  const [duration,        setDuration]        = useState(session?.durationMinutes ?? 60)
  const [notes,           setNotes]           = useState(session?.notes ?? '')

  function handleSave() {
    if (!trainerId || selectedMembers.length === 0 || !date) return
    let h = Number(hour)
    if (ampm === 'PM' && h !== 12) h += 12
    if (ampm === 'AM' && h === 12) h = 0
    const [y, mo, d] = date.split('-').map(Number)
    const dt = new Date(y, mo - 1, d, h, Number(minute), 0, 0)
    onSave({ trainerId, title: title.trim() || null, memberIds: selectedMembers.map(m => m.id), date: dt.toISOString(), durationMinutes: Number(duration), notes })
  }

  const isEdit  = Boolean(session)
  const canSave = trainerId && selectedMembers.length > 0 && date && !saving

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#1c1c1c] border border-neutral-800 rounded-xl w-full max-w-md shadow-2xl"
           style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <p className="text-sm font-semibold text-white">{isEdit ? 'edit session' : 'add session'}</p>
          <button onClick={onClose} className="p-1 rounded text-neutral-500 hover:text-white transition-colors"><X size={14} /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">title <span className="text-neutral-700">— optional</span></label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. strength training, cardio…"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
          </div>
          {/* Trainer */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">trainer</label>
            <select value={trainerId} onChange={e => setTrainerId(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-neutral-500">
              {trainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {/* Members */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">
              members {selectedMembers.length > 0 && <span className="text-neutral-600">({selectedMembers.length})</span>}
            </label>
            <PTMemberMultiSelect members={members} selected={selectedMembers} onChange={setSelectedMembers} />
          </div>
          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1.5">date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-neutral-500 [color-scheme:dark]" />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1.5">time</label>
              <div className="flex items-center gap-1">
                <select value={hour} onChange={e => setHour(e.target.value)}
                  className="w-14 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-neutral-500 text-center appearance-none">
                  {HOURS_12.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-neutral-600 text-sm font-medium">:</span>
                <select value={minute} onChange={e => setMinute(e.target.value)}
                  className="w-14 bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-neutral-500 text-center appearance-none">
                  {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <div className="flex rounded-lg overflow-hidden border border-neutral-700 shrink-0">
                  {['AM','PM'].map(p => (
                    <button key={p} type="button" onClick={() => setAmpm(p)}
                      className={`px-2 py-2 text-xs font-medium transition-colors ${ampm === p ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Duration */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">duration (minutes)</label>
            <input type="number" min="15" step="15" value={duration} onChange={e => setDuration(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-neutral-500" />
          </div>
          {/* Notes */}
          <div>
            <label className="block text-xs text-neutral-500 mb-1.5">notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="optional session notes…"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-800">
          {isEdit ? (
            <button onClick={onDelete} disabled={saving} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors">
              <Trash2 size={13} />delete
            </button>
          ) : <div />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors">cancel</button>
            <button onClick={handleSave} disabled={!canSave}
              className="px-4 py-1.5 text-xs bg-white text-black rounded-lg font-medium hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {saving ? '…' : isEdit ? 'save changes' : 'add session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Add Trainer Form ──────────────────────────────────────────────────────────

function AddTrainerForm({ usedColors, onAdd, onCancel, saving }) {
  const nextColor = PT_COLORS.find(c => !usedColors.includes(c)) ?? PT_COLORS[0]
  const [name,  setName]  = useState('')
  const [color, setColor] = useState(nextColor)

  return (
    <div className="space-y-2 pt-2 border-t border-neutral-800">
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="trainer name" autoFocus
        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500" />
      <div className="flex gap-1.5 flex-wrap">
        {PT_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)} style={{ backgroundColor: c }}
            className={`w-5 h-5 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-[#1c1c1c]' : 'opacity-60 hover:opacity-100'}`} />
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => name.trim() && onAdd({ name: name.trim(), color })} disabled={!name.trim() || saving}
          className="flex-1 py-1.5 text-xs bg-white text-black rounded-lg font-medium disabled:opacity-40 hover:bg-neutral-200 transition-colors">
          {saving ? '…' : 'add'}
        </button>
        <button onClick={onCancel} className="px-3 text-xs text-neutral-500 hover:text-white transition-colors">cancel</button>
      </div>
    </div>
  )
}

// ── Month Calendar ────────────────────────────────────────────────────────────

function MonthCalendar({ sessions, year, month, filterTrainerId, onDayClick, onSessionClick }) {
  const cells = buildCalendarGrid(year, month)
  const today = new Date()

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-neutral-800">
        {DAYS.map(d => (
          <div key={d} className="py-2 text-center text-[11px] font-medium text-neutral-600 uppercase tracking-wider">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="min-h-[88px] border-b border-r border-neutral-800/50 last:border-r-0" />

          const daySessions = sessionsForDay(sessions, year, month, day)
            .filter(s => !filterTrainerId || s.trainerId === filterTrainerId)
            .sort((a, b) => new Date(a.date) - new Date(b.date))
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
          const isPast  = new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())

          return (
            <div key={i} onClick={() => onDayClick(new Date(year, month, day))}
              className={`min-h-[88px] border-b border-r border-neutral-800/50 last:border-r-0 p-1.5 cursor-pointer group transition-colors ${isPast ? 'hover:bg-white/[0.015]' : 'hover:bg-white/[0.03]'}`}>
              <div className="flex justify-end mb-1">
                <span className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full ${
                  isToday ? 'bg-white text-black font-semibold' : isPast ? 'text-neutral-600' : 'text-neutral-400'
                }`}>{day}</span>
              </div>
              <div className="space-y-0.5">
                {daySessions.slice(0, 3).map(s => (
                  <div key={s.id} onClick={e => { e.stopPropagation(); onSessionClick(s) }}
                    style={{ borderLeftColor: s.trainer.color ?? '#6366f1', backgroundColor: (s.trainer.color ?? '#6366f1') + '22' }}
                    className="text-[10px] px-1.5 py-0.5 rounded border-l-2 truncate text-white hover:brightness-125 transition-all cursor-pointer leading-4"
                    title={`${s.title ?? memberNames(s)} — ${fmtTime(s.date)}`}>
                    {s.title ?? memberNamesShort(s)}
                  </div>
                ))}
                {daySessions.length > 3 && <div className="text-[10px] text-neutral-600 pl-1">+{daySessions.length - 3} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Time grid primitives ──────────────────────────────────────────────────────

function SessionBlock({ session, top, height, onClick }) {
  const color = session.trainer?.color ?? '#6366f1'
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick(session) }}
      style={{ position: 'absolute', top, height: Math.max(height, 22), left: 3, right: 3, borderLeftColor: color, backgroundColor: color + '33' }}
      className="rounded border-l-2 px-1.5 py-0.5 overflow-hidden cursor-pointer hover:brightness-125 transition-all z-10"
      title={`${session.title ?? memberNames(session)} — ${fmtTime(session.date)}`}
    >
      <p className="text-[10px] text-white font-medium leading-tight truncate">{session.title ?? memberNamesShort(session)}</p>
      {height >= 32 && <p className="text-[9px] text-white/60 leading-tight">{fmtTime(session.date)}</p>}
    </div>
  )
}

function DayColumn({ date, sessions, filterTrainerId, onSessionClick, onSlotClick }) {
  const daySessions = sessions
    .filter(s => sameDay(new Date(s.date), date) && (!filterTrainerId || s.trainerId === filterTrainerId))
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const y    = e.clientY - rect.top
    const mins = Math.floor(y / ROW_HEIGHT * 60)
    const h    = Math.min(START_HOUR + Math.floor(mins / 60), END_HOUR - 1)
    const min  = Math.floor((mins % 60) / 15) * 15
    onSlotClick(new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, min === 60 ? 0 : min))
  }

  return (
    <div className="relative flex-1 cursor-pointer hover:bg-white/[0.015] transition-colors"
         style={{ height: HOURS_SHOWN * ROW_HEIGHT }}
         onClick={handleClick}>
      {daySessions.map(s => {
        const d      = new Date(s.date)
        const top    = ((d.getHours() - START_HOUR) + d.getMinutes() / 60) * ROW_HEIGHT
        const height = s.durationMinutes / 60 * ROW_HEIGHT
        return <SessionBlock key={s.id} session={s} top={Math.max(0, top)} height={height} onClick={onSessionClick} />
      })}
    </div>
  )
}

function TimeGutter() {
  return (
    <div className="w-12 shrink-0 relative" style={{ height: HOURS_SHOWN * ROW_HEIGHT }}>
      {HOUR_LIST.map((h, i) => (
        <div key={h} className="absolute w-full flex justify-end pr-2" style={{ top: i * ROW_HEIGHT - 7 }}>
          <span className="text-[10px] text-neutral-600 leading-none">{fmtHour(h)}</span>
        </div>
      ))}
    </div>
  )
}

function HourLines() {
  return (
    <>
      {HOUR_LIST.map((_, i) => (
        <div key={i} className="absolute left-0 right-0 border-t border-neutral-800/50 pointer-events-none" style={{ top: i * ROW_HEIGHT }} />
      ))}
    </>
  )
}

// ── Week View ─────────────────────────────────────────────────────────────────

function WeekView({ sessions, calDate, filterTrainerId, onDayHeaderClick, onSlotClick, onSessionClick }) {
  const weekStart = getWeekStart(calDate)
  const days      = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today     = new Date(); today.setHours(0, 0, 0, 0)

  return (
    <div>
      {/* Day headers */}
      <div className="flex border-b border-neutral-800 pl-12">
        {days.map((day, i) => {
          const isToday = sameDay(day, today)
          return (
            <div key={i} onClick={() => onDayHeaderClick(day)}
              className="flex-1 py-2 flex flex-col items-center cursor-pointer hover:bg-white/[0.02] transition-colors">
              <span className="text-[10px] text-neutral-600 uppercase">{WEEKDAYS_SHORT[day.getDay()]}</span>
              <span className={`mt-0.5 text-sm w-7 h-7 flex items-center justify-center rounded-full ${
                isToday ? 'bg-white text-black font-semibold' : 'text-neutral-300'
              }`}>{day.getDate()}</span>
            </div>
          )
        })}
      </div>
      {/* Scrollable time grid */}
      <div className="overflow-y-auto max-h-[588px]">
        <div className="flex">
          <TimeGutter />
          <div className="flex flex-1 relative">
            <HourLines />
            {days.map((day, i) => (
              <div key={i} className={`flex-1 relative ${i > 0 ? 'border-l border-neutral-800/50' : ''}`}>
                <DayColumn
                  date={day}
                  sessions={sessions}
                  filterTrainerId={filterTrainerId}
                  onSessionClick={onSessionClick}
                  onSlotClick={onSlotClick}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Day View ──────────────────────────────────────────────────────────────────

function DayView({ sessions, calDate, filterTrainerId, onSlotClick, onSessionClick }) {
  return (
    <div className="overflow-y-auto max-h-[588px]">
      <div className="flex">
        <TimeGutter />
        <div className="flex-1 relative border-l border-neutral-800/50">
          <HourLines />
          <DayColumn
            date={calDate}
            sessions={sessions}
            filterTrainerId={filterTrainerId}
            onSessionClick={onSessionClick}
            onSlotClick={onSlotClick}
          />
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PersonalTrainingPage() {
  const { gymSlug } = useParams()

  const [trainers, setTrainers] = useState([])
  const [sessions, setSessions] = useState([])
  const [members,  setMembers]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  // Calendar state
  const [view,    setView]    = useState('month')
  const [calDate, setCalDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [filterTrainerId, setFilterTrainerId] = useState(null)

  // Modals
  const [addingTrainer, setAddingTrainer] = useState(false)
  const [savingTrainer, setSavingTrainer] = useState(false)
  const [sessionModal,  setSessionModal]  = useState(null)
  const [savingSession, setSavingSession] = useState(false)

  const token = () => localStorage.getItem('ik_token')

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const t = token()
      const [trRes, sesRes, memRes] = await Promise.all([
        fetch(`/api/${gymSlug}/personal-trainers`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch(`/api/${gymSlug}/pt-sessions`,        { headers: { Authorization: `Bearer ${t}` } }),
        fetch(`/api/${gymSlug}/all`,                { headers: { Authorization: `Bearer ${t}` } }),
      ])
      const [trData, sesData, memData] = await Promise.all([trRes.json(), sesRes.json(), memRes.json()])
      setTrainers(trData.trainers ?? [])
      setSessions(sesData.sessions ?? [])
      setMembers((memData.members ?? []).filter(m => m.status === 'ACTIVE'))
    } catch { setError('failed to load data') }
    finally  { setLoading(false) }
  }, [gymSlug])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Trainer actions ──

  async function addTrainer(data) {
    setSavingTrainer(true)
    try {
      const res = await fetch(`/api/${gymSlug}/personal-trainers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error()
      const { trainer } = await res.json()
      setTrainers(prev => [...prev, trainer])
      setAddingTrainer(false)
    } catch { /* non-fatal */ }
    finally { setSavingTrainer(false) }
  }

  async function removeTrainer(trainerId) {
    if (!confirm('Remove this trainer? Their sessions will also be deleted.')) return
    try {
      await fetch(`/api/${gymSlug}/personal-trainers/${trainerId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token()}` },
      })
      setTrainers(prev => prev.filter(t => t.id !== trainerId))
      setSessions(prev => prev.filter(s => s.trainerId !== trainerId))
      if (filterTrainerId === trainerId) setFilterTrainerId(null)
    } catch { /* non-fatal */ }
  }

  // ── Session actions ──

  async function saveSession(data) {
    setSavingSession(true)
    try {
      const isEdit = sessionModal?.type === 'edit'
      const url    = isEdit ? `/api/${gymSlug}/pt-sessions/${sessionModal.session.id}` : `/api/${gymSlug}/pt-sessions`
      const res    = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error()
      const { session } = await res.json()
      setSessions(prev => isEdit ? prev.map(s => s.id === session.id ? session : s) : [session, ...prev])
      setSessionModal(null)
      const trRes = await fetch(`/api/${gymSlug}/personal-trainers`, { headers: { Authorization: `Bearer ${token()}` } })
      const trData = await trRes.json()
      setTrainers(trData.trainers ?? [])
    } catch { /* non-fatal */ }
    finally { setSavingSession(false) }
  }

  async function deleteSession() {
    if (!sessionModal?.session) return
    setSavingSession(true)
    try {
      await fetch(`/api/${gymSlug}/pt-sessions/${sessionModal.session.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token()}` },
      })
      setSessions(prev => prev.filter(s => s.id !== sessionModal.session.id))
      setSessionModal(null)
      const trRes = await fetch(`/api/${gymSlug}/personal-trainers`, { headers: { Authorization: `Bearer ${token()}` } })
      const trData = await trRes.json()
      setTrainers(trData.trainers ?? [])
    } catch { /* non-fatal */ }
    finally { setSavingSession(false) }
  }

  // ── Navigation ──

  function prevPeriod() {
    setCalDate(d => {
      const next = new Date(d)
      if (view === 'day')   next.setDate(next.getDate() - 1)
      if (view === 'week')  next.setDate(next.getDate() - 7)
      if (view === 'month') next.setMonth(next.getMonth() - 1)
      return next
    })
  }

  function nextPeriod() {
    setCalDate(d => {
      const next = new Date(d)
      if (view === 'day')   next.setDate(next.getDate() + 1)
      if (view === 'week')  next.setDate(next.getDate() + 7)
      if (view === 'month') next.setMonth(next.getMonth() + 1)
      return next
    })
  }

  function openAddSession(date) {
    if (trainers.length === 0) return
    setSessionModal({ type: 'add', date })
  }

  // ── Derived ──

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const pastSessions = (filterTrainerId ? sessions.filter(s => s.trainerId === filterTrainerId) : sessions)
    .filter(s => new Date(s.date) < today)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  // ── Render ──

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      {/* Header */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">personal training</h1>
        {!loading && <span className="ml-2 text-sm font-normal text-white opacity-40 tabular-nums">{sessions.length}</span>}
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2">
          <RefreshCw size={16} className="text-neutral-600 animate-spin" />
          <span className="text-sm text-neutral-600">loading…</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : (
        <div className="flex-1 flex gap-0 md:overflow-hidden">

          {/* ── Left panel: trainers ── */}
          <aside className="w-52 shrink-0 border-r border-neutral-800 flex flex-col p-4 gap-4 overflow-y-auto">
            <div>
              <p className="text-[10px] font-semibold text-neutral-600 uppercase tracking-widest mb-3">trainers</p>
              <div className="space-y-1">
                {trainers.length === 0 && !addingTrainer && <p className="text-xs text-neutral-600">no trainers yet</p>}
                {trainers.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-2 group py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color ?? '#6366f1' }} />
                      <span className="text-xs text-white truncate">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-neutral-600">{t._count?.sessions ?? 0}</span>
                      <button onClick={() => removeTrainer(t.id)} className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 transition-all">
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {addingTrainer ? (
                <AddTrainerForm usedColors={trainers.map(t => t.color).filter(Boolean)} onAdd={addTrainer} onCancel={() => setAddingTrainer(false)} saving={savingTrainer} />
              ) : (
                <button onClick={() => setAddingTrainer(true)} className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white transition-colors">
                  <Plus size={12} />add trainer
                </button>
              )}
            </div>
          </aside>

          {/* ── Right panel ── */}
          <div className="flex-1 flex flex-col overflow-y-auto p-5 gap-4">

            {/* Trainer filter */}
            {trainers.length > 0 && (
              <div className="shrink-0 relative w-fit">
                <select value={filterTrainerId ?? ''} onChange={e => setFilterTrainerId(e.target.value || null)}
                  className="appearance-none bg-neutral-800 border border-neutral-700 rounded-lg pl-3 pr-8 py-2 text-sm text-white focus:outline-none focus:border-neutral-500 cursor-pointer">
                  <option value="">all trainers</option>
                  {trainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              </div>
            )}

            {/* Calendar card */}
            <div className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden shrink-0">

              {/* Card header: view toggle + navigation */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 gap-4">
                {/* View toggle */}
                <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 shrink-0">
                  {['day', 'week', 'month'].map(v => (
                    <button key={v} onClick={() => setView(v)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        view === v ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
                      }`}>
                      {v}
                    </button>
                  ))}
                </div>

                {/* Navigation */}
                <div className="flex items-center gap-1 min-w-0">
                  <button onClick={prevPeriod} className="p-1 text-neutral-500 hover:text-white transition-colors shrink-0">
                    <ChevronLeft size={15} />
                  </button>
                  <span className="text-sm font-medium text-white text-center truncate px-1">
                    {formatViewHeader(view, calDate)}
                  </span>
                  <button onClick={nextPeriod} className="p-1 text-neutral-500 hover:text-white transition-colors shrink-0">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              {/* Calendar body */}
              {view === 'month' && (
                <MonthCalendar
                  sessions={sessions}
                  year={calDate.getFullYear()}
                  month={calDate.getMonth()}
                  filterTrainerId={filterTrainerId}
                  onDayClick={openAddSession}
                  onSessionClick={session => setSessionModal({ type: 'edit', session })}
                />
              )}
              {view === 'week' && (
                <WeekView
                  sessions={sessions}
                  calDate={calDate}
                  filterTrainerId={filterTrainerId}
                  onDayHeaderClick={day => { setCalDate(day); setView('day') }}
                  onSlotClick={openAddSession}
                  onSessionClick={session => setSessionModal({ type: 'edit', session })}
                />
              )}
              {view === 'day' && (
                <DayView
                  sessions={sessions}
                  calDate={calDate}
                  filterTrainerId={filterTrainerId}
                  onSlotClick={openAddSession}
                  onSessionClick={session => setSessionModal({ type: 'edit', session })}
                />
              )}
            </div>

            {/* Past sessions */}
            {pastSessions.length > 0 && (
              <div className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden shrink-0">
                <div className="px-5 py-3 border-b border-neutral-800">
                  <p className="text-xs font-semibold text-neutral-500 uppercase tracking-widest">past sessions</p>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {pastSessions.map((s, i) => (
                      <tr key={s.id} onClick={() => setSessionModal({ type: 'edit', session: s })}
                        className={`border-b border-neutral-800/60 last:border-b-0 cursor-pointer hover:bg-white/5 transition-colors ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.trainer.color ?? '#6366f1' }} />
                            <span className="text-xs text-neutral-500">{fmtDate(s.date)}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3"><span className="text-sm text-white">{s.title ?? memberNames(s)}</span></td>
                        <td className="px-5 py-3"><span className="text-xs text-neutral-500">{s.trainer.name}</span></td>
                        <td className="px-5 py-3 text-right"><span className="text-xs text-neutral-600">{s.durationMinutes} min</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>
      )}

      {sessionModal && (
        <SessionModal
          trainers={trainers}
          members={members}
          session={sessionModal.type === 'edit' ? sessionModal.session : null}
          initialDate={sessionModal.type === 'add' ? sessionModal.date : null}
          onSave={saveSession}
          onDelete={deleteSession}
          onClose={() => setSessionModal(null)}
          saving={savingSession}
        />
      )}
    </div>
  )
}
