import { useEffect, useMemo, useState } from 'react'
import { StatTile } from '../../components/Charts'
import { shortDate } from '../../lib/format'
import {
  MarketingSettings, WaTemplate, MarketingReportRow, rupees,
  getMarketingSettings, updateMarketingSettings, listTemplates, updateTemplate,
  getMarketingReport, adminSetWaAccount, adminWalletAdjust,
} from '../../lib/marketingApi'

// Admin side of WhatsApp marketing (0116): the prices every clinic pays, the
// template library, and reports 1–4 from the plan.
//
// ── NUMBERS THAT ARE NOT OURS TO SET ────────────────────────────────────────
// META_RATE_PAISE is what Meta charges per marketing message in India and
// AiSensy passes through without markup (per the partner agreement). It is only
// used here to estimate our messaging bill against the ₹18 lakh refund
// milestone and our margin; clinics never see it. Update it if Meta's rate
// changes.
const META_RATE_PAISE = 109
const REFUND_MILESTONE_PAISE = 18_00_000 * 100

export default function WhatsAppMarketingPanel({ businesses }: { businesses: { id: string; name: string }[] }) {
  const [settings, setSettings] = useState<MarketingSettings | null>(null)
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [rows, setRows] = useState<MarketingReportRow[]>([])
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [s, t, r] = await Promise.all([getMarketingSettings(), listTemplates(), getMarketingReport()])
      setSettings(s); setTemplates(t); setRows(r); setError('')
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { load() }, [])

  const month = rows.reduce((s, r) => s + r.sent_this_month, 0)
  const allTime = rows.reduce((s, r) => s + r.sent_all_time, 0)
  const spent = rows.reduce((s, r) => s + r.spent_paise, 0)
  const metaBill = allTime * META_RATE_PAISE
  const margin = spent - metaBill
  const milestone = Math.min(100, (metaBill / REFUND_MILESTONE_PAISE) * 100)

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-navy-700">WhatsApp marketing</h2>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Report 4 — the platform in one row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Clinics with a live number" value={rows.filter(r => r.wa_status === 'live').length} />
        <StatTile label="Messages this month" value={month} sub={`${allTime.toLocaleString('en-IN')} all-time`} />
        <StatTile label="Message revenue (all-time)" value={rupees(spent)} sub={`about ${rupees(margin)} after Meta's rate`} />
        <StatTile label="Toward ₹18L AiSensy refund" value={`${milestone.toFixed(1)}%`} sub={`about ${rupees(metaBill)} billed`} />
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        The WhatsApp add-on is billed with each business's plan (see GST and Billing). Meta's rate is taken as {rupees(META_RATE_PAISE)} a message.
      </p>

      {settings && <SettingsCard settings={settings} onSaved={setSettings} />}

      <div className="card shadow-sm">
        <h3 className="font-bold text-navy-700 mb-1">Templates</h3>
        <p className="text-sm text-gray-500 mb-3">
          Clinics can only send templates marked approved. Tick one only after WhatsApp has approved it under our account. {'{{1}}'} is always the clinic's name.
        </p>
        <div className="divide-y divide-gray-100">
          {templates.map(t => (
            <div key={t.id} className="py-3 flex gap-3 items-start justify-between flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-navy-700">{t.name} <span className="text-xs text-gray-400">· {t.category} · {t.code}</span></div>
                <div className="text-sm text-gray-600 mt-0.5">{t.body}</div>
              </div>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={t.approved}
                  onChange={async e => { await updateTemplate(t.id, { approved: e.target.checked }).catch(x => setError(x.message)); load() }} /> Approved</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={t.is_active}
                  onChange={async e => { await updateTemplate(t.id, { is_active: e.target.checked }).catch(x => setError(x.message)); load() }} /> Offered</label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ClinicsCard rows={rows} businesses={businesses} onChange={load} onError={setError} />
    </div>
  )
}

function SettingsCard({ settings, onSaved }: { settings: MarketingSettings; onSaved: (s: MarketingSettings) => void }) {
  const toRs = (p: number) => (p / 100).toFixed(2)
  // The WhatsApp fee itself is priced per business type and term in
  // Billing → Prices by business type (0117). Only the message rate and the
  // grace period live here.
  const [form, setForm] = useState({
    perMessage: toRs(settings.per_message_paise),
    grace: String(settings.grace_days),
  })
  const [sending, setSending] = useState(settings.sending_enabled)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const paise = (v: string) => Math.round(Number(v) * 100)
  const save = async () => {
    setErr(''); setMsg('')
    const p = { pm: paise(form.perMessage), g: Number(form.grace) }
    if (!Number.isFinite(p.pm) || p.pm <= 0) { setErr('Enter the message price in rupees, e.g. 1.59.'); return }
    if (!Number.isInteger(p.g) || p.g < 0 || p.g > 60) { setErr('Grace period is 0–60 days.'); return }
    setBusy(true)
    try {
      onSaved(await updateMarketingSettings({ per_message_paise: p.pm, grace_days: p.g, sending_enabled: sending }))
      setMsg('Saved. The new message price applies from each clinic\u2019s next broadcast.')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const field = (k: keyof typeof form, label: string, suffix = '') => (
    <label className="text-xs font-semibold text-gray-500">{label}
      <div className="flex items-center gap-1 mt-1">
        <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="input-field text-sm" />
        {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
      </div>
    </label>
  )

  return (
    <div className="card shadow-sm space-y-3">
      <h3 className="font-bold text-navy-700">Message price</h3>
      <p className="text-sm text-gray-500 -mt-1">
        The WhatsApp fee (₹500 a month to start) is set per business type and term in <b>Billing → Prices by business type</b>.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {field('perMessage', 'Per broadcast message (₹)')}
        {field('grace', 'Grace after the add-on ends', 'days')}
      </div>
      <label className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <input type="checkbox" checked={sending} onChange={e => setSending(e.target.checked)} className="mt-1" />
        <span><b>Sending switched on.</b> Leave off until AiSensy is connected: while on, clinics can create broadcasts and are charged for them.</span>
      </label>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save prices'}</button>
        <span className="text-xs text-gray-400">Last changed {shortDate(settings.updated_at)}</span>
      </div>
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}

function ClinicsCard({ rows, businesses, onChange, onError }: {
  rows: MarketingReportRow[]; businesses: { id: string; name: string }[]
  onChange: () => void; onError: (m: string) => void
}) {
  const [addId, setAddId] = useState('')
  const [adjustFor, setAdjustFor] = useState<string | null>(null)
  const [adjAmount, setAdjAmount] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const monthAgo = Date.now() - 30 * 86400000

  const candidates = useMemo(() => businesses.filter(b => !rows.some(r => r.business_id === b.id)), [businesses, rows])

  const act = async (f: () => Promise<unknown>) => {
    try { await f(); onError(''); onChange() } catch (e) { onError((e as Error).message) }
  }

  const adjust = (id: string) => act(async () => {
    const paise = Math.round(Number(adjAmount) * 100)
    if (!Number.isFinite(paise) || paise === 0) throw new Error('Enter an amount in rupees, negative to deduct.')
    await adminWalletAdjust(id, paise, adjNote)
    setAdjustFor(null); setAdjAmount(''); setAdjNote('')
  })

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-navy-700">Clinics</h3>
        <div className="flex gap-2">
          <select value={addId} onChange={e => setAddId(e.target.value)} className="input-field text-sm">
            <option value="">Set up a clinic…</option>
            {candidates.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button disabled={!addId} className="btn-teal text-sm disabled:opacity-50"
            onClick={() => act(async () => { await adminSetWaAccount(addId, { status: 'pending' }); setAddId('') })}>Add</button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        A clinic appears here when it pays for the WhatsApp add-on (or when you add it). Until the in-site WhatsApp signup is built (phase 2), set its number live here once AiSensy has connected it.
      </p>
      {!rows.length ? <p className="text-sm text-gray-400">No clinic has WhatsApp marketing yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 pr-3">Clinic</th><th className="pr-3">Number</th><th className="pr-3">Subscription</th>
              <th className="pr-3">Opted in</th><th className="pr-3">Sent (month / all)</th><th className="pr-3">Last send</th>
              <th className="pr-3">Wallet</th><th className="pr-3">Recharged / spent</th><th></th>
            </tr></thead>
            <tbody>{rows.map(r => {
              const neverSent = r.wa_status === 'live' && r.sent_all_time === 0
              const dry = r.balance_paise === 0 && (!r.last_recharge_at || new Date(r.last_recharge_at).getTime() < monthAgo)
              return (
                <tr key={r.business_id} className="border-b border-gray-50 align-top">
                  <td className="py-2.5 pr-3 font-medium text-navy-700">{r.business_name}
                    {neverSent && <div className="text-[11px] text-amber-700">Live but never sent — follow up</div>}
                    {dry && <div className="text-[11px] text-red-600">Empty wallet, no recent top-up</div>}
                  </td>
                  <td className="pr-3">
                    <select value={r.wa_status ?? 'pending'} className="text-xs border border-gray-200 rounded px-1.5 py-1"
                      onChange={e => act(() => adminSetWaAccount(r.business_id, { status: e.target.value as 'pending' | 'live' | 'suspended' }))}>
                      <option value="pending">Pending</option><option value="live">Live</option><option value="suspended">Suspended</option>
                    </select>
                  </td>
                  <td className="pr-3">
                    <select value={r.subscription_status ?? 'inactive'} className="text-xs border border-gray-200 rounded px-1.5 py-1"
                      onChange={e => act(() => adminSetWaAccount(r.business_id, { subscription_status: e.target.value as 'inactive' | 'active' | 'past_due' | 'paused' }))}>
                      <option value="inactive">Inactive</option><option value="active">Active</option>
                      <option value="past_due">Payment due</option><option value="paused">Paused</option>
                    </select>
                  </td>
                  <td className="pr-3">{r.opted_in}</td>
                  <td className="pr-3">{r.sent_this_month} / {r.sent_all_time}</td>
                  <td className="pr-3 text-xs text-gray-500">{r.last_sent_at ? shortDate(r.last_sent_at) : '—'}</td>
                  <td className="pr-3 font-semibold">{rupees(r.balance_paise)}</td>
                  <td className="pr-3 text-xs text-gray-500">{rupees(r.recharged_paise)} / {rupees(r.spent_paise)}</td>
                  <td className="text-right">
                    <button className="text-xs text-teal-700 font-semibold" onClick={() => setAdjustFor(adjustFor === r.business_id ? null : r.business_id)}>Adjust wallet</button>
                    {adjustFor === r.business_id && (
                      <div className="mt-2 flex flex-col gap-1.5 items-end">
                        <input value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="₹, e.g. 50 or -50" className="input-field text-xs w-36" />
                        <input value={adjNote} onChange={e => setAdjNote(e.target.value)} placeholder="Reason" className="input-field text-xs w-36" />
                        <button onClick={() => adjust(r.business_id)} className="btn-teal text-xs">Save</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
