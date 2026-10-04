import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, MapPin, Phone, RefreshCw, ShieldCheck, Wallet } from 'lucide-react'
import {
  leadSummary, listLeads, acceptLead, declineLead, markContacted, markWon, markLost, reportLead,
  LEAD_STATUS, LEAD_EVENT, type Lead, type LeadScope, type LeadSummary,
} from '../../lib/insuranceApi'
import { topUpWallet } from '../../lib/marketingApi'
import { DeliveryAreaCard } from './OrdersPanel'

// 0192: an insurance advisor's leads. Free to list; a flat fee per lead
// accepted, from the wallet. The first to accept gets the lead alone.
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

export default function LeadsPanel({ businessId, role }: { businessId: string; role: string | null }) {
  const [sum, setSum] = useState<LeadSummary | null>(null)
  const [scope, setScope] = useState<LeadScope>('new')
  const [leads, setLeads] = useState<Lead[]>([])
  const [counts, setCounts] = useState<Record<LeadScope, number>>({ new: 0, active: 0, done: 0 })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [topUp, setTopUp] = useState('1000')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const scopes: LeadScope[] = ['new', 'active', 'done']
      const [s, ...all] = await Promise.all([leadSummary(businessId), ...scopes.map(x => listLeads(businessId, x))])
      setSum(s as LeadSummary)
      const lists = all as Lead[][]
      setCounts({ new: lists[0].length, active: lists[1].length, done: lists[2].length })
      setLeads(lists[scopes.indexOf(scope)])
      setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [businessId, scope])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const addMoney = () => run('topup', async () => { await topUpWallet(businessId, Number(topUp)) })

  const fee = sum?.lead_fee ?? 0
  const balance = (sum?.balance_paise ?? 0) / 100

  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <h2 className="font-bold text-navy-700 text-lg">Insurance leads</h2>
          <button onClick={load} className="text-sm text-teal-700 flex items-center gap-1"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
        <p className="text-sm text-gray-500">
          People in your areas ask about health cover on WhatsApp. You see what they want before you decide; accept and you pay
          ₹{fee} from your wallet, and the lead is yours alone — their name and number come to you only. Nothing is charged on any policy.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Wallet</div>
            <div className="font-bold text-navy-700 text-xl">₹{balance.toLocaleString('en-IN')}</div>
            <div className="text-xs text-gray-500">{fee > 0 ? `Enough for ${Math.floor(balance / fee)} lead${Math.floor(balance / fee) === 1 ? '' : 's'}` : 'Leads are free right now'}</div>
            {sum?.is_owner && (
              <div className="flex gap-2 mt-2">
                <input className="input-field w-28" inputMode="numeric" value={topUp} onChange={e => setTopUp(e.target.value.replace(/\D/g, ''))} />
                <button disabled={busy === 'topup' || Number(topUp) < 100} onClick={addMoney} className="btn-teal text-sm py-2 px-3">Top up</button>
              </div>
            )}
          </div>
          <div className={`rounded-xl p-3 ${sum?.licence ? 'bg-gray-50' : 'bg-amber-50 border border-amber-300'}`}>
            <div className="text-xs text-gray-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> IRDAI licence / POSP code</div>
            {sum?.licence
              ? <div className="font-bold text-navy-700">{sum.licence}</div>
              : <div className="text-sm text-amber-800">Not added. Add it in the <b>Business</b> tab (registration no.) — you cannot accept leads without it, and people are shown it.</div>}
          </div>
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          {([['new', 'New'], ['active', 'In hand'], ['done', 'Closed']] as [LeadScope, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${scope === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {l}{counts[k] ? ` · ${counts[k]}` : ''}
            </button>
          ))}
        </div>
      </div>

      <DeliveryAreaCard businessId={businessId} canEdit={role === 'owner' || role === 'manager'} title="Where you serve" what="advise people in" none="leads" />
      {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}
      {!loading && leads.length === 0 && (
        <div className="card shadow-sm text-sm text-gray-500">
          {scope === 'new' ? 'No new leads in your areas right now. New ones appear here and as an alert in the Sehatsandhi app.'
            : scope === 'active' ? 'No leads in hand.' : 'No closed leads in the last 90 days.'}
        </div>
      )}
      {leads.map(l => <LeadCard key={l.id} l={l} fee={fee} businessId={businessId} busy={busy === l.id} run={fn => run(l.id, fn)} />)}
    </div>
  )
}

// 0195: the only reasons a lead can be reported, and how long after accepting.
const REPORT_REASONS: [string, string, number][] = [
  ['wrong_number', 'Wrong or switched-off number', 48],
  ['duplicate', 'A lead I already have (same number)', 48],
  ['never_asked', 'The person says they never asked for insurance', 72],
  ['not_health_or_area', 'Not health insurance, or not my area', 72],
]

function LeadCard({ l, fee, businessId, busy, run }: { l: Lead; fee: number; businessId: string; busy: boolean; run: (fn: () => Promise<unknown>) => void }) {
  const [open, setOpen] = useState(['open', 'accepted', 'contacted'].includes(l.status))
  const [note, setNote] = useState('')
  const [insurer, setInsurer] = useState('')
  const [plan, setPlan] = useState('')
  const [step, setStep] = useState<'won' | 'lost' | 'report' | null>(null)
  const [reason, setReason] = useState('')

  return (
    <div className="card shadow-sm">
      <button className="w-full text-left flex items-start justify-between gap-3" onClick={() => setOpen(v => !v)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-navy-700">{l.code}</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{LEAD_STATUS[l.status]}</span>
            {l.patient_not_called_at && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Says you haven't called</span>}
          </div>
          <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap"><MapPin className="w-3.5 h-3.5" /> {l.pin_code} · {ago(l.created_at)}{l.patient_name ? ` · ${l.patient_name}` : ''}</div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span className="text-gray-500">Looking for</span><span>{l.cover || 'Health cover'}</span>
            <span className="text-gray-500">Who</span><span>{l.members || '—'}</span>
            <span className="text-gray-500">Call</span><span>{l.call_time || 'Any time'}</span>
          </div>
          {l.patient_phone && (
            <div className="bg-teal-50 rounded-xl p-3">
              <div className="font-semibold text-navy-700">{l.patient_name}</div>
              <a href={`tel:+${l.patient_phone}`} className="flex items-center gap-1 text-teal-700 font-semibold"><Phone className="w-4 h-4" /> +{l.patient_phone}</a>
            </div>
          )}

          {l.status === 'open' && (
            <div className="flex gap-2 flex-wrap">
              <button disabled={busy} onClick={() => run(() => acceptLead(businessId, l.id))} className="btn-teal text-sm py-2 px-4 flex items-center gap-1"><Check className="w-4 h-4" /> Accept for ₹{fee}</button>
              <button disabled={busy} onClick={() => run(() => declineLead(businessId, l.id))} className="btn-outline text-sm py-2 px-4">Not for me</button>
            </div>
          )}

          {(l.status === 'accepted' || l.status === 'contacted') && (
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap items-center">
                <input className="input-field flex-1 min-w-[180px]" placeholder="Note (optional) — e.g. called, sending quotes" value={note} onChange={e => setNote(e.target.value)} />
                <button disabled={busy} onClick={() => run(() => markContacted(businessId, l.id, note))} className="btn-outline text-sm py-2 px-4">Spoke to them</button>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setStep('won')} className="btn-teal text-sm py-2 px-4">Policy bought</button>
                <button onClick={() => setStep('lost')} className="btn-outline text-sm py-2 px-4">Not bought</button>
                <button onClick={() => setStep('report')} className="text-sm text-amber-700 underline">Report a problem</button>
              </div>
              {step === 'won' && (
                <div className="flex gap-2 flex-wrap items-center bg-teal-50 rounded-xl p-3">
                  <input className="input-field flex-1 min-w-[150px]" placeholder="Insurer (e.g. Star Health)" value={insurer} onChange={e => setInsurer(e.target.value)} />
                  <input className="input-field flex-1 min-w-[150px]" placeholder="Plan (optional)" value={plan} onChange={e => setPlan(e.target.value)} />
                  <button disabled={busy || !insurer.trim()} onClick={() => run(() => markWon(businessId, l.id, insurer.trim(), plan))} className="btn-teal text-sm py-2 px-4">Save</button>
                </div>
              )}
              {step === 'lost' && (
                <div className="flex gap-2 flex-wrap items-center bg-gray-50 rounded-xl p-3">
                  <input className="input-field flex-1 min-w-[180px]" placeholder="Why? (optional) — e.g. bought elsewhere, too costly" value={note} onChange={e => setNote(e.target.value)} />
                  <button disabled={busy} onClick={() => run(() => markLost(businessId, l.id, note))} className="btn-outline text-sm py-2 px-4">Save</button>
                </div>
              )}
              {step === 'report' && (
                <div className="bg-amber-50 rounded-xl p-3 space-y-2">
                  <div className="font-semibold text-navy-700">Why is this lead not genuine?</div>
                  {REPORT_REASONS.map(([code, label, hours]) => {
                    const left = l.accepted_at ? new Date(l.accepted_at).getTime() + hours * 3600_000 - Date.now() : 0
                    return (
                      <label key={code} className={`flex items-start gap-2 text-sm ${left <= 0 ? 'opacity-50' : ''}`}>
                        <input type="radio" name={`r-${l.id}`} className="mt-1 accent-teal-600" disabled={left <= 0} checked={reason === code} onChange={() => setReason(code)} />
                        <span>{label} <span className="text-xs text-gray-500">— {left > 0 ? `report within ${Math.ceil(left / 3600_000)} h more` : `only within ${hours} hours of accepting`}</span></span>
                      </label>
                    )
                  })}
                  <input className="input-field w-full" placeholder="Anything to add (optional) — e.g. number switched off, tried twice" value={note} onChange={e => setNote(e.target.value)} />
                  <button disabled={busy || !reason} onClick={() => run(() => reportLead(businessId, l.id, `${reason}: ${note.trim()}`))} className="btn-outline text-sm py-2 px-4">Send to Sehatsandhi</button>
                  <p className="text-xs text-gray-600">A lead that did not convert — not interested, bought elsewhere, too costly — cannot be reported. If we find the lead was not genuine, the ₹{fee} goes back to your wallet. Some reports are decided at once from the record (for example, a duplicate is checked against your earlier leads).</p>
                </div>
              )}
            </div>
          )}

          {l.status === 'won' && <p className="text-gray-700">Policy bought: {l.insurer}{l.plan_name ? ` · ${l.plan_name}` : ''}</p>}
          {l.status === 'lost' && <p className="text-gray-500">Not bought{l.lost_reason ? ` — ${l.lost_reason}` : ''}</p>}
          {l.status === 'disputed' && <p className="text-amber-700">Reported: {l.dispute_reason}. Sehatsandhi will review it.</p>}
          {l.dispute_resolution && <p className="text-gray-500">Report {l.dispute_resolution}{l.fee_refunded ? ' — fee back in your wallet' : ''}</p>}
          {l.rating && <p className="text-gray-600">Their rating: {'★'.repeat(l.rating)}{'☆'.repeat(5 - l.rating)}{l.review ? ` — “${l.review}”` : ''}</p>}

          {l.events && l.events.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">History</summary>
              <ul className="mt-1 space-y-0.5">{l.events.map((e, i) => <li key={i}>{when(e.at)} — {LEAD_EVENT[e.event] ?? e.event}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
