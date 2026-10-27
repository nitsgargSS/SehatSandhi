import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// 0272: the plans by doctors, the add-ons and the bundle discount — every
// number editable, and the switch that puts them live. Until it is on, every
// business is priced exactly as before.

interface Settings {
  tiered_live: boolean; months6_factor: number; months12_factor: number; staff_pack_size: number; staff_pack_price: number
  bundle2_pct: number; bundle3_pct: number; ipd_beds_included: number; ipd_bed_price: number
}
interface Tier { code: string; family: string; label: string; max_doctors: number; staff_included: number; monthly_price: number; extra_doctor_price: number; is_enabled: boolean }
interface Addon { code: string; label: string; monthly_price: number; logins_included: number; is_enabled: boolean }

const num = (v: string) => (v === '' ? 0 : Number(v))

export default function PlanPricingCard() {
  const [s, setS] = useState<Settings | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('plan_settings').select('*').maybeSingle(),
      supabase.from('plan_tiers').select('*').order('sort_order'),
      supabase.from('plan_addons').select('*').order('sort_order'),
    ])
    if (a.error) { setErr(a.error.message); return }
    setS(a.data as Settings); setTiers((b.data ?? []) as Tier[]); setAddons((c.data ?? []) as Addon[])
  }
  useEffect(() => { load() }, [])

  const save = async (extra?: Partial<Settings>) => {
    if (!s) return
    setSaving(true); setErr(''); setMsg('')
    const { error } = await supabase.rpc('sehat_admin_set_plan_pricing', { p: { settings: { ...s, ...extra }, tiers, addons } })
    setSaving(false)
    if (error) setErr(error.message)
    else { setMsg('Saved.'); load() }
  }

  if (!s) return err ? <p className="text-sm text-red-600">{err}</p> : null
  const setT = (i: number, k: keyof Tier, v: unknown) => setTiers(ts => ts.map((t, j) => (j === i ? { ...t, [k]: v } : t)))
  const setA = (i: number, k: keyof Addon, v: unknown) => setAddons(as => as.map((a, j) => (j === i ? { ...a, [k]: v } : a)))
  const box = 'border border-gray-200 rounded px-2 py-1 w-20 text-sm'
  const field = (label: string, k: keyof Settings) => (
    <label className="text-xs text-gray-600 flex items-center gap-2">{label}
      <input className={box} type="number" value={Number(s[k])} onChange={e => setS({ ...s, [k]: num(e.target.value) })} />
    </label>
  )

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-navy-700">Plans by doctors &amp; add-ons</h3>
          <p className="text-xs text-gray-500">
            {s.tiered_live ? 'LIVE — new payments and renewals are priced by these plans.' : 'Not live — everyone is priced the old way until you switch this on.'}
          </p>
        </div>
        <button disabled={saving} className={s.tiered_live ? 'btn-outline text-xs py-2 px-3' : 'btn-teal text-xs py-2 px-3'}
          onClick={() => {
            const on = !s.tiered_live
            if (window.confirm(on ? 'Put the plans by doctors live? New payments and renewals will be priced by them.' : 'Take the plans off? Pricing goes back to the old single price.')) save({ tiered_live: on })
          }}>{s.tiered_live ? 'Switch off' : 'Put live'}</button>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm min-w-full">
          <thead><tr className="text-xs text-gray-500 text-left"><th className="pr-2">Plan</th><th className="pr-2">Doctors up to</th><th className="pr-2">Staff incl.</th><th className="pr-2">₹/month</th><th className="pr-2">₹ extra doctor</th><th>On</th></tr></thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={t.code}>
                <td className="pr-2 py-1">{t.label}</td>
                <td className="pr-2"><input className={box} type="number" value={t.max_doctors} onChange={e => setT(i, 'max_doctors', num(e.target.value))} /></td>
                <td className="pr-2"><input className={box} type="number" value={t.staff_included} onChange={e => setT(i, 'staff_included', num(e.target.value))} /></td>
                <td className="pr-2"><input className={box} type="number" value={t.monthly_price} onChange={e => setT(i, 'monthly_price', num(e.target.value))} /></td>
                <td className="pr-2"><input className={box} type="number" value={t.extra_doctor_price} onChange={e => setT(i, 'extra_doctor_price', num(e.target.value))} /></td>
                <td><input type="checkbox" checked={t.is_enabled} onChange={e => setT(i, 'is_enabled', e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm min-w-full">
          <thead><tr className="text-xs text-gray-500 text-left"><th className="pr-2">Add-on</th><th className="pr-2">₹/month</th><th className="pr-2">Logins incl.</th><th>On</th></tr></thead>
          <tbody>
            {addons.map((a, i) => (
              <tr key={a.code}>
                <td className="pr-2 py-1">{a.label}</td>
                <td className="pr-2"><input className={box} type="number" value={a.monthly_price} onChange={e => setA(i, 'monthly_price', num(e.target.value))} /></td>
                <td className="pr-2"><input className={box} type="number" value={a.logins_included} onChange={e => setA(i, 'logins_included', num(e.target.value))} /></td>
                <td><input type="checkbox" checked={a.is_enabled} onChange={e => setA(i, 'is_enabled', e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {field('IPD beds included', 'ipd_beds_included')}
        {field('₹ per extra bed', 'ipd_bed_price')}
        {field('Staff pack size', 'staff_pack_size')}
        {field('₹ per pack', 'staff_pack_price')}
        {field('2 add-ons % off', 'bundle2_pct')}
        {field('3+ add-ons % off', 'bundle3_pct')}
        {field('6 months = months ×', 'months6_factor')}
        {field('12 months = months ×', 'months12_factor')}
      </div>

      <div className="flex items-center gap-3">
        <button disabled={saving} className="btn-teal text-xs py-2 px-4" onClick={() => save()}>{saving ? 'Saving…' : 'Save prices'}</button>
        {msg && <span className="text-sm text-teal-700">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  )
}
