import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { shortDate } from '../../lib/format'

// Prices by business type (0117). The one place a price is set: every signup,
// dashboard renewal and reminder reads these through the server's
// computePrice. Businesses choose between them and never edit them.
//
// Changes apply from each business's next payment; a term already paid keeps
// the price it was bought at.

const TYPES: { id: string; label: string }[] = [
  { id: 'clinic', label: 'Clinic' }, { id: 'hospital', label: 'Hospital' }, { id: 'lab', label: 'Diagnostic lab' },
  { id: 'pharmacy', label: 'Pharmacy' }, { id: 'insurance', label: 'Insurance agent' }, { id: 'ambulance', label: 'Ambulance' },
]
const TERMS = [1, 6, 12]

interface Row { months: number; sub: string; wa: string; on: boolean }
interface TypeForm { rows: Row[]; commission: string; commissionOn: boolean; included: string; extra: string; updated: string | null }

export default function TypePricingCard() {
  const [forms, setForms] = useState<Record<string, TypeForm>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const load = async () => {
    const [p, v] = await Promise.all([
      supabase.from('vertical_term_prices').select('*'),
      supabase.from('vertical_billing').select('vertical, commission_percent, commission_enabled, included_doctors, extra_doctor_price'),
    ])
    if (p.error || v.error) { setError((p.error ?? v.error)!.message); return }
    const next: Record<string, TypeForm> = {}
    for (const t of TYPES) {
      const vb = (v.data ?? []).find((x: { vertical: string }) => x.vertical === t.id) as
        { commission_percent: number; commission_enabled: boolean; included_doctors: number; extra_doctor_price: number } | undefined
      const mine = (p.data ?? []).filter((x: { vertical: string }) => x.vertical === t.id) as
        { months: number; subscription_price: number; whatsapp_price: number; is_enabled: boolean; updated_at: string }[]
      next[t.id] = {
        rows: TERMS.map(m => {
          const r = mine.find(x => x.months === m)
          return { months: m, sub: String(r?.subscription_price ?? 0), wa: String(r?.whatsapp_price ?? 0), on: r?.is_enabled ?? true }
        }),
        commission: String(vb?.commission_percent ?? 0),
        commissionOn: Boolean(vb?.commission_enabled),
        included: String(vb?.included_doctors ?? 0),
        extra: String(vb?.extra_doctor_price ?? 0),
        updated: mine.map(x => x.updated_at).sort().pop() ?? null,
      }
    }
    setForms(next)
  }
  useEffect(() => { load() }, [])

  const set = (type: string, patch: Partial<TypeForm>) => setForms(f => ({ ...f, [type]: { ...f[type], ...patch } }))
  const setRow = (type: string, months: number, patch: Partial<Row>) =>
    set(type, { rows: forms[type].rows.map(r => r.months === months ? { ...r, ...patch } : r) })

  const save = async (type: string) => {
    const f = forms[type]
    const whole = (s: string) => /^\d+$/.test(s.trim())
    if (!f.rows.every(r => whole(r.sub) && whole(r.wa))) { setMsg(m => ({ ...m, [type]: 'Prices are whole rupees, 0 or more.' })); return }
    const pct = Number(f.commission)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setMsg(m => ({ ...m, [type]: 'Commission is 0–100%.' })); return }
    if (!whole(f.included) || !whole(f.extra)) { setMsg(m => ({ ...m, [type]: 'Doctor numbers are whole numbers, 0 or more.' })); return }
    setBusy(type); setMsg(m => ({ ...m, [type]: '' }))
    const { error: e } = await supabase.rpc('sehat_admin_set_type_pricing', {
      p_vertical: type,
      p_terms: f.rows.map(r => ({ months: r.months, subscription_price: Number(r.sub), whatsapp_price: Number(r.wa), is_enabled: r.on })),
      p_commission_percent: pct, p_commission_enabled: f.commissionOn,
      p_included_doctors: Number(f.included), p_extra_doctor_price: Number(f.extra),
    })
    setBusy(null)
    setMsg(m => ({ ...m, [type]: e ? e.message : 'Saved. New prices apply from each business’s next payment.' }))
    if (!e) load()
  }

  const cell = 'input-field text-sm w-24'

  return (
    <div className="card shadow-sm space-y-4">
      <div>
        <h3 className="font-bold text-navy-700">Prices by business type</h3>
        <p className="text-sm text-gray-500 mt-1">
          The Sehatsandhi subscription and the optional WhatsApp fee for each term, in whole rupees before GST.
          Businesses pick a term and whether they want WhatsApp; they cannot change a price. Coupons take money off the subscription only.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {TYPES.filter(t => forms[t.id]).map(t => {
        const f = forms[t.id]
        return (
          <div key={t.id} className="border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="font-semibold text-navy-700">{t.label}</h4>
              {f.updated && <span className="text-xs text-gray-400">Last changed {shortDate(f.updated)}</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead><tr className="text-left text-xs text-gray-400">
                  <th className="pr-3 pb-1">Term</th><th className="pr-3 pb-1">Subscription ₹</th><th className="pr-3 pb-1">WhatsApp ₹</th><th className="pb-1">Offered</th>
                </tr></thead>
                <tbody>{f.rows.map(r => (
                  <tr key={r.months}>
                    <td className="pr-3 py-1 whitespace-nowrap">{r.months === 1 ? '1 month' : `${r.months} months`}</td>
                    <td className="pr-3 py-1"><input value={r.sub} onChange={e => setRow(t.id, r.months, { sub: e.target.value })} className={cell} inputMode="numeric" /></td>
                    <td className="pr-3 py-1"><input value={r.wa} onChange={e => setRow(t.id, r.months, { wa: e.target.value })} className={cell} inputMode="numeric" /></td>
                    <td className="py-1"><input type="checkbox" checked={r.on} onChange={e => setRow(t.id, r.months, { on: e.target.checked })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4 items-end text-xs text-gray-500">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.commissionOn} onChange={e => set(t.id, { commissionOn: e.target.checked })} /> Commission</label>
              <label>% <input value={f.commission} onChange={e => set(t.id, { commission: e.target.value })} className="input-field text-sm w-20 ml-1" inputMode="decimal" /></label>
              <label>Doctors included <input value={f.included} onChange={e => set(t.id, { included: e.target.value })} className="input-field text-sm w-16 ml-1" inputMode="numeric" /></label>
              <label>₹/month per extra doctor <input value={f.extra} onChange={e => set(t.id, { extra: e.target.value })} className="input-field text-sm w-20 ml-1" inputMode="numeric" /></label>
              <button onClick={() => save(t.id)} disabled={busy === t.id} className="btn-teal text-sm disabled:opacity-50">{busy === t.id ? 'Saving…' : `Save ${t.label.toLowerCase()} prices`}</button>
            </div>
            {msg[t.id] && <p className={`text-sm ${msg[t.id].startsWith('Saved') ? 'text-teal-700' : 'text-red-600'}`}>{msg[t.id]}</p>}
          </div>
        )
      })}
    </div>
  )
}
