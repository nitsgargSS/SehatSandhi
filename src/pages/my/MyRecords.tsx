import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ImagePlus, Send } from 'lucide-react'
import { myRecords, myThread, openRecord, sendToClinic, uploadPhoto, type ChatMessage, type Records } from '../../lib/patientApi'
import { day, Err, MyShell, when } from './MyShell'

// My health records (0197): everything clinics on Sehatsandhi saved for the
// people on this number, and the clinics themselves — call, WhatsApp, message.
const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mt-2">{children}</h2>
const Row = ({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick?: () => void }) => {
  const inner = (
    <>
      <span className="text-xl" aria-hidden>{icon}</span>
      <span className="flex-1 min-w-0"><span className="block font-semibold text-gray-800">{title}</span><span className="block text-sm text-gray-500">{sub}</span></span>
      {onClick && <span className="text-gray-400 text-xl">›</span>}
    </>
  )
  return onClick
    ? <button onClick={onClick} className="w-full text-left bg-white border border-gray-200 rounded-xl px-3 py-2.5 flex items-center gap-3 hover:bg-gray-50">{inner}</button>
    : <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 flex items-center gap-3">{inner}</div>
}
const waOf = (p: string) => `https://wa.me/${p.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`

function Records_() {
  const [r, setR] = useState<Records | null>(null)
  const [who, setWho] = useState('')
  const [err, setErr] = useState('')
  const navigate = useNavigate()
  useEffect(() => { myRecords().then(setR).catch(e => setErr((e as Error).message)) }, [])
  // The record's own page (prescription, report, bill, summary), its link renewed if it had expired.
  const open = (kind: 'rx' | 'lab' | 'bill' | 'ds', id: string) =>
    openRecord(kind, id).then(u => navigate(new URL(u).pathname)).catch(e => setErr((e as Error).message))
  if (!r) return err ? <Err msg={err} /> : <p className="text-gray-400">Loading…</p>
  const mine = <T extends { member_id: string }>(xs: T[]) => xs.filter(x => !who || x.member_id === who)
  const name = (id: string) => r.members.find(m => m.id === id)?.name ?? ''
  const many = r.members.length > 1
  const tail = (id: string) => many ? ` · ${name(id)}` : ''

  return (
    <>
      {many && (
        <div className="flex flex-wrap gap-2">
          {[{ id: '', name: 'Everyone' }, ...r.members].map(m => (
            <button key={m.id} onClick={() => setWho(m.id)}
              className={`text-sm font-bold rounded-full px-3 py-1 border ${who === m.id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-teal-700 border-teal-600'}`}>
              {m.id ? m.name.split(' ')[0] : m.name}
            </button>
          ))}
        </div>
      )}
      <Err msg={err} />

      <H>My clinics</H>
      {!r.clinics.length && <p className="text-sm text-gray-500">Clinics you visit through Sehatsandhi show here.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {r.clinics.map(c => (
          <div key={c.business_id} className="card p-4">
            <p className="font-bold text-gray-800">{c.name}</p>
            {c.address && <p className="text-sm text-gray-500">{c.address}</p>}
            <div className="flex flex-wrap gap-2 mt-3">
              <Link to={`/my/chat/${c.business_id}`} className="text-sm font-bold bg-teal-600 text-white rounded-full px-3 py-1.5">
                💬 Message{c.unread ? ` (${c.unread} new)` : ''}
              </Link>
              {c.phone && <a href={`tel:${c.phone}`} className="text-sm font-bold text-teal-700 border border-teal-600 rounded-full px-3 py-1.5">📞 Call</a>}
              {c.phone && <a href={waOf(c.phone)} target="_blank" rel="noreferrer" className="text-sm font-bold text-teal-700 border border-teal-600 rounded-full px-3 py-1.5">WhatsApp</a>}
            </div>
          </div>
        ))}
      </div>

      <H>Prescriptions</H>
      {!mine(r.prescriptions).length && <p className="text-sm text-gray-500">None yet.</p>}
      {mine(r.prescriptions).map(x => <Row key={x.id} icon="💊" title={`${day(x.date)} · ${x.doctor}`} sub={`${x.clinic}${x.diagnosis ? ` · ${x.diagnosis}` : ''}${tail(x.member_id)}`} onClick={() => open('rx', x.id)} />)}

      <H>Visits</H>
      {!mine(r.visits).length && <p className="text-sm text-gray-500">None yet.</p>}
      {mine(r.visits).map(v => <Row key={v.id} icon="🩺" title={`${v.date ? day(v.date) : ''} · ${v.clinic}`}
        sub={[v.doctor, v.diagnosis && `Diagnosis: ${v.diagnosis}`, v.advice && `Advice: ${v.advice}`, v.follow_up && `Follow-up ${day(v.follow_up)}`, many && name(v.member_id)].filter(Boolean).join(' · ')} />)}

      {!!mine(r.lab_reports).length && <H>Lab reports</H>}
      {mine(r.lab_reports).map(x => <Row key={x.id} icon="🧪" title={`${day(x.date)} · ${x.clinic}`} sub={`Report ${x.no}${x.by ? ` · ${x.by}` : ''}${tail(x.member_id)}`} onClick={() => open('lab', x.id)} />)}

      {!!mine(r.discharges).length && <H>Discharge summaries</H>}
      {mine(r.discharges).map(x => <Row key={x.id} icon="🏥" title={`${day(x.date)} · ${x.clinic}`} sub={`${x.diagnosis ?? ''}${x.doctor ? ` · ${x.doctor}` : ''}${tail(x.member_id)}`} onClick={() => open('ds', x.id)} />)}

      {!!mine(r.bills).length && <H>Bills</H>}
      {mine(r.bills).map(x => <Row key={x.id} icon="🧾" title={`${day(x.date)} · ₹${x.amount}`} sub={`${x.clinic} · bill ${x.no}${tail(x.member_id)}`} onClick={() => open('bill', x.id)} />)}

      <p className="text-sm text-gray-500 mt-2">This is what clinics on Sehatsandhi have recorded for the people on your number. To correct something, message the clinic.</p>
    </>
  )
}

export default function MyRecords() {
  return <MyShell title="My health records"><Records_ /></MyShell>
}

// ── A conversation with one clinic ─────────────────────────────────────────
function Chat() {
  const { business = '' } = useParams()
  const [clinic, setClinic] = useState<{ name: string; phone: string | null } | null>(null)
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const load = useCallback(() => {
    myThread(business).then(r => { setClinic(r.clinic); setMsgs(r.messages); setErr('') }).catch(e => setErr((e as Error).message))
  }, [business])
  useEffect(() => { load(); const i = setInterval(load, 20_000); return () => clearInterval(i) }, [load])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() && !photo) return
    setBusy(true); setErr('')
    try {
      const url = photo ? await uploadPhoto(photo) : null
      const m = await sendToClinic(business, text.trim() || '📷 Photo', url)
      setMsgs(x => [...x, m]); setText(''); setPhoto(null)
    } catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card p-0 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center gap-2">
        <span className="font-bold text-navy-700">{clinic?.name ?? '…'}</span>
        {clinic?.phone && <a href={`tel:${clinic.phone}`} className="text-sm text-teal-700 font-semibold">📞 Call</a>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50 min-h-[18rem] max-h-[28rem]">
        {!msgs.length && <p className="text-sm text-gray-400 text-center mt-8">Ask the clinic anything — reports, medicines, a follow-up. The clinic's staff will answer here.</p>}
        {msgs.map(m => (
          <div key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === 'patient' ? 'ml-auto bg-[#dcf8c6]' : 'bg-white border border-gray-100'}`}>
            {m.from === 'clinic' && m.by && <div className="text-xs font-semibold text-teal-700">{m.by}</div>}
            {m.photo_url && <a href={m.photo_url} target="_blank" rel="noreferrer"><img src={m.photo_url} alt="Photo" className="rounded-lg max-h-56 my-1" /></a>}
            <div className="whitespace-pre-wrap text-gray-800">{m.body}</div>
            <div className="text-[11px] text-gray-400 text-right">{when(m.at)}{m.from === 'patient' && m.read ? ' · seen' : ''}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <Err msg={err} />
      <form onSubmit={send} className="p-3 border-t border-gray-100 flex gap-2 items-end">
        <label className="cursor-pointer text-teal-700 p-2" title="Add a photo">
          <ImagePlus className="w-5 h-5" />
          <input type="file" accept="image/*" className="hidden" onChange={e => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <div className="flex-1">
          {photo && <p className="text-xs text-gray-500 mb-1">📷 {photo.name} <button type="button" className="text-red-600 ml-1" onClick={() => setPhoto(null)}>remove</button></p>}
          <textarea className="input-field" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Write your question"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit() } }} />
        </div>
        <button disabled={busy || (!text.trim() && !photo)} className="btn-teal px-4 disabled:opacity-50"><Send className="w-4 h-4" /> Send</button>
      </form>
    </div>
  )
}

export function MyChat() {
  return <MyShell title="Message the clinic" back="/my/records"><Chat /></MyShell>
}
