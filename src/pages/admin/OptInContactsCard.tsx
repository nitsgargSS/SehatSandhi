import { useState } from 'react'
import { supabase } from '../../lib/supabase'

// 0187: people who tapped "✅ Yes, send me health tips" on the WhatsApp bot and
// have not sent STOP since — the only audience for Sehatsandhi's own tips and
// offers broadcasts. Download as CSV and upload to AiSensy (Contacts → Import)
// for a broadcast with an approved marketing template. Saved contacts who never
// opted in are deliberately not here.

interface Row { phone: string; name: string | null; pin_code: string | null; area: string | null; opted_in_at: string | null; last_message_at: string | null }

const csv = (rows: Row[]) => {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return ['phone,name,pin_code,area,opted_in_at', ...rows.map(r => [r.phone, r.name, r.pin_code, r.area, r.opted_in_at?.slice(0, 10)].map(esc).join(','))].join('\n')
}

export default function OptInContactsCard() {
  const [pin, setPin] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('sehat_admin_optin_contacts', { p_pin: pin.trim() || null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setRows((data ?? []) as Row[])
  }
  const download = () => {
    if (!rows?.length) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }))
    a.download = `sehatsandhi-optin-${pin.trim() || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
  }

  return (
    <div className="card shadow-sm">
      <h2 className="font-bold text-navy-700 text-lg mb-1">Opted-in contacts — health tips &amp; offers</h2>
      <p className="text-sm text-gray-500 mb-3">
        People who tapped <b>“✅ Yes, send me health tips”</b> on the WhatsApp bot and have not sent STOP. Only these may get
        Sehatsandhi's promotional messages. Download and import into AiSensy for a broadcast with an approved marketing template.
      </p>
      <div className="flex gap-2 flex-wrap items-center">
        <input className="input-field w-40" placeholder="PIN code (optional)" inputMode="numeric" maxLength={6}
          value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
        <button onClick={load} disabled={busy} className="btn-teal text-sm py-2 px-4">{busy ? 'Loading…' : 'Show'}</button>
        {rows && rows.length > 0 && <button onClick={download} className="btn-outline text-sm py-2 px-4">Download CSV ({rows.length})</button>}
      </div>
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      {rows && (
        <p className="text-sm text-gray-600 mt-3">
          {rows.length === 0 ? 'Nobody has opted in yet' : `${rows.length} opted in`}{pin ? ` in and around ${pin}` : ''}.
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-2 max-h-64 overflow-auto text-sm">
          {rows.slice(0, 50).map(r => (
            <div key={r.phone} className="flex justify-between gap-2 border-t border-gray-100 py-1.5">
              <span>{r.name ?? '—'} · {r.phone}</span>
              <span className="text-gray-400">{r.pin_code ?? ''} {r.opted_in_at ? new Date(r.opted_in_at).toLocaleDateString('en-IN') : ''}</span>
            </div>
          ))}
          {rows.length > 50 && <p className="text-xs text-gray-400 pt-1">…and {rows.length - 50} more in the download.</p>}
        </div>
      )}
    </div>
  )
}
