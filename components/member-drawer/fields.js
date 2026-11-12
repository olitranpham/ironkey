'use client'

import { useState, useEffect } from 'react'
import { DrawerField } from '@/components/DrawerParts'

export const INPUT_CLS = 'bg-[#252525] border border-neutral-700 rounded px-2 py-1 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500'
export const SAVE_CLS  = 'text-[10px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0'

export const EVENT_LABEL = {
  joined:                 'joined',
  reactivated:            'reactivated',
  frozen:                 'frozen',
  unfrozen:               'unfrozen',
  cancellation_scheduled: 'cancellation scheduled',
  cancellation_reversed:  'cancellation reversed',
  canceled:               'canceled',
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
}

export function fmtDateTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')
  return `${date} at ${time}`
}

export function money(cents, currency = 'usd') {
  return cents == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

/**
 * One editable drawer row: an input (or select) with a save button that's
 * enabled once the value differs from `value`. `onSave(next)` persists it;
 * without onSave the row is read-only-ish (input, no save) like before.
 */
export function EditableRow({ label, value, onSave, onInput, type = 'text', placeholder, width = 'w-36', options, normalize, onBlurFormat, compare, toPayload, inputProps, mono = false, children }) {
  const initial = value ?? ''
  const [input, setInput]   = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setInput(initial) }, [initial])
  function change(next) { setInput(next); onInput?.(next) }

  const same = compare ? compare(input, initial) : String(input).trim() === String(initial)
  async function save() {
    setSaving(true)
    await onSave(toPayload ? toPayload(input) : (typeof input === 'string' ? input.trim() : input))
    setSaving(false)
  }

  return (
    <DrawerField label={label}>
      <div className="flex items-center gap-2 ml-4">
        {options ? (
          <select value={input} onChange={e => change(e.target.value)} className={`${INPUT_CLS} placeholder-neutral-600`}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            type={type}
            value={input}
            onChange={e => change(normalize ? normalize(e.target.value) : e.target.value)}
            onBlur={onBlurFormat ? e => setInput(onBlurFormat(e.target.value)) : undefined}
            placeholder={placeholder}
            className={`${INPUT_CLS} ${width} ${type === 'date' || type === 'number' ? '' : 'truncate'} ${mono ? 'font-mono' : ''}`}
            {...inputProps}
          />
        )}
        {children}
        {onSave && (
          <button onClick={save} disabled={saving || same} className={SAVE_CLS}>
            {saving ? '…' : 'save'}
          </button>
        )}
      </div>
    </DrawerField>
  )
}

export function ListState({ rows, empty, children }) {
  if (rows === null) return <div className="px-3 py-2.5 bg-[#1c1c1c]"><span className="text-xs text-neutral-600">loading…</span></div>
  if (rows.length === 0) return <div className="px-3 py-2.5 bg-[#1c1c1c]"><span className="text-xs text-neutral-600">{empty}</span></div>
  return children
}
