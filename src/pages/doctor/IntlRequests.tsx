import { useEffect, useState } from 'react'
import { Inbox, FileText, CheckCircle2 } from 'lucide-react'
import { hospitalRequests, hospitalQuote, listReports, reportUrl, feeOn, type HospitalRequest, type ReportFile } from '../../lib/intlApi'
import { inr } from '../../lib/intlContent'

// 0325: patients from abroad whose requests Sehatsandhi sent to this
// hospital. The hospital reads the case and reports and sends the doctor's
// opinion and its own price — or declines. No phone or email of the patient:
// every quote goes through Sehatsandhi.

const input = 'w-full border rounded-lg px-3 py-2 text-sm'

const STATE: Record<string, { label: string; tone: string }> = {
  asked: { label: 'Waiting for your quote', tone: 'bg-amber-50 text-amber-800' },
  quoted: { label: 'Quote sent', tone: 'bg-teal-50 text-teal-800' },
  declined: { label: 'Declined', tone: 'bg-gray-100 text-gray-600' },
}

export default function IntlRequests({ businessId, fee }: { businessId: string; fee: number }) {
  const [list, setList] = useState<HospitalRequest[] | null>(null)
  const [err, setErr] = useState('')
  const load = () => hospitalRequests(businessId).then(setList, e => setErr(e.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [businessId])
  if (err) return <div className="card text-sm text-red-700">{err}</div>
  if (!list) return null
  const waiting = list.filter(r => r.state === 'asked' && !r.closed).length
  return (
    <div className="card">
      <h3 className="font-bold text-navy-700 flex items-center gap-2"><Inbox className="w-5 h-5" /> Patient requests{waiting > 0 && <span className="rounded-full bg-amber-500 text-white text-xs px-2 py-0.5">{waiting} waiting</span>}</h3>
      <p className="text-sm text-gray-500 mt-1">Patients from abroad Sehatsandhi has sent to you. Read the case and reports, then send your doctor’s opinion and your price within 48 hours. Every quote goes through Sehatsandhi — please don’t contact the patient directly.</p>
      {list.length === 0 && <p className="text-sm text-gray-500 mt-3">No requests yet. When a patient shortlists your hospital, Sehatsandhi sends their case here and emails your coordinator.</p>}
      <div className="mt-3 space-y-3">{list.map(r => <RequestRow key={r.id} r={r} businessId={businessId} fee={fee} onChange={load} />)}</div>
    </div>
  )
}

function RequestRow({ r, businessId, fee, onChange }: { r: HospitalRequest; businessId: string; fee: number; onChange: () => void }) {
  const [open, setOpen] = useState(r.state === 'asked' && !r.closed)
  const [files, setFiles] = useState<ReportFile[] | null>(null)
  const [f, setF] = useState({
    opinion: r.opinion ?? '', plan: r.plan ?? '', doctor_name: r.doctor_name ?? '', price: r.price?.toString() ?? '',
    room_type: r.room_type ?? 'Single private room', hospital_days: r.hospital_days?.toString() ?? '', india_days: r.india_days?.toString() ?? '',
    fly_after_days: r.fly_after_days?.toString() ?? '', included: r.included ?? '', excluded: r.excluded ?? '', valid_until: r.valid_until ?? '',
  })
  const [decline, setDecline] = useState('')
  const [showDecline, setShowDecline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (open && !files) listReports(r.enquiry_id).then(setFiles, () => setFiles([])) }, [open, files, r.enquiry_id])
  const locked = r.shared || r.closed
  const num = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') })
  const send = async (p: Record<string, unknown>, done: string) => {
    setBusy(true); setErr(''); setMsg('')
    try { await hospitalQuote(businessId, r.id, p); setMsg(done); setShowDecline(false); onChange() } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const price = Number(f.price) || 0
  const st = r.chosen ? { label: 'Patient chose you', tone: 'bg-green-100 text-green-800' } : r.closed ? { label: 'Closed', tone: 'bg-gray-100 text-gray-500' } : STATE[r.state]
  return (
    <div className="border rounded-xl p-4 text-sm">
      <button onClick={() => setOpen(!open)} className="w-full text-left flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-navy-700 text-base">{r.patient}{r.country ? ` · ${r.country}` : ''}</p>
          <p className="text-gray-600">{r.procedure ?? 'Opinion needed'}{r.urgency ? ` · ${r.urgency}` : ''}{r.travel_when ? ` · travel ${r.travel_when}` : ''} · sent {new Date(r.asked_at).toLocaleDateString('en-IN')}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.tone}`}>{st.label}{r.shared && !r.chosen && !r.closed ? ' · shared with patient' : ''}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="bg-gray-50 rounded-lg p-3 space-y-1">
            {r.problem && <p className="whitespace-pre-wrap"><b>Patient wrote:</b> {r.problem}</p>}
            {r.case_note && <p className="whitespace-pre-wrap"><b>Note from Sehatsandhi:</b> {r.case_note}</p>}
            <p className="text-gray-600">{r.companions ?? 0} companion(s){r.language ? ` · prefers ${r.language}` : ''}{r.legal_ack ? ' · accepted the legal notes for this treatment' : ''}</p>
            <div className="pt-1">
              <b>Reports:</b>{' '}
              {files === null ? 'Loading…' : files.length === 0 ? <span className="text-gray-500">none yet — Sehatsandhi will add them.</span> : (
                <span className="inline-flex flex-wrap gap-2">{files.map(x => (
                  <button key={x.path} onClick={async () => { const u = await reportUrl(x.path); if (u) window.open(u, '_blank', 'noopener') }}
                    className="inline-flex items-center gap-1 text-teal-700 underline"><FileText className="w-4 h-4" />{x.name}</button>
                ))}</span>
              )}
            </div>
          </div>

          {r.state === 'declined' && <p className="text-gray-600">You declined: {r.decline_reason}</p>}
          {locked && r.state === 'quoted' && (
            <p className="flex items-center gap-1.5 text-teal-800"><CheckCircle2 className="w-4 h-4" /> Your quote of {inr(r.price ?? 0)} ({r.doctor_name}) {r.closed && !r.chosen ? 'was not chosen.' : 'is with the patient.'} To change it, message Sehatsandhi.</p>
          )}

          {!locked && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2">Doctor’s opinion on the reports *<textarea rows={3} value={f.opinion} onChange={e => setF({ ...f, opinion: e.target.value })} className={input} placeholder="What the reports show, whether the treatment is suitable, any tests needed on arrival" /></label>
                <label className="sm:col-span-2">Treatment plan<textarea rows={2} value={f.plan} onChange={e => setF({ ...f, plan: e.target.value })} className={input} placeholder="Tests, procedure, hospital stay, follow-up" /></label>
                <label>Treating doctor *<input value={f.doctor_name} onChange={e => setF({ ...f, doctor_name: e.target.value })} className={input} placeholder="Dr. Name, qualification" /></label>
                <label>Room<input value={f.room_type} onChange={e => setF({ ...f, room_type: e.target.value })} className={input} /></label>
                <label>Your price, all-inclusive package (₹) *<input inputMode="numeric" value={f.price} onChange={num('price')} className={input} /></label>
                <label>Valid until<input type="date" value={f.valid_until} onChange={e => setF({ ...f, valid_until: e.target.value })} className={input} /></label>
                <label>Days in hospital<input inputMode="numeric" value={f.hospital_days} onChange={num('hospital_days')} className={input} /></label>
                <label>Days in India in all<input inputMode="numeric" value={f.india_days} onChange={num('india_days')} className={input} /></label>
                <label>Fit to fly after (days)<input inputMode="numeric" value={f.fly_after_days} onChange={num('fly_after_days')} className={input} /></label>
                <span />
                <label>Included<textarea rows={2} value={f.included} onChange={e => setF({ ...f, included: e.target.value })} className={input} placeholder="Surgeon, OT, implants, medicines, room, meals for patient" /></label>
                <label>Not included<textarea rows={2} value={f.excluded} onChange={e => setF({ ...f, excluded: e.target.value })} className={input} placeholder="Extra days, complications, blood products" /></label>
              </div>
              {price > 0 && <p className="text-gray-600">You receive {inr(price)} from the patient at the hospital. The patient also pays Sehatsandhi’s {fee}% service fee ({inr(feeOn(price, fee))}) to Sehatsandhi; it is not added to your bill.</p>}
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => send(f, 'Quote sent to Sehatsandhi.')} className="btn-teal !px-4 !py-2 text-sm">{r.state === 'quoted' ? 'Update quote' : 'Send quote'}</button>
                <button disabled={busy} onClick={() => setShowDecline(!showDecline)} className="px-4 py-2 rounded-lg border text-sm">Decline</button>
              </div>
              {showDecline && (
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="flex-1 min-w-[240px]">Why can’t you take this patient?<input value={decline} onChange={e => setDecline(e.target.value)} className={input} placeholder="e.g. needs a speciality we do not have" /></label>
                  <button disabled={busy || decline.trim().length < 3} onClick={() => send({ decline }, 'Declined. Thank you for letting us know.')} className="px-4 py-2 rounded-lg bg-gray-700 text-white text-sm disabled:opacity-40">Confirm decline</button>
                </div>
              )}
            </>
          )}
          {(err || msg) && <p className={err ? 'text-red-700' : 'text-green-700'}>{err || msg}</p>}
        </div>
      )}
    </div>
  )
}
