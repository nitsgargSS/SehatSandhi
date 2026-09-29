import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { shortDate } from '../../lib/format'

// 0178: in-clinic test add-ons for clinics and hospitals. Per month, before GST.
// 0 makes one free (the owner switches it on themselves). A change applies to
// the next purchase and the next renewal; a term already paid is not re-priced.

interface Row { code: string; label: string; monthly_price: number; is_enabled: boolean; updated_at: string; updated_by: string | null }

export default function AddonPricingCard() {
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState<Record<string, { price: string; on: boolean }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const load = async () => {
    const { data, error } = await supabase.from('addon_prices').select('*').order('sort_order')
    if (error) { setError(error.message); return }
    const r = (data ?? []) as Row[]
    setRows(r)
    setDraft(Object.fromEntries(r.map(x => [x.code, { price: String(x.monthly_price), on: x.is_enabled }])))
  }
  useEffect(() => { load() }, [])

  const save = async (code: string) => {
    const d = draft[code]
    const price = Number(d.price)
    if (!Number.isFinite(price) || price < 0) { setMsg(m => ({ ...m, [code]: 'Enter 0 or more.' })); return }
    setBusy(code); setMsg(m => ({ ...m, [code]: '' }))
    const { error } = await supabase.rpc('sehat_admin_set_addon_price', { p_code: code, p_monthly_price: Math.round(price), p_enabled: d.on })
    setBusy(null)
    setMsg(m => ({ ...m, [code]: error ? error.message : '✓ Saved' }))
    if (!error) load()
  }

  return (
    <div className="card shadow-sm">
      <h2 className="font-bold text-navy-700 text-lg mb-1">Add-on prices — in-clinic tests</h2>
      <p className="text-sm text-gray-500 mb-4">
        What a clinic or hospital pays per month (before GST) to do these tests in-house. 0 = free, switched on by the
        owner. Bought mid-term they are charged pro rata to the end of the plan term, then renew with the plan.
        Extra doctors are priced per type in the card above.
      </p>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.code} className="flex flex-wrap items-center gap-3 border border-gray-100 rounded-xl p-3">
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold text-navy-700">{r.label}</div>
              <div className="text-xs text-gray-400">Updated {shortDate(r.updated_at)}{r.updated_by ? ` by ${r.updated_by}` : ''}</div>
            </div>
            <label className="text-sm flex items-center gap-1">₹
              <input type="number" min={0} className="input-field w-28" value={draft[r.code]?.price ?? ''}
                onChange={e => setDraft(d => ({ ...d, [r.code]: { ...d[r.code], price: e.target.value } }))} />
              <span className="text-gray-500">/month</span>
            </label>
            <label className="text-sm flex items-center gap-1">
              <input type="checkbox" checked={draft[r.code]?.on ?? true}
                onChange={e => setDraft(d => ({ ...d, [r.code]: { ...d[r.code], on: e.target.checked } }))} /> Offered
            </label>
            <button disabled={busy === r.code} onClick={() => save(r.code)} className="btn-teal text-xs py-2 px-4">{busy === r.code ? 'Saving…' : 'Save'}</button>
            {msg[r.code] && <span className={`text-xs ${msg[r.code].startsWith('✓') ? 'text-teal-700' : 'text-red-600'}`}>{msg[r.code]}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
