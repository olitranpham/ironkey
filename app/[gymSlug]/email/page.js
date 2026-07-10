'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { RefreshCw, Bold, Italic, List, Link2, Heading2, Mail, X, Search } from 'lucide-react'

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({ editor }) {
  if (!editor) return null

  function setLink() {
    const url = window.prompt('URL')
    if (!url) return
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const btn = (onClick, active, title, children) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-white/20 text-white'
          : 'text-neutral-500 hover:text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-neutral-800">
      {btn(() => editor.chain().focus().toggleBold().run(),         editor.isActive('bold'),           'bold',        <Bold size={13} />)}
      {btn(() => editor.chain().focus().toggleItalic().run(),       editor.isActive('italic'),         'italic',      <Italic size={13} />)}
      {btn(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }), 'heading', <Heading2 size={13} />)}
      {btn(() => editor.chain().focus().toggleBulletList().run(),   editor.isActive('bulletList'),     'bullet list', <List size={13} />)}
      <div className="w-px h-4 bg-neutral-800 mx-1" />
      {btn(setLink, editor.isActive('link'), 'insert link', <Link2 size={13} />)}
    </div>
  )
}

// ── Plain text extraction ─────────────────────────────────────────────────────

function editorToPlainText(editor) {
  if (!editor) return ''
  return editor.getText()
}

// ── Member multi-select ───────────────────────────────────────────────────────

function MemberMultiSelect({ members, selected, onChange }) {
  const [query,    setQuery]    = useState('')
  const [open,     setOpen]     = useState(false)
  const containerRef            = useRef(null)
  const inputRef                = useRef(null)

  const selectedIds = new Set(selected.map(m => m.id))

  const filtered = members
    .filter(m => {
      if (selectedIds.has(m.id)) return false
      if (!query.trim()) return true
      const q = query.toLowerCase()
      return `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)
    })
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function add(member) {
    onChange([...selected, member])
    setQuery('')
    inputRef.current?.focus()
  }

  function remove(id) {
    onChange(selected.filter(m => m.id !== id))
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags + search input */}
      <div
        className="min-h-[38px] flex flex-wrap gap-1.5 px-3 py-2 cursor-text"
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
      >
        {selected.map(m => (
          <span
            key={m.id}
            className="flex items-center gap-1 text-[11px] bg-white/10 border border-white/10 rounded-full pl-2.5 pr-1.5 py-0.5 text-white"
          >
            {m.firstName} {m.lastName}
            <button
              type="button"
              onMouseDown={e => { e.stopPropagation(); remove(m.id) }}
              className="text-neutral-400 hover:text-white transition-colors"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1.5 flex-1 min-w-[120px]">
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

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-[#222] border border-neutral-700 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-neutral-600">
              {query ? 'no members match' : 'all members selected'}
            </p>
          ) : (
            filtered.map(m => (
              <button
                key={m.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); add(m) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
              >
                <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shrink-0">
                  <span className="text-black font-semibold text-[9px] select-none">
                    {(m.firstName?.[0] ?? '') + (m.lastName?.[0] ?? '')}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-white truncate">{m.firstName} {m.lastName}</p>
                  <p className="text-[10px] text-neutral-500 truncate">{m.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EmailPage() {
  const { gymSlug } = useParams()

  const [members,        setMembers]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [subject,        setSubject]        = useState('')
  const [charCount,      setCharCount]      = useState(0)
  const [mode,           setMode]           = useState('all')      // 'all' | 'select'
  const [selectedMembers, setSelectedMembers] = useState([])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'underline text-blue-400' } }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[280px] text-sm text-white leading-relaxed px-4 py-3',
      },
    },
    onUpdate: ({ editor }) => {
      setCharCount(editor.getText().length)
    },
  })

  const fetchRecipients = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('ik_token')
      const res = await fetch(`/api/${gymSlug}/email/recipients`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setMembers(data.members ?? [])
    } catch { /* non-fatal */ }
    finally { setLoading(false) }
  }, [gymSlug])

  useEffect(() => { fetchRecipients() }, [fetchRecipients])

  const recipients   = mode === 'all' ? members : selectedMembers
  const recipientCount = recipients.length

  function handleOpenInMail() {
    const bcc      = recipients.map(m => m.email).join(',')
    const body     = editorToPlainText(editor)
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=&bcc=${encodeURIComponent(bcc)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.open(gmailUrl, '_blank')
  }

  const canSend = subject.trim() && recipientCount > 0 && !loading

  return (
    <div className="md:flex-1 flex flex-col md:overflow-hidden" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>

      {/* Header */}
      <header className="h-14 shrink-0 bg-[#1c1c1c] border-b border-neutral-800 flex items-center px-6">
        <h1 className="text-sm font-semibold text-white">email members</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 max-w-2xl w-full mx-auto">

        {/* Recipients card */}
        <div className="bg-white/[0.03] rounded-xl border border-white/5">

          {/* Mode toggle header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <span className="text-xs font-medium text-neutral-400">to:</span>
            <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5">
              <button
                onClick={() => setMode('all')}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  mode === 'all'
                    ? 'bg-white text-black'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                all members
              </button>
              <button
                onClick={() => setMode('select')}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  mode === 'select'
                    ? 'bg-white text-black'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                select members
              </button>
            </div>
          </div>

          {/* Mode body */}
          {mode === 'all' ? (
            /* All members — expandable list */
            loading ? (
              <div className="px-4 py-3 flex items-center gap-2">
                <RefreshCw size={12} className="text-neutral-600 animate-spin" />
                <span className="text-xs text-neutral-600">loading…</span>
              </div>
            ) : (
              <div className="px-4 py-3">
                {members.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 max-h-32 overflow-y-auto">
                    {members.map(m => (
                      <span key={m.id} className="text-[11px] bg-white/5 border border-neutral-800 rounded-full px-2.5 py-0.5 text-neutral-400">
                        {m.firstName} {m.lastName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            /* Select specific members */
            <div className="relative">
              <MemberMultiSelect
                members={members}
                selected={selectedMembers}
                onChange={setSelectedMembers}
              />
              {selectedMembers.length > 0 && (
                <div className="px-3 pb-2.5 flex items-center justify-between">
                  <span className="text-[10px] text-neutral-600">{selectedMembers.length} selected</span>
                  <button
                    onClick={() => setSelectedMembers([])}
                    className="text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors"
                  >
                    clear all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compose card */}
        <div className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden">

          {/* Subject */}
          <div className="border-b border-neutral-800 px-4 py-3 flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-500 shrink-0">subject:</span>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="your subject line"
              className="flex-1 bg-transparent text-sm text-white placeholder-neutral-600 focus:outline-none"
            />
          </div>

          {/* Toolbar */}
          <Toolbar editor={editor} />

          {/* Editor */}
          <div className="h-64 overflow-y-auto [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-2">
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Send row — outside compose card so it's always reachable */}
        <div className="flex items-center justify-between pb-6">
          <span className="text-[11px] text-neutral-600">
            {charCount} characters · {recipientCount} recipients via BCC
          </span>
          <button
            onClick={handleOpenInMail}
            disabled={!canSend}
            className="flex items-center gap-2 px-4 py-2 bg-white text-black text-xs font-semibold rounded-lg hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Mail size={13} />
            open in mail
          </button>
        </div>

      </main>
    </div>
  )
}
