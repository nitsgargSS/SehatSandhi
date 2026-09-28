import { useEffect, useMemo, useState } from 'react'
import { Phone, MessageCircle, Mail, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { StatTile } from '../../components/Charts'
import { shortDate, dateTime, isoDate } from '../../lib/format'
import {
  Lead, LeadNote, LeadStage, LEAD_STAGES, STAGE_LABEL, LEAD_SOURCES, CONSENT_TYPES,
  CLOSE_REASONS, ACTIVITY_KINDS, CALL_OUTCOMES, ActivityKind, Assignee, TeamRow,
  sourceLabel, closeLabel, outcomeLabel, normalisePhone, displayPhone,
  listLeads, findLeadByPhone, createLead, updateLead, listNotes, logActivity, listAssignees, teamSummary,
} from '../../lib/leadsApi'

// Doctor leads: who to ring next, what happened last time, and who is on it.
//
// Sorted by next follow-up, soonest first, because the question this screen
// answers every morning is "who do I call today". A lead with no follow-up
// date sorts last.
//
// 0154: every lead has an owner. An admin sees everyone's and a summary per
// person; a manager sees their own and the unassigned pool, can take a lead
// from the pool or give one back. Every call, WhatsApp, email, meeting and
// note is logged with its author, and changes of stage, owner and dates are
// logged by the database — the timeline is the record of who did what.

const STAGE_TONE: Record<LeadStage, string> = {
  called: 'bg-gray-100 text-gray-700',
  interested: 'bg-amber-50 text-amber-700',
  registered: 'bg-teal-50 text-teal-700',
  active: 'bg-emerald-100 text-emerald-800',
  not_interested: 'bg-red-50 text-red-600',
}

const KIND_ICON: Record<string, string> = {
  call: '📞', whatsapp: '💬', email: '✉️', meeting: '🤝', note: '📝',
  created: '✨', assigned: '👤', stage: '➡️', followup: '📅', target: '🎯', closed: '🏁', reopened: '↩️',
}

/** Monday 00:00 local — "this week" the way a calendar means it. */
function startOfWeek(d = new Date()) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
  return s
}

export default function LeadsPanel({ isAdmin, myUid }: { isAdmin: boolean; myUid: string | null }) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [team, setTeam] = useState<Assignee[]>([])
  const [summary, setSummary] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dueOnly, setDueOnly] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [owner, setOwner] = useState(isAdmin ? '' : 'mine')    // '' all · 'mine' · 'none' · <uid>
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open')
  const [showAdd, setShowAdd] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const reloadSummary = () => { if (isAdmin) teamSummary().then(setSummary).catch(() => setSummary([])) }
  useEffect(() => {
    Promise.all([listLeads(), listAssignees().catch(() => [] as Assignee[])])
      .then(([l, t]) => { setLeads(l); setTeam(t) })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
    reloadSummary()
  }, [isAdmin])

  const today = isoDate()
  const replace = (l: Lead) => { setLeads(ls => ls.map(x => (x.id === l.id ? l : x))); reloadSummary() }
  const nameOf = (uid: string | null) => uid ? team.find(t => t.auth_uid === uid)?.name ?? 'Someone' : 'Unassigned'

  const shown = useMemo(() => leads
    .filter(l => status === 'all' || (status === 'open' ? !l.closed_at : !!l.closed_at))
    .filter(l => !owner || (owner === 'mine' ? l.assigned_to === myUid : owner === 'none' ? !l.assigned_to : l.assigned_to === owner))
    .filter(l => !dueOnly || (l.next_followup !== null && l.next_followup <= today))
    .filter(l => !sourceFilter || l.source === sourceFilter)
    .filter(l => !stageFilter || l.stage === stageFilter)
    .sort((a, b) => {
      if (a.next_followup === b.next_followup) return b.created_at.localeCompare(a.created_at)
      if (a.next_followup === null) return 1
      if (b.next_followup === null) return -1
      return a.next_followup.localeCompare(b.next_followup)
    }), [leads, status, owner, myUid, dueOnly, sourceFilter, stageFilter, today])

  const open = leads.filter(l => !l.closed_at)
  const mineOrAll = isAdmin ? open : open.filter(l => l.assigned_to === myUid)
  const weekStart = startOfWeek()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const newThisWeek = leads.filter(l => new Date(l.created_at) >= weekStart).length
  const wonThisMonth = leads.filter(l => l.close_reason === 'registered' && l.closed_at && new Date(l.closed_at) >= monthStart).length
  const dueCount = mineOrAll.filter(l => l.next_followup === today).length
  const overdueCount = mineOrAll.filter(l => l.next_followup !== null && l.next_followup < today).length
  const pool = open.filter(l => !l.assigned_to).length

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label={isAdmin ? 'Due today' : 'My leads due today'} value={dueCount} tone={dueCount ? 'alert' : 'normal'} />
        <StatTile label="Overdue" value={overdueCount} tone={overdueCount ? 'alert' : 'normal'} />
        <StatTile label="New this week" value={newThisWeek} />
        <StatTile label="Won this month" value={wonThisMonth} />
      </div>

      {isAdmin && summary.length > 0 && <TeamTable rows={summary} onPick={uid => { setOwner(uid); setStatus('open') }} />}

      {showAdd && (
        <AddLeadForm isAdmin={isAdmin} team={team} myUid={myUid}
          onCreated={l => { setLeads(ls => [l, ...ls]); setShowAdd(false); setOpenId(l.id); reloadSummary() }}
          onShowExisting={l => {
            setLeads(ls => ls.some(x => x.id === l.id) ? ls : [l, ...ls])
            setShowAdd(false); setDueOnly(false); setSourceFilter(''); setStageFilter(''); setOwner(''); setStatus('all'); setOpenId(l.id)
            setTimeout(() => document.getElementById(`lead-${l.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select value={status} onChange={e => setStatus(e.target.value as 'open' | 'closed' | 'all')} className={select}>
          <option value="open">Open</option><option value="closed">Closed</option><option value="all">Open &amp; closed</option>
        </select>
        <select value={owner} onChange={e => setOwner(e.target.value)} className={select}>
          <option value="">{isAdmin ? 'Everyone' : 'Mine & unassigned'}</option>
          <option value="mine">Mine</option>
          <option value="none">Unassigned{pool ? ` (${pool})` : ''}</option>
          {isAdmin && team.map(t => <option key={t.auth_uid} value={t.auth_uid}>{t.name}</option>)}
        </select>
        <button onClick={() => setDueOnly(v => !v)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
            dueOnly ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500'}`}>
          Due or overdue
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
          <div className="hidden md:grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5 text-xs font-semibold text-gray-500">
            <span>Name / phone</span><span>Owner</span><span>Stage</span><span>Next follow-up</span><span>Target</span><span>Actions</span>
          </div>
          {shown.map(l => (
            <LeadRow key={l.id} lead={l} today={today} isAdmin={isAdmin} myUid={myUid} team={team} nameOf={nameOf}
              open={openId === l.id} onToggle={() => setOpenId(openId === l.id ? null : l.id)}
              onSaved={replace} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Admin only: who is working which leads, and how much. */
function TeamTable({ rows, onPick }: { rows: TeamRow[]; onPick: (uid: string) => void }) {
  return (
    <div className="card overflow-x-auto">
      <h3 className="font-bold text-navy-700 text-sm mb-2">Team</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 border-b">
            <th className="text-left py-1.5 pr-3">Person</th><th className="text-right px-2">Open</th>
            <th className="text-right px-2">Due today</th><th className="text-right px-2">Overdue</th>
            <th className="text-right px-2">Touches 7d</th><th className="text-right px-2">Calls 7d</th>
            <th className="text-right px-2">Won 30d</th><th className="text-right px-2">Lost 30d</th><th className="text-left pl-3">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.auth_uid} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => onPick(r.auth_uid)}>
              <td className="py-1.5 pr-3 font-medium text-navy-700">{r.name}{r.role === 'manager' ? '' : ' (admin)'}</td>
              <td className="text-right px-2">{r.open_leads}</td>
              <td className="text-right px-2">{r.due_today || ''}</td>
              <td className={`text-right px-2 ${r.overdue ? 'text-red-600 font-semibold' : ''}`}>{r.overdue || ''}</td>
              <td className="text-right px-2">{r.touches_7d}</td>
              <td className="text-right px-2">{r.calls_7d}</td>
              <td className="text-right px-2 text-teal-700">{r.won_30d || ''}</td>
              <td className="text-right px-2 text-gray-500">{r.lost_30d || ''}</td>
              <td className="pl-3 text-gray-500 whitespace-nowrap">{r.last_touch ? dateTime(r.last_touch) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-400 mt-1.5">Click a person to see their leads.</p>
    </div>
  )
}

function LeadRow({ lead, today, isAdmin, myUid, team, nameOf, open, onToggle, onSaved, onError }: {
  lead: Lead; today: string; isAdmin: boolean; myUid: string | null; team: Assignee[]
  nameOf: (uid: string | null) => string; open: boolean
  onToggle: () => void; onSaved: (l: Lead) => void; onError: (m: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [logKind, setLogKind] = useState<ActivityKind | null>(null)
  const closed = !!lead.closed_at
  const overdue = !closed && lead.next_followup !== null && lead.next_followup < today
  const dueToday = !closed && lead.next_followup === today

  const save = async (patch: Parameters<typeof updateLead>[1]) => {
    setSaving(true)
    try { onSaved(await updateLead(lead.id, patch)); onError('') }
    catch (e) { onError(`Could not save ${lead.name || displayPhone(lead.phone)}: ${(e as Error).message}`) }
    finally { setSaving(false) }
  }
  // Clicking Call or WhatsApp opens the log with that kind ready.
  const startLog = (k: ActivityKind) => { setLogKind(k); if (!open) onToggle() }

  const iconBtn = 'inline-flex items-center justify-center w-9 h-9 rounded-lg border'
  const dateCls = (bad: boolean, warn: boolean) =>
    `text-sm border rounded-lg px-2 py-1.5 ${bad ? 'border-red-300 text-red-600' : warn ? 'border-amber-300 text-amber-700' : 'border-gray-200 text-gray-700'}`

  return (
    <div id={`lead-${lead.id}`} className={`${open ? 'bg-teal-50/30' : ''} ${closed ? 'opacity-70' : ''}`}>
      <div className="grid grid-cols-2 md:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center">
        <div className="col-span-2 md:col-span-1 min-w-0">
          <div className="font-semibold text-navy-700 truncate">{lead.name || 'No name'}</div>
          <div className="text-xs text-gray-500">{displayPhone(lead.phone)}{lead.city ? ` · ${lead.city}` : ''} · {sourceLabel(lead.source)}</div>
          {closed && <div className="text-xs font-semibold text-gray-600 mt-0.5">🏁 {closeLabel(lead.close_reason)}</div>}
        </div>
        <div className="text-sm">
          <span className="md:hidden text-xs text-gray-400 block">Owner</span>
          {isAdmin ? (
            <select value={lead.assigned_to ?? ''} disabled={saving} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white max-w-full"
              onChange={e => save({ assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              {team.map(t => <option key={t.auth_uid} value={t.auth_uid}>{t.name}</option>)}
            </select>
          ) : lead.assigned_to === myUid ? (
            <span>Me <button disabled={saving} onClick={() => save({ assigned_to: null })} className="text-xs text-gray-400 underline ml-1">give back</button></span>
          ) : !lead.assigned_to ? (
            <button disabled={saving} onClick={() => save({ assigned_to: myUid })} className="text-xs font-semibold text-teal-700 border border-teal-200 rounded-lg px-2 py-1">Take it</button>
          ) : <span className="text-gray-600">{nameOf(lead.assigned_to)}</span>}
        </div>
        <div>
          <span className="md:hidden text-xs text-gray-400 block">Stage</span>
          <select value={lead.stage} disabled={saving || closed}
            onChange={e => save({ stage: e.target.value as LeadStage })}
            className={`text-sm font-semibold rounded-lg px-2 py-1.5 border-0 ${STAGE_TONE[lead.stage]}`}>
            {LEAD_STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <span className="md:hidden text-xs text-gray-400 block">Next follow-up</span>
          <input type="date" value={lead.next_followup ?? ''} disabled={saving || closed}
            onChange={e => save({ next_followup: e.target.value || null })} className={dateCls(overdue, dueToday)} />
        </div>
        <div>
          <span className="md:hidden text-xs text-gray-400 block">Target to close</span>
          <input type="date" value={lead.target_close ?? ''} disabled={saving || closed}
            onChange={e => save({ target_close: e.target.value || null })}
            className={dateCls(!closed && !!lead.target_close && lead.target_close < today, false)} />
        </div>
        <div className="col-span-2 md:col-span-1 flex items-center gap-2">
          <a href={`tel:+${lead.phone}`} title="Call" onClick={() => startLog('call')}
            className={`${iconBtn} border-gray-200 text-navy-700 hover:bg-gray-50`}><Phone className="w-4 h-4" /></a>
          <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noreferrer" title="WhatsApp" onClick={() => startLog('whatsapp')}
            className={`${iconBtn} border-green-200 text-green-600 hover:bg-green-50`}><MessageCircle className="w-4 h-4" /></a>
          {lead.email && (
            <a href={`mailto:${lead.email}`} title="Email" onClick={() => startLog('email')}
              className={`${iconBtn} border-gray-200 text-navy-700 hover:bg-gray-50`}><Mail className="w-4 h-4" /></a>
          )}
          <button onClick={onToggle} className="text-xs font-semibold text-teal-700 inline-flex items-center gap-1 px-2 py-2">
            Activity {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {open && <Timeline lead={lead} initialKind={logKind} saving={saving} onSave={save} />}
    </div>
  )
}

function Timeline({ lead, initialKind, saving, onSave }: {
  lead: Lead; initialKind: ActivityKind | null; saving: boolean
  onSave: (patch: Parameters<typeof updateLead>[1]) => Promise<void>
}) {
  const [notes, setNotes] = useState<LeadNote[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<ActivityKind>(initialKind ?? 'call')
  const [outcome, setOutcome] = useState('')
  const [text, setText] = useState('')
  const [next, setNext] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState('')

  const load = () => {
    listNotes(lead.id).then(setNotes).catch(e => setError((e as Error).message)).finally(() => setLoading(false))
  }
  useEffect(load, [lead.id, lead.updated_at])
  useEffect(() => { if (initialKind) setKind(initialKind) }, [initialKind])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (kind === 'note' && !text.trim()) return
    if (kind === 'call' && !outcome) { setError('How did the call go?'); return }
    setPosting(true); setError('')
    try {
      await logActivity(lead.id, kind, kind === 'call' ? outcome : null, text)
      if (next) await onSave({ next_followup: next })
      setText(''); setOutcome(''); setNext('')
      load()
    } catch (err) { setError((err as Error).message) } finally { setPosting(false) }
  }

  const consent = CONSENT_TYPES.find(c => c.id === lead.consent_type)?.label
  const closed = !!lead.closed_at

  return (
    <div className="px-4 pb-4 space-y-3">
      <p className="text-xs text-gray-400">
        Added {shortDate(lead.created_at)}{consent ? ` · ${consent}` : ''}
        {lead.registered_at ? ` · registered ${shortDate(lead.registered_at)}` : ''}
        {lead.email ? ` · ${lead.email}` : ''}
      </p>

      {!closed && (
        <form onSubmit={submit} className="bg-white border border-gray-100 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_KINDS.map(k => (
              <button type="button" key={k.id} onClick={() => setKind(k.id)}
                className={`text-xs px-2.5 py-1 rounded-full border ${kind === k.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200 text-gray-600'}`}>
                {KIND_ICON[k.id]} {k.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {kind === 'call' && (
              <select value={outcome} onChange={e => setOutcome(e.target.value)} className="input-field text-sm w-auto">
                <option value="">How did it go?</option>
                {CALL_OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
            <input value={text} onChange={e => setText(e.target.value)} className="input-field flex-1 text-sm min-w-[12rem]"
              placeholder={kind === 'note' ? 'What was said? Next step?' : 'Details (optional)'} />
            <label className="text-xs text-gray-500 inline-flex items-center gap-1">Next follow-up
              <input type="date" value={next} min={new Date().toLocaleDateString('en-CA')} onChange={e => setNext(e.target.value)} className="input-field text-sm w-auto" />
            </label>
            <button type="submit" disabled={posting} className="btn-teal text-sm disabled:opacity-50">{posting ? 'Saving…' : 'Log it'}</button>
          </div>
        </form>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {closed ? (
          <button disabled={saving} onClick={() => onSave({ close_reason: null })} className="btn-outline text-xs">Reopen lead</button>
        ) : closing ? (
          <>
            <select value={reason} onChange={e => setReason(e.target.value)} className="input-field text-sm w-auto">
              <option value="">Why is it closing?</option>
              {CLOSE_REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <button disabled={saving || !reason} onClick={() => { onSave({ close_reason: reason }); setClosing(false) }} className="btn-teal text-xs disabled:opacity-50">Close lead</button>
            <button onClick={() => setClosing(false)} className="text-xs text-gray-500 underline">Cancel</button>
          </>
        ) : (
          <button onClick={() => setClosing(true)} className="btn-outline text-xs">Close lead…</button>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {loading ? <p className="text-xs text-gray-400">Loading…</p> : !notes.length ? (
        <p className="text-xs text-gray-400">Nothing yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map(n => {
            const manual = ['call', 'whatsapp', 'email', 'meeting', 'note'].includes(n.kind)
            return (
              <li key={n.id} className={`rounded-lg px-3 py-2 ${manual ? 'bg-white border border-gray-100' : 'text-gray-500'}`}>
                <p className={`text-sm ${manual ? 'text-gray-700' : 'text-xs'} whitespace-pre-wrap`}>
                  {KIND_ICON[n.kind] ?? '•'}{' '}
                  {n.kind === 'call' && <b>Call{n.outcome ? `: ${outcomeLabel(n.outcome)}` : ''}</b>}
                  {['whatsapp', 'email', 'meeting'].includes(n.kind) && <b>{ACTIVITY_KINDS.find(k => k.id === n.kind)?.label}</b>}
                  {n.note ? `${n.kind !== 'note' && manual ? ' — ' : ''}${n.note}` : ''}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">{dateTime(n.created_at)}{n.author_label ? ` · ${n.author_label}` : ''}</p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function AddLeadForm({ isAdmin, team, myUid, onCreated, onShowExisting, onCancel }: {
  isAdmin: boolean; team: Assignee[]; myUid: string | null
  onCreated: (l: Lead) => void; onShowExisting: (l: Lead) => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [source, setSource] = useState(LEAD_SOURCES[0].id)
  const [consent, setConsent] = useState(CONSENT_TYPES[0].id)
  const [assignee, setAssignee] = useState(isAdmin ? '' : myUid ?? '')
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
      onCreated(await createLead({
        name: name.trim() || null, phone: p, source, consent_type: consent,
        email: email.trim() || null, city: city.trim() || null, assigned_to: assignee || null,
      }))
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
        <label className="text-xs font-semibold text-gray-500">Email
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="input-field mt-1" />
        </label>
        <label className="text-xs font-semibold text-gray-500">City
          <input value={city} onChange={e => setCity(e.target.value)} className="input-field mt-1" />
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
        <label className="text-xs font-semibold text-gray-500">Owner
          <select value={assignee} onChange={e => setAssignee(e.target.value)} className="input-field mt-1">
            <option value="">Unassigned</option>
            {isAdmin ? team.map(t => <option key={t.auth_uid} value={t.auth_uid}>{t.name}</option>)
              : myUid && <option value={myUid}>Me</option>}
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
