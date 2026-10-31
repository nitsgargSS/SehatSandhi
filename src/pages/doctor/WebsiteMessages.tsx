import { Fragment, useEffect, useState } from 'react'
import { Globe, Mail, MessageCircle, Phone } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Messages from the clinic's own website (0304): Contact us, the international
// patient questionnaire, and questions for the doctor that the site's bot
// could not answer. Each new one is also emailed to the clinic.
//
// Questions can be answered here and published on the site's Q&A page, signed
// with the asker's name if they gave one, else "Anonymous". Contact and
// international messages are answered by phone or WhatsApp; this only keeps
// track of where each one stands.

interface Msg {
  id: string
  kind: 'contact' | 'international' | 'question'
  name: string | null
  phone: string | null
  email: string | null
  country: string | null
  message: string
  details: Record<string, unknown>
  status: 'new' | 'in_progress' | 'replied' | 'closed'
  reply: string | null
  publish: boolean
  public_name: string | null
  created_at: string
}

const KINDS: { key: Msg['kind'] | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'question', label: 'Questions' },
  { key: 'international', label: 'International' },
  { key: 'contact', label: 'Contact us' },
]
const KIND_LABEL: Record<Msg['kind'], string> = { contact: 'Contact us', international: 'International patient', question: 'Question' }
const STATUS: { key: Msg['status']; label: string; cls: string }[] = [
  { key: 'new', label: 'New', cls: 'bg-amber-100 text-amber-800' },
  { key: 'in_progress', label: 'In progress', cls: 'bg-sky-100 text-sky-800' },
  { key: 'replied', label: 'Replied', cls: 'bg-emerald-100 text-emerald-800' },
  { key: 'closed', label: 'Closed', cls: 'bg-gray-100 text-gray-600' },
]
const DETAIL_LABEL: Record<string, string> = {
  procedure: 'Treatment needed', city: 'City', age: 'Age', travel_from: 'Travel from', travel_to: 'Travel to',
  companions: 'People coming', room: 'Room', airport: 'Arriving at', pickup: 'Airport pickup and drop',
  visa_letter: 'Needs a visa letter', passport_country: 'Passport country', language: 'Language', reports: 'Reports',
  contact_by: 'Contact by', subject: 'Subject', bot_answer: 'Bot replied',
}
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const waLink = (phone: string) => `https://wa.me/${phone.replace(/[^0-9]/g, '').replace(/^0+/, '').replace(/^(\d{10})$/, '91$1')}`

export default function WebsiteMessages({ businessId }: { businessId: string }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null)
  const [kind, setKind] = useState<Msg['kind'] | 'all'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = async () => {
    const { data, error } = await supabase.from('clinic_site_messages')
      .select('id, kind, name, phone, email, country, message, details, status, reply, publish, public_name, created_at')
      .eq('business_id', businessId).order('created_at', { ascending: false }).limit(200)
    if (error) { setErr(error.message); setMsgs([]); return }
    setMsgs((data as Msg[]) ?? [])
  }
  useEffect(() => { load() }, [businessId])

  if (msgs === null) return null
  const shown = msgs.filter((m) => kind === 'all' || m.kind === kind)
  const fresh = msgs.filter((m) => m.status === 'new').length

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-navy-700 flex items-center gap-2">
            Messages from your website
            {fresh > 0 && <span className="text-xs font-bold bg-amber-500 text-white rounded-full px-2 py-0.5">{fresh} new</span>}
          </h3>
          <p className="text-xs text-gray-500">Contact us, international patients and questions for the doctor. Each new message is also emailed to you.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)}
              className={`text-xs px-3 py-1.5 rounded-full border ${kind === k.key ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600'}`}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {shown.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No messages yet.</p>}
      <ul className="divide-y divide-gray-100">
        {shown.map((m) => (
          <li key={m.id} className="py-3">
            <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} className="w-full text-left flex items-start gap-3">
              <span className="mt-0.5 text-teal-600">{m.kind === 'international' ? <Globe className="w-4 h-4" /> : m.kind === 'question' ? <MessageCircle className="w-4 h-4" /> : <Mail className="w-4 h-4" />}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap text-sm">
                  <b className="text-navy-700">{m.name || 'No name'}</b>
                  <span className="text-gray-400">· {KIND_LABEL[m.kind]}{m.country ? ` · ${m.country}` : ''}</span>
                  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${STATUS.find((s) => s.key === m.status)?.cls}`}>{STATUS.find((s) => s.key === m.status)?.label}</span>
                  {m.publish && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-violet-100 text-violet-800">On the website</span>}
                </span>
                <span className="block text-sm text-gray-600 truncate">{m.message}</span>
                <span className="block text-xs text-gray-400">{when(m.created_at)}</span>
              </span>
            </button>
            {open === m.id && <MessageDetail m={m} onSaved={load} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function MessageDetail({ m, onSaved }: { m: Msg; onSaved: () => void }) {
  const [status, setStatus] = useState(m.status)
  const [reply, setReply] = useState(m.reply ?? '')
  const [publish, setPublish] = useState(m.publish)
  const [publicName, setPublicName] = useState(m.public_name ?? m.name ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true); setErr('')
    const patch: Partial<Msg> = { status, reply: reply.trim() || null }
    if (m.kind === 'question') { patch.publish = publish; patch.public_name = publicName.trim() || null }
    const { error } = await supabase.from('clinic_site_messages').update(patch).eq('id', m.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    onSaved()
  }
  const details = Object.entries(m.details ?? {}).filter(([, v]) => v !== null && v !== '' && v !== false)

  return (
    <div className="mt-3 ml-7 space-y-3 text-sm">
      <p className="whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{m.message}</p>
      {details.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          {details.map(([k, v]) => (<Fragment key={k}><dt className="text-gray-500">{DETAIL_LABEL[k] ?? k}</dt><dd>{v === true ? 'Yes' : String(v)}</dd></Fragment>))}
        </dl>
      )}
      <div className="flex gap-2 flex-wrap">
        {m.phone && <a className="btn-outline text-xs inline-flex items-center gap-1" href={`tel:${m.phone}`}><Phone className="w-3.5 h-3.5" />{m.phone}</a>}
        {m.phone && <a className="btn-outline text-xs inline-flex items-center gap-1" href={waLink(m.phone)} target="_blank" rel="noreferrer"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>}
        {m.email && <a className="btn-outline text-xs inline-flex items-center gap-1" href={`mailto:${m.email}`}><Mail className="w-3.5 h-3.5" />{m.email}</a>}
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-gray-500">{m.kind === 'question' ? "Doctor's answer" : 'Note (what was done)'}</span>
        <textarea className="input-field mt-1 w-full" rows={m.kind === 'question' ? 5 : 3} value={reply} onChange={(e) => setReply(e.target.value)}
          placeholder={m.kind === 'question' ? 'Write the answer in plain words. Questions about one patient: suggest an online consultation.' : 'e.g. Called on 2 Nov, package sent on WhatsApp'} />
      </label>
      {m.kind === 'question' && (
        <div className="space-y-2 rounded-lg border border-violet-100 bg-violet-50 p-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={publish} disabled={!reply.trim()} onChange={(e) => setPublish(e.target.checked)} />
            <span>Show this question and answer on the website's Q&amp;A page</span>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Name shown on the website (leave empty for "Anonymous")</span>
            <input className="input-field mt-1 w-full" value={publicName} onChange={(e) => setPublicName(e.target.value)} placeholder="Anonymous" />
          </label>
          <p className="text-xs text-gray-500">Only general questions belong on the website. Remove anything that identifies the patient's own condition.</p>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <select className="input-field w-auto" value={status} onChange={(e) => setStatus(e.target.value as Msg['status'])}>
          {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button type="button" className="btn-teal text-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        {err && <span className="text-red-600 text-xs">{err}</span>}
      </div>
    </div>
  )
}
