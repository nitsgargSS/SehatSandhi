import { useEffect, useMemo, useState } from 'react'
import OptInContactsCard from './OptInContactsCard'
import { StatTile } from '../../components/Charts'
import { shortDate, dateTime } from '../../lib/format'
import {
  MarketingSettings, WaTemplate, MarketingReportRow, BroadcastForReview, rupees, renderTemplate,
  getMarketingSettings, updateMarketingSettings, listTemplates, updateTemplate, createTemplate,
  getMarketingReport, getWalletReport, type WalletReport, getWaCosts, type WaCosts, sendTestMessage, adminSetWaAccount, adminWalletAdjust, listBroadcastsForReview, reviewBroadcast,
  setWaComplimentary, listWaComplimentary,
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

// 0155: a manager sees the review queue and the templates — not prices,
// revenue, clinics' wallets or the adjustments.
export default function WhatsAppMarketingPanel({ businesses, isManager = false }: {
  businesses: { id: string; name: string }[]
  isManager?: boolean
}) {
  const [settings, setSettings] = useState<MarketingSettings | null>(null)
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [rows, setRows] = useState<MarketingReportRow[]>([])
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [s, t, r] = await Promise.all([
        getMarketingSettings(), listTemplates(), isManager ? Promise.resolve([]) : getMarketingReport(),
      ])
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
      {/* 0187: Sehatsandhi's own opted-in audience (tips & offers). */}
      <OptInContactsCard />

      <ReviewCard />

      {!isManager && <>
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

      <WalletMoneyCard />
      <MetaCostCard />

      {settings && <SettingsCard settings={settings} onSaved={setSettings} />}
      </>}

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
        <NewTemplateForm onCreated={load} />
      </div>

      {!isManager && <ClinicsCard rows={rows} businesses={businesses} onChange={load} onError={setError} />}
    </div>
  )
}

/**
 * 0155: every clinic broadcast waits here. Approve sends it on to the sender;
 * reject needs a reason, refunds the clinic's wallet and emails them why.
 */
function ReviewCard() {
  const [pending, setPending] = useState<BroadcastForReview[]>([])
  const [recent, setRecent] = useState<BroadcastForReview[]>([])
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  // 0219: see it on a phone before approving.
  const [testPhone, setTestPhone] = useState('')
  const [testNote, setTestNote] = useState('')
  const test = async (id: string) => {
    setBusy(id); setErr(''); setTestNote('')
    try { const r = await sendTestMessage({ broadcastId: id, phone: testPhone }); setTestNote(`Test sent to the number ending ${r.to.replace('…', '')}.`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const load = () => {
    listBroadcastsForReview('pending_approval').then(setPending).catch(e => setErr(e.message))
    listBroadcastsForReview(null).then(r => setRecent(r.filter(b => b.reviewed_at).slice(0, 8))).catch(() => undefined)
  }
  useEffect(load, [])

  const act = async (id: string, approve: boolean) => {
    setBusy(id); setErr('')
    try { await reviewBroadcast(id, approve, approve ? undefined : reason); setRejecting(null); setReason(''); load() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className={`card shadow-sm ${pending.length ? 'border-2 border-amber-300' : ''}`}>
      <h3 className="font-bold text-navy-700 mb-1">Waiting for approval{pending.length ? ` (${pending.length})` : ''}</h3>
      <p className="text-sm text-gray-500 mb-3">
        Clinics' messages go out only after you approve them. Reject anything misleading, off-topic or not from the clinic —
        the clinic is refunded and told why.
      </p>
      {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
      {testNote && <p className="text-sm text-teal-700 mb-2">{testNote}</p>}
      {!pending.length && <p className="text-sm text-gray-400">Nothing waiting.</p>}
      <div className="space-y-3">
        {pending.map(b => (
          <div key={b.id} className="border border-gray-100 rounded-xl p-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-semibold text-navy-700">{b.business_name}{b.business_city ? `, ${b.business_city}` : ''}</span>
              <span className="text-gray-500">{b.template_name} · {b.category} · {b.recipient_count} patients · {rupees(b.total_cost_paise)} · {dateTime(b.created_at)}</span>
            </div>
            <div className="bg-[#e7f7ec] rounded-lg p-3 text-sm my-2 whitespace-pre-wrap">{renderTemplate(b.body, b.business_name, b.params)}</div>
            {rejecting === b.id ? (
              <div className="flex flex-wrap gap-2">
                <input className="input-field text-sm flex-1 min-w-[14rem]" autoFocus placeholder="Why? The clinic will read this."
                  value={reason} onChange={e => setReason(e.target.value)} />
                <button disabled={busy === b.id || reason.trim().length < 5} onClick={() => act(b.id, false)}
                  className="text-sm font-medium px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white disabled:opacity-50">Reject &amp; refund</button>
                <button onClick={() => { setRejecting(null); setReason('') }} className="text-sm text-gray-500 underline">Cancel</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button disabled={busy === b.id} onClick={() => act(b.id, true)} className="btn-teal text-sm py-1.5 px-4 disabled:opacity-50">Approve</button>
                <button disabled={busy === b.id} onClick={() => setRejecting(b.id)} className="btn-outline text-sm py-1.5 px-4">Reject…</button>
                <span className="flex items-center gap-1 ml-auto">
                  <input className="input-field text-sm w-36" inputMode="numeric" placeholder="Your mobile" aria-label="Mobile number for a test"
                    value={testPhone} onChange={e => setTestPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
                  <button disabled={busy === b.id || testPhone.length !== 10} onClick={() => test(b.id)} className="btn-outline text-sm py-1.5 px-3 disabled:opacity-50">Send me a test</button>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-500 mb-1">Recently reviewed</p>
          {recent.map(b => (
            <div key={b.id} className="text-xs text-gray-500 py-0.5">
              {b.status === 'rejected' ? '✗' : '✓'} {b.business_name} · {b.template_name} · {b.recipient_count} patients · by {b.reviewed_by_label}
              {b.review_note ? ` — “${b.review_note}”` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 0155: a new template for the library. {{1}} is always the clinic's name. */
function NewTemplateForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', category: 'utility' as 'utility' | 'marketing', body: 'Namaste from {{1}}. {{2}}', labels: 'Clinic name\nMessage', approved: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const count = Math.max(0, ...[...f.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])))
  const labels = f.labels.split('\n').map(l => l.trim()).filter(Boolean)

  const save = async () => {
    setErr('')
    if (!f.body.includes('{{1}}')) { setErr('Start with {{1}} — it is the clinic\'s name.'); return }
    if (labels.length !== count) { setErr(`The message has ${count} blanks; give ${count} labels, one per line.`); return }
    setBusy(true)
    try {
      await createTemplate({ name: f.name.trim(), category: f.category, body: f.body.trim(), placeholders: labels, approved: f.approved })
      setOpen(false); setF({ ...f, name: '', body: 'Namaste from {{1}}. {{2}}', labels: 'Clinic name\nMessage', approved: false }); onCreated()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="btn-outline text-sm mt-3">+ New template</button>
  return (
    <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <input className="input-field text-sm" placeholder="Name, e.g. Festival wishes" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <select className="input-field text-sm" value={f.category} onChange={e => setF({ ...f, category: e.target.value as 'utility' | 'marketing' })}>
          <option value="utility">Utility (reminders, notices)</option><option value="marketing">Marketing (offers, camps, tips)</option>
        </select>
      </div>
      <textarea className="input-field text-sm" rows={3} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
      <label className="text-xs text-gray-500 block">Labels for the blanks, one per line ({count} needed; the first is always the clinic name)
        <textarea className="input-field text-sm mt-1" rows={Math.max(2, count)} value={f.labels} onChange={e => setF({ ...f, labels: e.target.value })} />
      </label>
      <label className="text-sm inline-flex items-center gap-1.5">
        <input type="checkbox" checked={f.approved} onChange={e => setF({ ...f, approved: e.target.checked })} /> Already approved by WhatsApp (Meta)
      </label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !f.name.trim()} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save template'}</button>
        <button onClick={() => setOpen(false)} className="text-sm text-gray-500 underline">Cancel</button>
      </div>
    </div>
  )
}

// 0227: what Meta charged for the messages our numbers sent, read from its
// delivery receipts — by kind, against the month's free allowance, and what
// the bot spends per patient message and per booking.
function MetaCostCard() {
  const [c, setC] = useState<WaCosts | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { getWaCosts().then(setC).catch(e => setErr((e as Error).message)) }, [])
  const rs = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const label = (k: { category: string; type: string }) =>
    `${k.category.charAt(0).toUpperCase()}${k.category.slice(1)}${k.type ? ` · ${k.type.replace(/_/g, ' ')}` : ''}`
  const per = (a: number, b: number) => b > 0 ? (a / b).toFixed(1) : '—'

  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700">What Meta charged, this month</h3>
      <p className="text-sm text-gray-500 mt-1">
        Every message our numbers sent, with what Meta's delivery receipt said it was charged as. The rupees are Meta's "billable" verdict times our copy of its rates, before GST; Meta's invoice is the final word.
      </p>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {c && c.sent === 0 && <p className="mt-3 text-sm text-gray-500">No messages recorded yet this month.</p>}
      {c && c.sent > 0 && <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatTile label="Messages sent" value={c.sent.toLocaleString('en-IN')} sub={`${c.free.toLocaleString('en-IN')} free · ${c.billable.toLocaleString('en-IN')} charged`} />
          <StatTile label="Cost (est.)" value={rs(c.cost_rupees)} sub={c.unpriced ? `${c.unpriced} not priced yet` : undefined} />
          <StatTile label="Bot messages per patient message" value={per(c.bot.messages, c.bot.patient_messages)} sub={c.bot.two_or_more ? `${c.bot.two_or_more} answered with 2 or more` : 'one each, as intended'} tone={c.bot.two_or_more ? 'alert' : 'normal'} />
          <StatTile label="Bot messages per booking" value={per(c.bot.messages, c.bot.bookings)} sub={`${c.bot.bookings} bookings · ${c.bot.patients} patients`} />
        </div>
        {c.free_tier.map(f => (
          <p key={f.phone_number_id} className="mt-3 text-sm bg-gray-50 rounded-lg px-3 py-2">
            Number {f.phone_number_id}: <b>{f.free_used.toLocaleString('en-IN')}</b> of {f.free_allowance.toLocaleString('en-IN')} free service messages used this month
            {f.free_used >= f.free_allowance * 0.8 ? <span className="text-amber-700"> — nearly used up; replies after that are charged.</span> : '.'}
          </p>
        ))}
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500">
              <th className="py-2 pr-3">Charged as</th><th className="pr-3 text-right">Messages</th><th className="pr-3 text-right">Charged</th><th className="text-right">Cost (est.)</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {c.by_kind.map(k => (
                <tr key={k.category + k.type}>
                  <td className="py-2 pr-3 text-navy-700">{label(k)}</td>
                  <td className="pr-3 text-right">{k.messages.toLocaleString('en-IN')}</td>
                  <td className="pr-3 text-right">{k.billable.toLocaleString('en-IN')}</td>
                  <td className="text-right">{rs(k.rupees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Rates used, paise per message: service {c.rates.service}, utility {c.rates.utility}, marketing {c.rates.marketing}, authentication {c.rates.authentication}. A message with no receipt yet shows as not priced.
        </p>
      </>}
    </div>
  )
}

// 0217: money in, money spent on messages, and what Meta is expected to bill
// for them — the margin without working it out by hand.
function WalletMoneyCard() {
  const [report, setReport] = useState<WalletReport | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { getWalletReport(6).then(setReport).catch(e => setErr((e as Error).message)) }, [])
  const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700">Wallet money, month by month</h3>
      <p className="text-sm text-gray-500 mt-1">
        Top-ups reach our bank through Razorpay. Meta bills us afterwards for what was sent; its cost here is an estimate from the two Meta rates below, before GST.
      </p>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {report && <>
        <p className="mt-3 text-sm bg-gray-50 rounded-lg px-3 py-2">
          Held in wallets, not yet spent: <b>{rupees(report.unspent_paise)}</b> across {report.wallets_with_balance} {report.wallets_with_balance === 1 ? 'wallet' : 'wallets'}. This is credit clinics have paid for and can still use — not yet earned.
        </p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-3">Month</th>
                <th className="pr-3 text-right">Top-ups</th>
                <th className="pr-3 text-right">Prescriptions, bills, reports</th>
                <th className="pr-3 text-right">Broadcasts</th>
                <th className="pr-3 text-right">Meta's cost (est.)</th>
                <th className="text-right">Margin (est.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {report.months.map(m => (
                <tr key={m.month}>
                  <td className="py-2 pr-3 font-semibold text-navy-700">{monthName(m.month)}</td>
                  <td className="pr-3 text-right">{rupees(m.topups_paise)}</td>
                  <td className="pr-3 text-right">{rupees(m.direct_spent_paise)} <span className="text-xs text-gray-400">· {m.direct_messages.toLocaleString('en-IN')}</span></td>
                  <td className="pr-3 text-right">{rupees(m.broadcast_spent_paise)} <span className="text-xs text-gray-400">· {m.broadcast_messages.toLocaleString('en-IN')}</span></td>
                  <td className="pr-3 text-right">{rupees(m.meta_cost_paise)}</td>
                  <td className="text-right font-semibold text-navy-700">{rupees(m.margin_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          The small number beside each amount is how many messages. Messages that were not delivered and were refunded are left out. Lead fees and admin adjustments are not message income and are not counted here.
        </p>
      </>}
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
    perDirect: toRs(settings.direct_message_paise),
    metaMarketing: String(settings.meta_marketing_cost_paise / 100),
    metaUtility: String(settings.meta_utility_cost_paise / 100),
    grace: String(settings.grace_days),
  })
  const [sending, setSending] = useState(settings.sending_enabled)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const paise = (v: string) => Math.round(Number(v) * 100)
  const save = async () => {
    setErr(''); setMsg('')
    const p = { pm: paise(form.perMessage), pd: paise(form.perDirect), g: Number(form.grace) }
    if (!Number.isFinite(p.pm) || p.pm <= 0) { setErr('Enter the message price in rupees, e.g. 1.59.'); return }
    if (!Number.isFinite(p.pd) || p.pd <= 0) { setErr('Enter the price of a prescription, bill or report in rupees, e.g. 0.50.'); return }
    if (!Number.isInteger(p.g) || p.g < 0 || p.g > 60) { setErr('Grace period is 0–60 days.'); return }
    // Meta's rates have fractions of a paisa (₹0.8631), so these are kept to two decimals of a paisa.
    const mm = Math.round(Number(form.metaMarketing) * 10000) / 100, mu = Math.round(Number(form.metaUtility) * 10000) / 100
    if (!Number.isFinite(mm) || mm < 0 || !Number.isFinite(mu) || mu < 0) { setErr('Enter Meta\u2019s two rates in rupees, e.g. 0.8631 and 0.115.'); return }
    setBusy(true)
    try {
      onSaved(await updateMarketingSettings({ per_message_paise: p.pm, direct_message_paise: p.pd, grace_days: p.g, sending_enabled: sending,
        meta_marketing_cost_paise: mm, meta_utility_cost_paise: mu,
      }))
      setMsg('Saved. The new prices apply from each clinic\u2019s next message.')
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
      <div className="grid sm:grid-cols-3 gap-3">
        {field('perMessage', 'Per broadcast message (₹)')}
        {field('perDirect', 'Per prescription, bill or report (₹)')}
        {field('grace', 'Grace after the add-on ends', 'days')}
        {field('metaMarketing', 'Meta charges us, per promotion (₹)')}
        {field('metaUtility', 'Meta charges us, per prescription etc. (₹)')}
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
  // 0157: clinics given WhatsApp free.
  const [comp, setComp] = useState<Record<string, { on: boolean; note: string | null }>>({})
  useEffect(() => { listWaComplimentary().then(setComp).catch(() => setComp({})) }, [rows])

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
              <th className="pr-3">Wallet</th><th className="pr-3">Recharged / spent</th><th className="pr-3">Free</th><th></th>
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
                  <td className="pr-3">
                    {/* 0157: active forever, the WhatsApp fee never charged. Messages still use the wallet. */}
                    <label className="text-xs inline-flex items-center gap-1" title={comp[r.business_id]?.note ?? 'WhatsApp free — never billed'}>
                      <input type="checkbox" checked={!!comp[r.business_id]?.on}
                        onChange={e => {
                          const on = e.target.checked
                          const note = on ? window.prompt('Why is WhatsApp free for this clinic?', 'Complimentary') : null
                          if (on && note === null) return
                          act(() => setWaComplimentary(r.business_id, on, note ?? undefined))
                        }} />
                      Complimentary
                    </label>
                  </td>
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
