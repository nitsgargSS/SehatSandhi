import { useEffect, useState } from 'react'
import { Download, Upload, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { addListPatient } from '../../lib/patientsApi'

// 2 Nov 2026: the people a clinic can send WhatsApp messages to, for clinics
// without the OPD software (marketing plan) as much as with it. Bookings, QR
// scans and visits fill the list by themselves; here the clinic adds people by
// hand or from an Excel / CSV sheet — name, phone and PIN code only, never
// anything medical. Each goes through sehat_register_patient as an import, so
// no automatic welcome message is sent; anyone who has sent STOP stays off
// every broadcast (sehat_marketing_audience checks opt-outs).

type Row = { fullName: string; phone: string; pinCode: string }
type Result = { added: number; failed: { row: number; name: string; why: string }[] }

const HEADERS = { name: ['name', 'full name', 'patient name', 'naam'], phone: ['phone', 'mobile', 'phone number', 'mobile number', 'number'], pin: ['pin', 'pin code', 'pincode', 'pin_code'] }
const col = (head: string[], keys: string[]) => head.findIndex(h => keys.includes(h.trim().toLowerCase()))

/** Rows from a sheet whose first line names the columns (Name, Phone, PIN code). */
function rowsFrom(table: string[][]): Row[] | string {
  const [head, ...body] = table
  if (!head) return 'The file is empty.'
  const n = col(head, HEADERS.name), p = col(head, HEADERS.phone), z = col(head, HEADERS.pin)
  if (n < 0 || p < 0) return 'The first row must name the columns: Name, Phone (and PIN code if you have it).'
  return body.map(r => ({ fullName: String(r[n] ?? '').trim(), phone: String(r[p] ?? '').trim(), pinCode: z >= 0 ? String(r[z] ?? '').trim() : '' }))
    .filter(r => r.fullName || r.phone)
}

async function readSheet(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) {
    return (await file.text()).split(/\r?\n/).filter(l => l.trim())
      .map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')))
  }
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  const out: string[][] = []
  ws?.eachRow(r => {
    const vals = (r.values as unknown[]).slice(1)
    out.push(vals.map(v => v == null ? '' : typeof v === 'object' && v && 'text' in v ? String((v as { text: unknown }).text) : String(v)))
  })
  return out
}

export default function WhatsAppPatients({ businessId }: { businessId: string }) {
  const [count, setCount] = useState<number | null>(null)
  const [one, setOne] = useState<Row>({ fullName: '', phone: '', pinCode: '' })
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const load = () => supabase.rpc('sehat_marketing_audience', { p_business: businessId, p_pins: null, p_since: null })
    .then(({ data }) => setCount((data ?? []).length))
  useEffect(() => { load() }, [businessId]) // eslint-disable-line react-hooks/exhaustive-deps

  const addOne = async () => {
    setBusy(true); setMsg(null)
    try {
      await addListPatient(businessId, one)
      setMsg({ ok: true, text: `${one.fullName} is on your list.` })
      setOne({ fullName: '', phone: '', pinCode: '' }); load()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const upload = async (file: File) => {
    setBusy(true); setMsg(null); setResult(null)
    try {
      const rows = rowsFrom(await readSheet(file))
      if (typeof rows === 'string') { setMsg({ ok: false, text: rows }); return }
      if (rows.length > 2000) { setMsg({ ok: false, text: 'Up to 2,000 people in one file, please — split it into smaller files.' }); return }
      const res: Result = { added: 0, failed: [] }
      for (const [i, r] of rows.entries()) {
        try { await addListPatient(businessId, r); res.added++ }
        catch (e) { res.failed.push({ row: i + 2, name: r.fullName || r.phone, why: (e as Error).message }) }
      }
      setResult(res); load()
    } catch (e) { setMsg({ ok: false, text: `Could not read the file: ${(e as Error).message}` }) } finally { setBusy(false) }
  }

  const sample = () => {
    const blob = new Blob(['Name,Phone,PIN code\nSunita Devi,9876543210,135001\n'], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'patient-list.csv'; a.click()
  }

  return (
    <div className="card shadow-sm space-y-4">
      <div>
        <h3 className="font-bold text-navy-700">Your patient list</h3>
        <p className="text-sm text-gray-500">
          {count === null ? 'Counting…' : <><b>{count}</b> people can get your WhatsApp messages.</>} Bookings, QR scans at your reception and visits add people by
          themselves. Add more here — name, phone and PIN code only. Anyone who sends STOP never gets your messages.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
        These are our own patients, and they agreed to get messages from our clinic.
      </label>

      <fieldset disabled={!agreed || busy} className={`space-y-4 ${agreed ? '' : 'opacity-50'}`}>
        <div className="grid sm:grid-cols-[2fr_1.4fr_1fr_auto] gap-2 items-end">
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Name</span>
            <input className="input-field" value={one.fullName} onChange={e => setOne({ ...one, fullName: e.target.value })} /></label>
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">Phone</span>
            <input className="input-field" inputMode="tel" placeholder="98765 43210" value={one.phone} onChange={e => setOne({ ...one, phone: e.target.value })} /></label>
          <label className="block"><span className="block text-xs font-semibold text-gray-600 mb-1">PIN code</span>
            <input className="input-field" inputMode="numeric" maxLength={6} value={one.pinCode} onChange={e => setOne({ ...one, pinCode: e.target.value })} /></label>
          <button onClick={addOne} disabled={!one.fullName.trim() || !one.phone.trim()} className="btn-teal text-sm px-4 py-2 inline-flex items-center gap-1 disabled:opacity-50">
            <UserPlus className="w-4 h-4" /> Add
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-outline text-sm cursor-pointer inline-flex items-center gap-1.5">
            <Upload className="w-4 h-4" /> {busy ? 'Adding…' : 'Upload Excel or CSV'}
            <input type="file" accept=".xlsx,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          </label>
          <button type="button" onClick={sample} className="text-sm text-teal-700 font-semibold inline-flex items-center gap-1">
            <Download className="w-4 h-4" /> Sample file
          </button>
          <span className="text-xs text-gray-400">First row: Name, Phone, PIN code. Up to 2,000 people a file.</span>
        </div>
      </fieldset>

      {msg && <p className={`text-sm ${msg.ok ? 'text-teal-700' : 'text-red-600'}`}>{msg.text}</p>}
      {result && (
        <div className="text-sm bg-gray-50 border border-gray-100 rounded-lg p-3 space-y-1">
          <p><b>{result.added}</b> added{result.failed.length ? <>, <b>{result.failed.length}</b> not added:</> : '.'}</p>
          {result.failed.slice(0, 20).map(f => <p key={f.row} className="text-xs text-red-600">Row {f.row} ({f.name}): {f.why}</p>)}
          {result.failed.length > 20 && <p className="text-xs text-gray-500">…and {result.failed.length - 20} more.</p>}
        </div>
      )}
    </div>
  )
}
