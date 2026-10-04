import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// 0196: where requests come from — the app, WhatsApp, the website or the front
// desk — for bookings, medicine orders, ambulance requests, insurance leads,
// new patients and new app sign-ins.
type Row = { what: string; channel: string; n: number }
const CHANNELS: [string, string][] = [['app', 'App'], ['whatsapp', 'WhatsApp'], ['website', 'Website'], ['front_desk', 'Front desk'], ['other', 'Other']]

export default function ChannelsSection() {
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setRows(null)
    supabase.rpc('sehat_admin_channel_report', { p_days: days }).then(({ data, error }) => {
      if (error) { setErr(error.message); setRows([]) } else setRows((data ?? []) as Row[])
    })
  }, [days])
  const whats = Array.from(new Set((rows ?? []).map(r => r.what)))
  const n = (w: string, c: string) => Number(rows?.find(r => r.what === w && r.channel === c)?.n ?? 0)
  const total = (c: string) => whats.filter(w => w !== 'App sign-ins (new)').reduce((a, w) => a + n(w, c), 0)
  const grand = CHANNELS.reduce((a, [c]) => a + total(c), 0)

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-navy-700 text-lg">App vs WhatsApp vs website</h3>
        <select className="input-field w-auto" value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows && grand > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
          {CHANNELS.map(([c, l]) => (
            <div key={c} className="bg-gray-50 rounded-xl p-3">
              <div className="text-gray-500 text-xs">{l}</div>
              <div className="font-bold text-navy-700 text-lg">{total(c)}</div>
              <div className="text-xs text-gray-400">{grand ? Math.round(total(c) * 100 / grand) : 0}%</div>
            </div>
          ))}
        </div>
      )}
      {rows && rows.length === 0 && !err && <p className="text-sm text-gray-500">Nothing in this period.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3"></th>{CHANNELS.map(([c, l]) => <th key={c} className="pr-3 text-right">{l}</th>)}</tr></thead>
            <tbody>
              {whats.map(w => (
                <tr key={w} className="border-t border-gray-100">
                  <td className="py-1.5 pr-3 font-medium">{w}</td>
                  {CHANNELS.map(([c]) => <td key={c} className="pr-3 text-right tabular-nums">{n(w, c) || ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">Front desk includes clinics' own entries and imported registers. “Other” includes patients first added by a booking. App sign-ins count new patient accounts.</p>
        </div>
      )}
    </div>
  )
}
