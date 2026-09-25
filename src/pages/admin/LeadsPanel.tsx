import { useEffect, useMemo, useState } from 'react'
import { Phone, MessageCircle, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { StatTile } from '../../components/Charts'
import { shortDate, dateTime, isoDate } from '../../lib/format'
import {
  Lead, LeadNote, LeadStage, LEAD_STAGES, STAGE_LABEL, LEAD_SOURCES, CONSENT_TYPES,
  sourceLabel, normalisePhone, displayPhone,
  listLeads, findLeadByPhone, createLead, updateLead, listNotes, addNote,
} from '../../lib/leadsApi'

// Doctor leads: who to ring next, and what was said last time.
//
// Sorted by next follow-up, soonest first, because the question this screen
// answers every morning is "who do I call today". A lead with no follow-up
// date sorts last: nobody has decided when to call them, and "Due today"
// leaves them out.
//
// Out of scope on purpose (the plan says so): assigning leads to people,
// scoring them, and charts. One operator, one list.

const STAGE_TONE: Record<LeadStage, string> = {
  called: 'bg-gray-100 text-gray-700',
  interested: 'bg-amber-50 text-amber-700',
  registered: 'bg-teal-50 text-teal-700',
  active: 'bg-emerald-100 text-emerald-800',
  not_interested: 'bg-red-50 text-red-600',
}

/** Monday 00:00 local — "this week" the way a calendar means it. */
function startOfWeek(d = new Date()) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

export default function LeadsPanel() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dueOnly, setDueOnly] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    listLeads()
      .then(setLeads)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const today = isoDate()
  const replace = (l: Lead) => setLeads(ls => ls.map(x => (x.id === l.id ? l : x)))

  const shown = useMemo(() => leads
    .filter(l => !dueOnly || (l.next_followup !== null && l.next_followup <= today))
    .filter(l => !sourceFilter || l.source === sourceFilter)
    .filter(l => !stageFilter || l.stage === stageFilter)
    .sort((a, b) => {
      if (a.next_followup === b.next_followup) return b.created_at.localeCompare(a.created_at)
      if (a.next_followup === null) return 1
      if (b.next_followup === null) return -1
      return a.next_followup.localeCompare(b.next_followup)
    }), [leads, dueOnly, sourceFilter, stageFilter, today])

  const weekStart = startOfWeek()
  const newThisWeek = leads.filter(l => new Date(l.created_at) >= weekStart).length
  const registeredThisWeek = leads.filter(l => l.registered_at && new Date(l.registered_at) >= weekStart).length
  const dueCount = leads.filter(l => l.next_followup !== null && l.next_followup <= today).length

  // Filter by any source a lead actually has, including one no longer in the list.
  const sources = useMemo(() => {
    const ids = new Set(LEAD_SOURCES.map(s => s.id))
    leads.forEach(l => l.source && ids.add(l.source))
    return [...ids]
  }, [leads])

  const select = 'text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-navy-700">Doctor leads</h2>
        <button onClick={() => setShowAdd(v => !v)} className="btn-teal text-sm">
          <Plus className="w-4 h-4" /> Add lead
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Leads this week" value={newThisWeek} />
        <StatTile label="Registered this week" value={registeredThisWeek} />
        <StatTile label="Due today" value={dueCount} tone={dueCount ? 'alert' : 'normal'} />
      </div>

      {showAdd && (
        <AddLeadForm
          onCreated={l => { setLeads(ls => [l, ...ls]); setShowAdd(false); setOpenId(l.id) }}
          onShowExisting={l => {
            // Added from another tab since this list loaded? Show it anyway.
            setLeads(ls => ls.some(x => x.id === l.id) ? ls : [l, ...ls])
            setShowAdd(false); setDueOnly(false); setSourceFilter(''); setStageFilter(''); setOpenId(l.id)
            setTimeout(() => document.getElementById(`lead-${l.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDueOnly(v => !v)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
            dueOnly ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500'}`}>
          Due today{dueCount ? ` (${dueCount})` : ''}
        </button>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={select}>
          <option value="">All sources</option>
          {sources.map(id => <option key={id} value={id}>{sourceLabel(id)}</option>)}
        </select>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className={select}>
          <option value="">All stages</option>
          {LEAD_STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{shown.length} of {leads.length}</span>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading leads…</p>
      ) : !shown.length ? (
        <div className="card text-center py-10 text-sm text-gray-500">
          {leads.length ? 'No leads match these filters.' : 'No leads yet. Add the first one above.'}
        </div>
      ) : (
        <div className="card p-0 divide-y divide-gray-100">
          {/* Header row, desktop only — on a phone each row stacks and labels itself. */}
          <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5 text-xs font-semibold text-gray-500">
            <span>Name / phone</span><span>Source</span><span>Stage</span><span>Next follow-up</span><span>Actions</span>
          </div>
          {shown.map(l => (
            <LeadRow key={l.id} lead={l} today={today}
              open={openId === l.id} onToggle={() => setOpenId(openId === l.id ? null : l.id)}
              onSaved={replace} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

function LeadRow({ lead, today, open, onToggle, onSaved, onError }: {
  lead: Lead; today: string; open: boolean
  onToggle: () => void; onSaved: (l: Lead) => void; onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const overdue = lead.next_followup !== null && lead.next_followup < today
  const dueToday = lead.next_followup === today

  const save = async (patch: Partial<Pick<Lead, 'stage' | 'next_followup'>>) => {
    setSaving(true)
    try { onSaved(await updateLead(lead.id, patch)); onError('') }
    catch (e) { onError(`Could not save ${lead.name || displayPhone(lead.phone)}: ${(e as Error).message}`) }
    finally { setSaving(false) }
  }

  const iconBtn = 'inline-flex items-center justify-center w-9 h-9 rounded-lg border'

  return (
    <div id={`lead-${lead.id}`} className={open ? 'bg-teal-50/30' : ''}>
      <div className="grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center">
        <div className="col-span-2 md:col-span-1 min-w-0">
          <div className="font-semibold text-navy-700 truncate">{lead.name || 'No name'}</div>
          <div className="text-xs text-gray-500">{displayPhone(lead.phone)}</div>
        </div>
        <div className="text-sm text-gray-600">
          <span className="md:hidden text-xs text-gray-400 block">Source</span>
          {sourceLabel(lead.source)}
        </div>
        <div>
          <span className="md:hidden text-xs text-gray-400 block">Stage</span>
          <select value={lead.stage} disabled={saving}
            onChange={e => save({ stage: e.target.value as LeadStage })}
            className={`text-sm font-semibold rounded-lg px-2 py-1.5 border-0 ${STAGE_TONE[lead.stage]}`}>
            {LEAD_STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <span className="md:hidden text-xs text-gray-400 block">Next follow-up</span>
          <input type="date" value={lead.next_followup ?? ''} disabled={saving}
            onChange={e => save({ next_followup: e.target.value || null })}
            className={`text-sm border rounded-lg px-2 py-1.5 ${
              overdue ? 'border-red-300 text-red-600' : dueToday ? 'border-amber-300 text-amber-700' : 'border-gray-200 text-gray-700'}`} />
        </div>
        <div className="col-span-2 md:col-span-1 flex items-center gap-2">
          <a href={`tel:+${lead.phone}`} title="Call" className={`${iconBtn} border-gray-200 text-navy-700 hover:bg-gray-50`}>
            <Phone className="w-4 h-4" />
          </a>
          <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer" title="WhatsApp"
            className={`${iconBtn} border-green-200 text-green-600 hover:bg-green-50`}>
            <MessageCircle className="w-4 h-4" />
          </a>
          <button onClick={onToggle} className="text-xs font-semibold text-teal-700 inline-flex items-center gap-1 px-2 py-2">
            Notes {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {open && <Notes lead={lead} />}
    </div>
  )
}

function Notes({ lead }: { lead: Lead }) {
  const [notes, setNotes] = useState<LeadNote[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listNotes(lead.id)
      .then(setNotes)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [lead.id])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const note = text.trim()
    if (!note) return
    setSaving(true)
    try { const n = await addNote(lead.id, note); setNotes(ns => [n, ...ns]); setText(''); setError('') }
    catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }

  const consent = CONSENT_TYPES.find(c => c.id === lead.consent_type)?.label

  return (
    <div className="px-4 pb-4 space-y-3">
      <p className="text-xs text-gray-400">
        Added {shortDate(lead.created_at)}{consent ? ` · ${consent}` : ''}
        {lead.registered_at ? ` · registered ${shortDate(lead.registered_at)}` : ''}
      </p>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="What was said? Next step?"
          className="input-field flex-1 text-sm" />
        <button type="submit" disabled={saving || !text.trim()} className="btn-teal text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Add note'}
        </button>
      </form>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {loading ? (
        <p className="text-xs text-gray-400">Loading notes…</p>
      ) : !notes.length ? (
        <p className="text-xs text-gray-400">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map(n => (
            <li key={n.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.note}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{dateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddLeadForm({ onCreated, onShowExisting, onCancel }: {
  onCreated: (l: Lead) => void; onShowExisting: (l: Lead) => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState(LEAD_SOURCES[0].id)
  const [consent, setConsent] = useState(CONSENT_TYPES[0].id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [existing, setExisting] = useState<Lead | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setExisting(null)
    const p = normalisePhone(phone)
    if (!p) { setError('Enter a 10-digit Indian mobile number.'); return }
    setSaving(true)
    try {
      // Look first so we can offer the existing record. The unique index still
      // catches the race where two tabs add the same number at once.
      const found = await findLeadByPhone(p)
      if (found) { setExisting(found); return }
      onCreated(await createLead({ name: name.trim() || null, phone: p, source, consent_type: consent }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-gray-500">Name
          <input value={name} onChange={e => setName(e.target.value)} className="input-field mt-1" placeholder="Dr. …" />
        </label>
        <label className="text-xs font-semibold text-gray-500">Phone *
          <input value={phone} onChange={e => setPhone(e.target.value)} required inputMode="tel"
            className="input-field mt-1" placeholder="98765 43210" />
        </label>
        <label className="text-xs font-semibold text-gray-500">Source
          <select value={source} onChange={e => setSource(e.target.value)} className="input-field mt-1">
            {LEAD_SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-500">Consent
          <select value={consent} onChange={e => setConsent(e.target.value)} className="input-field mt-1">
            {CONSENT_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      </div>

      {existing && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2.5 rounded-lg text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>
            This number already has a lead: <b>{existing.name || displayPhone(existing.phone)}</b>, {STAGE_LABEL[existing.stage].toLowerCase()}.
          </span>
          <button type="button" onClick={() => onShowExisting(existing)} className="text-sm font-semibold underline">
            View existing record
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-teal text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save lead'}
        </button>
        <button type="button" onClick={onCancel} className="btn-outline text-sm">Cancel</button>
      </div>
    </form>
  )
}
