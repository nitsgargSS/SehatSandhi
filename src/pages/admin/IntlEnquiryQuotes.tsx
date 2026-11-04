import { useEffect, useState } from 'react'
import { FileText, Trash2, Upload, Send, Plus, X } from 'lucide-react'
import {
  askQuotes, withdrawQuote, adminQuote, unshareQuote, listReports, uploadReport, deleteReport, reportUrl, feeOn,
  TRAVEL_PRESETS, type AdminEnquiry, type QuoteRow, type ReportFile, type TravelLine,
} from '../../lib/intlApi'
import { inr } from '../../lib/intlContent'
import { supabase } from '../../lib/supabase'

// 0325: for one patient request — the reports, which hospitals were asked,
// their answers, Sehatsandhi's travel and stay lines, and sharing each quote
// with the patient. What the patient sees:
//   A. Treatment at the hospital (the hospital's price, paid at the hospital)
//   B. Sehatsandhi service fee (fee % of A — the advance that books it)
//   C. Travel and stay (these lines)
//   = estimated total.

const STATE: Record<string, string> = {
  asked: 'bg-amber-50 text-amber-800', quoted: 'bg-teal-50 text-teal-800', declined: 'bg-gray-100 text-gray-600', withdrawn: 'bg-gray-100 text-gray-400',
}

export default function EnquiryQuotes({ e, quotes, listed, name, onChange }: {
  e: AdminEnquiry; quotes: QuoteRow[]; listed: { id: string; name: string }[]; name: (id: string) => string; onChange: () => void
}) {
  const [open, setOpen] = useState(quotes.length > 0 || e.status === 'new' || e.status === 'reports')
  const [files, setFiles] = useState<ReportFile[] | null>(null)
  const asked = new Set(quotes.filter(q => q.state !== 'withdrawn').map(q => q.business_id))
  const [pick, setPick] = useState<string[]>(() => e.shortlist.filter(id => !asked.has(id) && listed.some(l => l.id === id)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [fee, setFee] = useState(10)
  const loadFiles = () => listReports(e.id).then(setFiles, x => setErr(x.message))
  useEffect(() => {
    if (!open) return
    loadFiles()
    supabase.rpc('sehat_intl_fee_pct').then(({ data }) => { if (data != null) setFee(Number(data)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(''); setMsg('')
    try { await f(); setMsg(done); onChange() } catch (x) { setErr((x as Error).message) }
    setBusy(false)
  }
  const upload = async (list: FileList | null) => {
    if (!list) return
    setBusy(true); setErr('')
    try {
      for (const f of Array.from(list)) {
        if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name} is over 20 MB.`)
        await uploadReport(e.id, f)
      }
      await loadFiles()
    } catch (x) { setErr((x as Error).message) }
    setBusy(false)
  }
  const choices = listed.filter(l => !asked.has(l.id))
  const live = quotes.filter(q => q.state !== 'withdrawn')

  return (
    <div className="mt-3 border-t pt-3">
      <button onClick={() => setOpen(!open)} className="font-semibold text-navy-700">
        {open ? '▾' : '▸'} Hospitals & quotes {live.length > 0 && <span className="font-normal text-gray-500">· {live.filter(q => q.state === 'quoted').length}/{live.length} quoted · {live.filter(q => q.shared_at).length} shared</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {/* Reports */}
          <div>
            <p className="font-semibold">Reports <span className="font-normal text-gray-500">(only Sehatsandhi and the hospitals asked can open them)</span></p>
            <div className="flex flex-wrap gap-2 mt-1 items-center">
              {files?.map(f => (
                <span key={f.path} className="inline-flex items-center gap-1 bg-gray-50 rounded-full px-2 py-0.5">
                  <button onClick={async () => { const u = await reportUrl(f.path); if (u) window.open(u, '_blank', 'noopener') }} className="inline-flex items-center gap-1 text-teal-700"><FileText className="w-3.5 h-3.5" />{f.name}</button>
                  <button title="Remove" onClick={() => run(async () => { await deleteReport(f.path); await loadFiles() }, 'Removed.')} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                </span>
              ))}
              {files?.length === 0 && <span className="text-gray-500">None yet — ask the patient to send them on WhatsApp, then add them here.</span>}
              <label className="inline-flex items-center gap-1 text-teal-700 font-semibold cursor-pointer"><Upload className="w-4 h-4" /> Add
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.dcm,.zip" className="hidden" onChange={x => { upload(x.target.files); x.target.value = '' }} /></label>
            </div>
          </div>

          {/* Ask hospitals */}
          {choices.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="font-semibold">Send to hospitals for a quote</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                {choices.map(l => (
                  <label key={l.id} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={pick.includes(l.id)} onChange={x => setPick(p => x.target.checked ? [...p, l.id] : p.filter(i => i !== l.id))} />
                    {l.name}{e.shortlist.includes(l.id) && <span className="text-xs text-teal-700">(patient’s shortlist)</span>}
                  </label>
                ))}
              </div>
              <label className="block mt-2">Case note for the hospitals (no phone or email)
                <textarea rows={2} value={note} onChange={x => setNote(x.target.value)} className="w-full border rounded-lg px-2 py-1.5" placeholder="Age, history, what the patient is asking, dates they can travel" /></label>
              <button disabled={busy || pick.length === 0} onClick={() => run(async () => { const n = await askQuotes(e.id, pick, note); setPick([]); setNote(''); return n }, 'Sent. The hospitals are emailed and see it in their dashboard.')}
                className="btn-teal !px-4 !py-1.5 text-sm mt-2 inline-flex items-center gap-1"><Send className="w-4 h-4" /> Send to {pick.length || ''} hospital{pick.length === 1 ? '' : 's'}</button>
              {files?.length === 0 && <span className="ml-2 text-amber-700">Tip: add the reports first.</span>}
            </div>
          )}
          {choices.length === 0 && live.length === 0 && <p className="text-gray-500">No listed hospitals yet.</p>}

          {/* Answers */}
          {quotes.map(q => <QuoteCard key={q.id} q={q} hospital={name(q.business_id)} fee={fee} busy={busy} run={run} />)}
          {(err || msg) && <p className={err ? 'text-red-700' : 'text-green-700'}>{err || msg}</p>}
        </div>
      )}
    </div>
  )
}

function QuoteCard({ q, hospital, fee, busy, run }: {
  q: QuoteRow; hospital: string; fee: number; busy: boolean; run: (f: () => Promise<unknown>, done: string) => Promise<void>
}) {
  const [travel, setTravel] = useState<TravelLine[]>(q.travel ?? [])
  const [note, setNote] = useState(q.admin_note ?? '')
  const pct = q.fee_pct ?? fee
  const treatment = q.price ?? 0
  const f = feeOn(treatment, pct)
  const t = travel.reduce((n, l) => n + (Number(l.amount) || 0), 0)
  const set = (i: number, v: Partial<TravelLine>) => setTravel(x => x.map((l, j) => (j === i ? { ...l, ...v } : l)))
  const shared = !!q.shared_at
  return (
    <div className={`border rounded-lg p-3 ${q.state === 'withdrawn' ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-semibold text-navy-700">{hospital}</p>
        <span className="flex gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE[q.state]}`}>{q.state}</span>
          {shared && <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-800">shared {new Date(q.shared_at!).toLocaleDateString('en-IN')}</span>}
          {q.chosen_at && <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-navy-700 text-white">chosen by patient</span>}
        </span>
      </div>
      {q.state === 'asked' && <p className="text-gray-500 mt-1">Asked {new Date(q.asked_at).toLocaleString('en-IN')} — waiting for the hospital.</p>}
      {q.state === 'declined' && <p className="text-gray-600 mt-1">Declined: {q.decline_reason}</p>}
      {q.state === 'quoted' && (
        <>
          <div className="mt-1 text-gray-700 space-y-0.5">
            <p><b>Opinion ({q.doctor_name}):</b> {q.opinion}</p>
            {q.plan && <p><b>Plan:</b> {q.plan}</p>}
            <p className="text-gray-500">{[q.room_type, q.hospital_days != null && `${q.hospital_days} days in hospital`, q.india_days != null && `${q.india_days} in India`, q.fly_after_days != null && `fly after ${q.fly_after_days}`, q.valid_until && `valid until ${new Date(q.valid_until).toLocaleDateString('en-IN')}`].filter(Boolean).join(' · ')}</p>
            {q.included && <p><b>Included:</b> {q.included}</p>}
            {q.excluded && <p><b>Not included:</b> {q.excluded}</p>}
          </div>

          <p className="font-semibold mt-3">Travel and stay (Sehatsandhi’s lines)</p>
          <div className="space-y-1.5 mt-1">
            {travel.map((l, i) => (
              <div key={i} className="grid gap-1.5 grid-cols-[1fr_110px_150px_auto] items-center">
                <input value={l.label} onChange={x => set(i, { label: x.target.value })} disabled={shared} className="border rounded px-2 py-1" placeholder="e.g. Hotel near hospital, 8 nights × ₹2,500" />
                <input inputMode="numeric" value={l.amount || ''} onChange={x => set(i, { amount: Number(x.target.value.replace(/\D/g, '')) || 0 })} disabled={shared} className="border rounded px-2 py-1" placeholder="₹" />
                <select value={l.pay} onChange={x => set(i, { pay: x.target.value as TravelLine['pay'] })} disabled={shared} className="border rounded px-2 py-1">
                  <option value="sehatsandhi">Pay Sehatsandhi</option><option value="direct">Pay directly</option></select>
                {!shared && <button onClick={() => setTravel(x => x.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>}
              </div>
            ))}
            {!shared && (
              <div className="flex flex-wrap gap-1.5">
                {TRAVEL_PRESETS.filter(p => !travel.some(l => l.label === p)).map(p => (
                  <button key={p} onClick={() => setTravel(x => [...x, { label: p, amount: 0, pay: 'sehatsandhi' }])} className="text-xs rounded-full border px-2 py-0.5 inline-flex items-center gap-0.5"><Plus className="w-3 h-3" />{p}</button>
                ))}
                <button onClick={() => setTravel(x => [...x, { label: '', amount: 0, pay: 'sehatsandhi' }])} className="text-xs rounded-full border px-2 py-0.5 inline-flex items-center gap-0.5"><Plus className="w-3 h-3" />Other</button>
              </div>
            )}
          </div>
          <label className="block mt-2">Note to the patient on this quote<input value={note} onChange={x => setNote(x.target.value)} disabled={shared} className="w-full border rounded px-2 py-1" placeholder="e.g. Hotel is 5 minutes' walk from the hospital" /></label>

          <table className="mt-3 text-sm w-full max-w-md">
            <tbody>
              <tr><td>A. Treatment at {hospital} <span className="text-gray-500">(paid at the hospital)</span></td><td className="text-right">{inr(treatment)}</td></tr>
              <tr><td>B. Sehatsandhi service fee {pct}% <span className="text-gray-500">(advance to book)</span></td><td className="text-right">{inr(f)}</td></tr>
              <tr><td>C. Travel and stay</td><td className="text-right">{inr(t)}</td></tr>
              <tr className="font-bold border-t"><td>Estimated total</td><td className="text-right">{inr(treatment + f + t)}</td></tr>
            </tbody>
          </table>

          <div className="flex flex-wrap gap-2 mt-3">
            {!shared && <>
              <button disabled={busy} onClick={() => run(() => adminQuote(q.id, travel, note, false), 'Saved.')} className="px-3 py-1.5 rounded-lg border">Save</button>
              <button disabled={busy} onClick={() => run(() => adminQuote(q.id, travel, note, true), 'Shared. The patient sees it on their tracking page.')} className="btn-teal !px-4 !py-1.5 text-sm">Share with patient</button>
            </>}
            {shared && !q.chosen_at && <button disabled={busy} onClick={() => run(() => unshareQuote(q.id), 'Taken back. You can edit it and share again.')} className="px-3 py-1.5 rounded-lg border">Take back to edit</button>}
          </div>
        </>
      )}
      {q.state !== 'withdrawn' && !q.chosen_at && (
        <button disabled={busy} onClick={() => run(() => withdrawQuote(q.id), 'Withdrawn from this hospital.')} className="text-xs text-gray-500 underline mt-2">Withdraw from this hospital</button>
      )}
    </div>
  )
}
