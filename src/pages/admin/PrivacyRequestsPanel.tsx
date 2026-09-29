import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, Plus, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { StatTile } from '../../components/Charts'
import { dateTime } from '../../lib/format'

// Privacy requests (0174) — the DPDP rights queue.
//
// The Privacy Policy promises every request is acknowledged within 24 hours
// and resolved within 15 days; this screen is how that promise is kept. The
// order of work is the order of the buttons: acknowledge → verify identity →
// look up what we hold → forward to clinics that hold records → schedule
// erasure (runs tonight at 04:00 IST, cancellable until then) → resolve or
// reject with the reply on record. Every step is logged with who did it.
//
// Clinic records are never erased from here: the clinic is the Data Fiduciary
// for them. The lookup lists those clinics so the request can be forwarded.

type Kind = 'access' | 'correct' | 'erase' | 'withdraw' | 'nominate' | 'grievance' | 'other'
type Status = 'received' | 'acknowledged' | 'verified' | 'erase_scheduled' | 'erased' | 'done' | 'rejected'

interface Req {
  id: string; ref: string; created_at: string; kind: Kind; name: string; phone: string | null; email: string | null
  on_behalf: string; details: string | null; channel: string; status: Status
  ack_due_at: string; resolve_due_at: string; acknowledged_at: string | null; verified_at: string | null
  verification_method: string | null; forwarded: { business_id: string; name: string; at: string; by: string }[]
  erase_scheduled_at: string | null; erased_at: string | null; erase_result: Record<string, unknown> | null
  resolved_at: string | null; resolution: string | null
}
interface Ev { id: number; at: string; actor: string; action: string; note: string | null }
interface Lookup {
  patient: { name: string | null; since: string; area: string | null } | null
  members: { name: string; relation: string }[]
  clinics: { business_id: string; name: string; phone: string | null; forwarded: boolean; visits: number; prescriptions: number; bills: number; appointments: number }[]
  platform: Record<string, number | boolean>
}

const KIND_LABEL: Record<Kind, string> = {
  access: 'See my data', correct: 'Correct my data', erase: 'Delete my data', withdraw: 'Withdraw consent / stop messages',
  nominate: 'Nominate someone', grievance: 'Grievance', other: 'Not classified yet',
}
const STATUS_LABEL: Record<Status, string> = {
  received: 'New', acknowledged: 'Acknowledged', verified: 'Identity verified', erase_scheduled: 'Erasure tonight',
  erased: 'Erased — send the reply', done: 'Resolved', rejected: 'Refused',
}
const PLATFORM_LABEL: Record<string, string> = {
  contact_messages: 'Contact-page messages', messages_sent: 'Messages we sent', notifications: 'Queued notifications',
  whatsapp_contact: 'WhatsApp contact record', whatsapp_sessions: 'WhatsApp conversations', ratings: 'Ratings given',
  insurance_leads: 'Insurance leads', doctor_leads: 'Doctor leads', marketing_consents: 'Clinics allowed to send promotions',
  opted_out: 'On the STOP list', business_owner: 'Owns a listed business',
}
const METHODS = ['Called back on the same number', 'Code sent on WhatsApp and read back', 'Email from the same address', 'ID document seen', 'In person']

const open = (r: Req) => !['done', 'rejected'].includes(r.status)
const hoursLeft = (iso: string) => (new Date(iso).getTime() - Date.now()) / 3.6e6

function Due({ r }: { r: Req }) {
  if (!open(r)) return null
  if (!r.acknowledged_at) {
    const h = hoursLeft(r.ack_due_at)
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${h < 0 ? 'bg-red-100 text-red-700' : h < 6 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
      {h < 0 ? `Acknowledgement overdue ${Math.ceil(-h)}h` : `Acknowledge within ${Math.ceil(h)}h`}</span>
  }
  const d = hoursLeft(r.resolve_due_at) / 24
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${d < 0 ? 'bg-red-100 text-red-700' : d < 3 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
    {d < 0 ? `Overdue by ${Math.ceil(-d)} days` : `Resolve within ${Math.ceil(d)} days`}</span>
}

function ackText(r: Req) {
  return `Namaste ${r.name.split(' ')[0]}, we have received your privacy request (${r.ref}) and will complete it by `
    + `${new Date(r.resolve_due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. `
    + `We may call this number to confirm it is you. — Sehatsandhi\n\n`
    + `नमस्ते, आपका प्राइवेसी अनुरोध (${r.ref}) हमें मिल गया है। हम इसे ${new Date(r.resolve_due_at).toLocaleDateString('hi-IN', { day: 'numeric', month: 'long' })} तक पूरा करेंगे। पहचान की पुष्टि के लिए हम इस नंबर पर कॉल कर सकते हैं। — Sehatsandhi`
}

export default function PrivacyRequestsPanel() {
  const [rows, setRows] = useState<Req[] | null>(null)
  const [show, setShow] = useState<'open' | 'closed' | 'all'>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    supabase.from('privacy_requests').select('*').order('created_at', { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) setErr(error.message); setRows((data ?? []) as Req[]) })
  }, [])
  useEffect(load, [load])

  const all = rows ?? []
  const openRows = all.filter(open)
  const ackOverdue = openRows.filter(r => !r.acknowledged_at && hoursLeft(r.ack_due_at) < 0).length
  const dueSoon = openRows.filter(r => { const d = hoursLeft(r.resolve_due_at) / 24; return d >= 0 && d < 3 }).length
  const overdue = openRows.filter(r => hoursLeft(r.resolve_due_at) < 0).length
  const shown = all.filter(r => show === 'all' || (show === 'open' ? open(r) : !open(r)))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy-700 flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Privacy requests</h2>
          <p className="text-xs text-gray-500">DPDP Act rights: acknowledge within 24 hours, resolve within 15 days. Requests from the Contact page ("My personal data") appear here by themselves.</p>
        </div>
        <button onClick={() => setAdding(v => !v)} className="btn-teal text-sm"><Plus className="w-4 h-4" /> Log a request</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Open" value={openRows.length} />
        <StatTile label="Not acknowledged in 24h" value={ackOverdue} tone={ackOverdue ? 'alert' : 'normal'} />
        <StatTile label="Due within 3 days" value={dueSoon} tone={dueSoon ? 'alert' : 'normal'} />
        <StatTile label="Past 15 days" value={overdue} tone={overdue ? 'alert' : 'normal'} />
      </div>

      {adding && <NewRequest onDone={id => { setAdding(false); setOpenId(id); load() }} onCancel={() => setAdding(false)} />}
      {err && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{err}</div>}

      <div className="flex gap-1">
        {(['open', 'closed', 'all'] as const).map(s => (
          <button key={s} onClick={() => setShow(s)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${show === s ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500'}`}>
            {s === 'open' ? 'Open' : s === 'closed' ? 'Closed' : 'All'}</button>
        ))}
      </div>

      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : shown.length === 0 ? (
        <div className="card text-center py-10 text-sm text-gray-500">{show === 'open' ? 'No open privacy requests.' : 'Nothing here.'}</div>
      ) : (
        <div className="card p-0 divide-y divide-gray-100">
          {shown.map(r => (
            <div key={r.id}>
              <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-gray-50">
                <span className="font-mono text-xs text-gray-500">{r.ref}</span>
                <b className="text-sm text-navy-700">{r.name}</b>
                <span className="text-sm text-gray-600">{KIND_LABEL[r.kind]}</span>
                <span className="text-xs text-gray-500">{STATUS_LABEL[r.status]}</span>
                <span className="text-xs text-gray-400">{dateTime(r.created_at)} · {r.channel.replace('_', ' ')}</span>
                <span className="ml-auto"><Due r={r} /></span>
              </button>
              {openId === r.id && <Detail r={r} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NewRequest({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ kind: 'other', name: '', phone: '', email: '', on_behalf: 'self', channel: 'whatsapp', details: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    if (f.name.trim().length < 2) { setErr('Name is needed.'); return }
    if (!f.phone.trim() && !f.email.trim()) { setErr('A phone number or an email is needed.'); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('sehat_privacy_create', {
      p_kind: f.kind, p_name: f.name, p_phone: f.phone || null, p_email: f.email || null,
      p_on_behalf: f.on_behalf, p_details: f.details || null, p_channel: f.channel })
    setBusy(false)
    if (error) setErr(error.message); else onDone(data as string)
  }
  const sel = 'input-field'
  return (
    <div className="card space-y-3">
      <h3 className="font-bold text-navy-700">Log a privacy request</h3>
      <div className="grid sm:grid-cols-2 gap-2">
        <select className={sel} value={f.kind} onChange={set('kind')}>{Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className={sel} value={f.channel} onChange={set('channel')}>
          <option value="whatsapp">Came on WhatsApp</option><option value="email">Came by email</option>
          <option value="phone">Came by phone call</option><option value="in_person">In person</option></select>
        <input className={sel} placeholder="Name of the person" value={f.name} onChange={set('name')} />
        <select className={sel} value={f.on_behalf} onChange={set('on_behalf')}>
          <option value="self">For themselves</option><option value="guardian">As parent / guardian</option><option value="nominee">As nominee</option></select>
        <input className={sel} placeholder="Mobile number" inputMode="numeric" value={f.phone} onChange={set('phone')} />
        <input className={sel} placeholder="Email" value={f.email} onChange={set('email')} />
      </div>
      <textarea className={sel} rows={3} placeholder="What they asked for, in their words" value={f.details} onChange={set('details')} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={save} className="btn-teal text-sm">{busy ? 'Saving…' : 'Save request'}</button>
        <button onClick={onCancel} className="btn-outline text-sm">Cancel</button>
      </div>
    </div>
  )
}

function Detail({ r, onChanged }: { r: Req; onChanged: () => void }) {
  const [events, setEvents] = useState<Ev[]>([])
  const [look, setLook] = useState<Lookup | null>(null)
  const [note, setNote] = useState('')
  const [method, setMethod] = useState(METHODS[0])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const loadEvents = useCallback(() => {
    supabase.from('privacy_request_events').select('*').eq('request_id', r.id).order('at')
      .then(({ data }) => setEvents((data ?? []) as Ev[]))
  }, [r.id])
  useEffect(loadEvents, [loadEvents, r.status])

  const act = async (action: string, extra?: string | null, withNote = false) => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sehat_privacy_action', { p_id: r.id, p_action: action, p_note: withNote ? note : null, p_extra: extra ?? null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (withNote) setNote('')
    onChanged(); loadEvents()
  }
  const lookup = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('sehat_privacy_lookup', { p_id: r.id })
    setBusy(false)
    if (error) setErr(error.message); else { setLook(data as Lookup); loadEvents() }
  }
  const isOpen = open(r)
  const wa = r.phone ? `https://wa.me/${r.phone}?text=${encodeURIComponent(ackText(r))}` : null

  return (
    <div className="px-4 pb-4 space-y-3 bg-gray-50/60">
      <div className="text-sm text-gray-700 space-y-1 pt-2">
        <div>{[r.phone && `+${r.phone}`, r.email].filter(Boolean).join(' · ')} · {r.on_behalf === 'self' ? 'for themselves' : `as ${r.on_behalf}`}</div>
        {r.details && <div className="whitespace-pre-wrap bg-white border border-gray-200 rounded-lg p-3">{r.details}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Type:</span>
          <select disabled={!isOpen || busy} className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white" value={r.kind}
            onChange={e => act('set_kind', e.target.value)}>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {r.verified_at && <span className="text-xs text-emerald-700">✓ Identity verified — {r.verification_method}</span>}
        </div>
      </div>

      {isOpen && (
        <div className="flex flex-wrap gap-2 items-center">
          {!r.acknowledged_at && <>
            {wa && <a href={wa} target="_blank" rel="noreferrer" onClick={() => act('acknowledge')}
              className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Acknowledge on WhatsApp</a>}
            <button disabled={busy} onClick={() => act('acknowledge')} className="btn-outline text-xs py-1.5 px-3">Mark acknowledged</button>
          </>}
          {!r.verified_at && <span className="inline-flex gap-1 items-center">
            <select className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white" value={method} onChange={e => setMethod(e.target.value)}>
              {METHODS.map(m => <option key={m}>{m}</option>)}</select>
            <button disabled={busy} onClick={() => act('verify', method)} className="btn-outline text-xs py-1.5 px-3">Identity verified</button>
          </span>}
          <button disabled={busy} onClick={lookup} className="btn-outline text-xs py-1.5 px-3">Look up what we hold</button>
          {r.status === 'erase_scheduled'
            ? <button disabled={busy} onClick={() => act('cancel_erase')} className="btn-outline text-xs py-1.5 px-3 text-red-600">Cancel tonight's erasure</button>
            : r.status !== 'erased' && <button disabled={busy || !r.verified_at} title={r.verified_at ? '' : 'Verify identity first'}
                onClick={() => { if (window.confirm('Erase everything Sehatsandhi holds for this person tonight at 04:00? Clinic records are not touched.')) act('schedule_erase') }}
                className="btn-outline text-xs py-1.5 px-3 text-red-600 disabled:opacity-40">Schedule erasure</button>}
        </div>
      )}
      {r.status === 'erase_scheduled' && <p className="text-xs text-amber-700">Erasure runs tonight at 04:00 IST. It can be cancelled until then. Clinic records are not touched — forward the request to the clinics below.</p>}
      {r.erase_result && (
        <div className="text-xs bg-white border border-gray-200 rounded-lg p-3">
          <b>{'error' in r.erase_result ? 'Erasure failed — nothing was changed:' : `Erased ${r.erased_at ? dateTime(r.erased_at) : ''}:`}</b>{' '}
          {Object.entries(r.erase_result).map(([k, v]) => `${PLATFORM_LABEL[k] ?? k.replace(/_/g, ' ')}: ${v}`).join(' · ')}
        </div>
      )}

      {look && (
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm space-y-2">
          <div><b>Patient record:</b> {look.patient ? `${look.patient.name ?? '—'} · since ${look.patient.since}${look.patient.area ? ` · ${look.patient.area}` : ''}` : 'none'}
            {look.members.length > 0 && <span className="text-gray-500"> · family: {look.members.map(m => `${m.name} (${m.relation})`).join(', ')}</span>}</div>
          <div className="text-gray-600">{Object.entries(look.platform).filter(([, v]) => v !== 0 && v !== false)
            .map(([k, v]) => `${PLATFORM_LABEL[k] ?? k}: ${v === true ? 'yes' : v}`).join(' · ') || 'Nothing else held by Sehatsandhi.'}</div>
          {look.clinics.length > 0 && (
            <div>
              <b>Clinics that hold records</b> <span className="text-xs text-gray-500">(they decide on their records — forward the request)</span>
              {look.clinics.map(cl => {
                const done = cl.forwarded || r.forwarded.some(f => f.business_id === cl.business_id)
                return (
                  <div key={cl.business_id} className="flex flex-wrap items-center gap-2 py-1 border-t border-gray-100">
                    <span className="font-semibold">{cl.name}</span>
                    <span className="text-xs text-gray-500">{cl.visits} visits · {cl.prescriptions} prescriptions · {cl.bills} bills · {cl.appointments} appointments{cl.phone ? ` · +${cl.phone}` : ''}</span>
                    {done ? <span className="text-xs text-emerald-700">✓ forwarded</span>
                      : isOpen && <button disabled={busy} onClick={() => act('forward', cl.business_id)} className="text-xs font-semibold text-teal-700">Mark forwarded</button>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {isOpen ? (
        <div className="space-y-2">
          <textarea className="input-field text-sm" rows={2} value={note} onChange={e => setNote(e.target.value)}
            placeholder="The reply you sent (for Resolve / Refuse), or a note" />
          <div className="flex gap-2 flex-wrap">
            <button disabled={busy || !note.trim()} onClick={() => act('resolve', null, true)} className="btn-teal text-xs py-1.5 px-3">Resolve with this reply</button>
            <button disabled={busy || !note.trim()} onClick={() => act('reject', null, true)} className="btn-outline text-xs py-1.5 px-3">Refuse with this reason</button>
            <button disabled={busy || !note.trim()} onClick={() => act('note', null, true)} className="btn-outline text-xs py-1.5 px-3">Add note</button>
          </div>
        </div>
      ) : r.resolution && <p className="text-sm"><b>{r.status === 'done' ? 'Reply:' : 'Refused:'}</b> {r.resolution}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      <ol className="text-xs text-gray-500 space-y-0.5 border-t border-gray-200 pt-2">
        {events.map(e => <li key={e.id}>{dateTime(e.at)} — <b className="text-gray-700">{e.actor}</b>: {e.action}{e.note ? ` · ${e.note.length > 160 ? e.note.slice(0, 160) + '…' : e.note}` : ''}</li>)}
      </ol>
    </div>
  )
}
