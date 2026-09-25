import { useEffect, useMemo, useState } from 'react'
import { MessageCircle, Wallet, Send, CheckSquare, Square } from 'lucide-react'
import { shortDate, dateTime } from '../../lib/format'
import PayListingPanel from './PayListingPanel'
import { Business } from '../../types'
import {
  WaAccess, getWaAccess,
  MarketingSettings, WaAccount, WalletTx, WaTemplate, AudienceMember, Broadcast,
  rupees, renderTemplate, getMarketingSettings, getWaAccount, getWallet, getBroadcastBlocker,
  getAudiencePins, getAudience, listTemplates, listBroadcasts, createBroadcast, topUpWallet,
} from '../../lib/marketingApi'

// A clinic's WhatsApp marketing (0116): its wallet, and broadcasts to the
// patients who agreed to hear from it.
//
// Pick PIN codes, and the matching patients load as a checklist, all ticked;
// untick anyone. The total updates as you go and is checked against the wallet
// before Send is allowed. The server repeats every check — who is consented,
// the price, the balance — so this screen is a convenience, not the guard.
//
// Until AiSensy is connected, sending is switched off platform-wide and the
// Send button says so. Nobody is charged for a message that cannot go out.

const TOP_UPS = [500, 1000, 2000, 5000]

const STATUS_TEXT: Record<string, string> = {
  pending: 'Being set up', live: 'Live', suspended: 'Suspended',
  inactive: 'Not active', active: 'Active', past_due: 'Payment due', paused: 'Paused',
}

export default function WhatsAppPanel({ businessId, businessName, prefill, business }: {
  businessId: string
  businessName: string
  prefill: { name?: string; email?: string; contact?: string }
  /** For the renewal screen, which pays through the Plan tab's own panel. */
  business: Business
}) {
  // 0122: add-on status first. Locked (7 days past the end of the paid term) or
  // never bought → only the renewal screen. Nothing behind it is deleted.
  const [access, setAccess] = useState<WaAccess | null>(null)
  const [renewOpen, setRenewOpen] = useState(false)
  useEffect(() => { getWaAccess(businessId).then(setAccess).catch(() => setAccess(null)) }, [businessId])

  if (access && (access.state === 'locked' || access.state === 'none')) {
    return (
      <div className="space-y-4">
        <div className={`rounded-xl px-4 py-3 text-sm border ${access.state === 'locked' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-teal-50 border-teal-200 text-teal-900'}`}>
          {access.state === 'locked' ? (
            <><b>WhatsApp marketing is paused.</b> Your WhatsApp plan ended on {access.expires_on ? shortDate(access.expires_on) : '—'} and
            was not renewed. Renew below to pick up where you left off — your wallet balance, patients and past broadcasts are all kept.</>
          ) : (
            <><b>Add WhatsApp to your plan</b> to send camp, notice and health-tip messages to patients who agreed to hear from you.
            It is charged with your plan every term; each message is paid separately from a wallet.</>
          )}
        </div>
        <PayListingPanel business={business} canPay onPaid={() => window.location.reload()} />
      </div>
    )
  }

  return <WhatsAppWorkspace businessId={businessId} businessName={businessName} prefill={prefill}
    banner={access?.state === 'grace' ? (
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>Your WhatsApp plan ended on <b>{access.expires_on ? shortDate(access.expires_on) : '—'}</b>. It will be
            deactivated on <b>{access.locks_on ? shortDate(access.locks_on) : '—'}</b> if not paid. Renew now to avoid interruption.</span>
          <button onClick={() => setRenewOpen(v => !v)} className="btn-teal text-sm">{renewOpen ? 'Hide' : 'Renew now'}</button>
        </div>
        {renewOpen && <PayListingPanel business={business} canPay onPaid={() => window.location.reload()} />}
      </div>
    ) : null} />
}

function WhatsAppWorkspace({ businessId, businessName, prefill, banner }: {
  businessId: string
  businessName: string
  prefill: { name?: string; email?: string; contact?: string }
  banner: React.ReactNode
}) {
  const [settings, setSettings] = useState<MarketingSettings | null>(null)
  const [account, setAccount] = useState<WaAccount | null>(null)
  const [balance, setBalance] = useState(0)
  const [txs, setTxs] = useState<WalletTx[]>([])
  const [blocker, setBlocker] = useState<string | null>(null)
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [history, setHistory] = useState<Broadcast[]>([])
  const [pins, setPins] = useState<{ pin_code: string; patients: number }[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const [s, a, w, b, t, h, p] = await Promise.all([
        getMarketingSettings(), getWaAccount(businessId), getWallet(businessId),
        getBroadcastBlocker(businessId), listTemplates(), listBroadcasts(businessId), getAudiencePins(businessId),
      ])
      setSettings(s); setAccount(a); setBalance(w.balance); setTxs(w.txs); setBlocker(b)
      setTemplates(t.filter(x => x.is_active)); setHistory(h); setPins(p); setError('')
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [businessId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-4">
      {banner}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* Status and prices */}
      <div className="card shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-navy-700 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-teal-600" /> WhatsApp marketing</h3>
            <p className="text-sm text-gray-500 mt-1">
              Send approved messages — camps, notices, health tips — to patients who agreed to hear from {businessName}.
            </p>
          </div>
          <div className="text-xs text-gray-500 text-right">
            <div>Number: <b>{account?.whatsapp_number || 'not connected'}</b> · {STATUS_TEXT[account?.status ?? 'pending']}</div>
            <div>WhatsApp add-on: <b>{account && account.subscription_status !== 'inactive'
              ? `${STATUS_TEXT[account.subscription_status]}${account.next_billing_date ? ` until ${shortDate(account.next_billing_date)}` : ''}`
              : 'not added'}</b></div>
          </div>
        </div>
        {settings && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 text-sm">
            <Price label="WhatsApp Business Verification & Activation Fee" value="Part of your plan — see the Plan tab" />
            <Price label="Each broadcast message" value={rupees(settings.per_message_paise)} />
            <Price label="Replying to a patient within 24 hours" value="Free" />
          </div>
        )}
        {blocker && <p className="mt-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">{blocker}</p>}
      </div>

      <WalletCard businessId={businessId} balance={balance} txs={txs} prefill={prefill} onChange={load} />

      {settings && (
        <Composer
          businessId={businessId} businessName={businessName} settings={settings} balance={balance}
          blocker={blocker} templates={templates} pins={pins} onSent={load}
        />
      )}

      <div className="card shadow-sm">
        <h3 className="font-bold text-navy-700 mb-3">Sent broadcasts</h3>
        {!history.length ? <p className="text-sm text-gray-400">Nothing sent yet.</p> : (
          <div className="divide-y divide-gray-100">
            {history.map(b => (
              <div key={b.id} className="py-2.5 flex items-center justify-between gap-3 text-sm flex-wrap">
                <div>
                  <div className="font-medium text-navy-700">{templates.find(t => t.id === b.template_id)?.name ?? 'Message'}</div>
                  <div className="text-xs text-gray-400">{dateTime(b.created_at)}{b.pin_codes.length ? ` · PIN ${b.pin_codes.join(', ')}` : ''}</div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div><b>{b.recipient_count}</b> patients · {rupees(b.total_cost_paise)}</div>
                  <div className="capitalize">{b.status.replace('_', ' ')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Price({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
      <div className="font-bold text-navy-700">{value}</div>
    </div>
  )
}

function WalletCard({ businessId, balance, txs, prefill, onChange }: {
  businessId: string; balance: number; txs: WalletTx[]
  prefill: { name?: string; email?: string; contact?: string }; onChange: () => void
}) {
  const [amount, setAmount] = useState(1000)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const topUp = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const after = await topUpWallet(businessId, amount, prefill)
      setMsg(`₹${amount.toLocaleString('en-IN')} added.${after !== null ? ` Balance ${rupees(after)}.` : ''}`)
      onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const TYPE: Record<WalletTx['type'], string> = {
    recharge: 'Top-up', message_send: 'Broadcast', refund: 'Refund', adjustment: 'Adjustment',
  }

  return (
    <div className="card shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-navy-700 flex items-center gap-2"><Wallet className="w-4 h-4 text-teal-600" /> Wallet</h3>
          <p className="text-3xl font-bold text-navy-700 mt-1">{rupees(balance)}</p>
          <p className="text-xs text-gray-400">Spent only on broadcast messages. Not refundable to a bank account.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {TOP_UPS.map(v => (
            <button key={v} onClick={() => setAmount(v)}
              className={`text-sm font-semibold px-3 py-1.5 rounded-full border ${amount === v ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-600'}`}>
              ₹{v.toLocaleString('en-IN')}
            </button>
          ))}
          <input type="number" min={100} max={50000} step={100} value={amount}
            onChange={e => setAmount(Math.round(Number(e.target.value) || 0))}
            className="input-field w-28 text-sm" aria-label="Top-up amount in rupees" />
          <button onClick={topUp} disabled={busy || amount < 100 || amount > 50000} className="btn-teal text-sm disabled:opacity-50">
            {busy ? 'Opening…' : 'Top up'}
          </button>
        </div>
      </div>
      {msg && <p className="mt-3 text-sm text-teal-700">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      {txs.length > 0 && (
        <div className="mt-4 divide-y divide-gray-100 text-sm">
          {txs.slice(0, 8).map(t => (
            <div key={t.id} className="py-2 flex justify-between gap-3">
              <span className="text-gray-600">{TYPE[t.type]}{t.note ? ` · ${t.note}` : ''} <span className="text-xs text-gray-400">· {shortDate(t.created_at)}</span></span>
              <span className={t.amount_paise > 0 ? 'text-teal-700 font-semibold' : 'text-gray-700'}>
                {t.amount_paise > 0 ? '+' : '−'}{rupees(Math.abs(t.amount_paise))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Composer({ businessId, businessName, settings, balance, blocker, templates, pins, onSent }: {
  businessId: string; businessName: string; settings: MarketingSettings; balance: number
  blocker: string | null; templates: WaTemplate[]; pins: { pin_code: string; patients: number }[]
  onSent: () => void
}) {
  const [chosenPins, setChosenPins] = useState<string[]>([])
  const [audience, setAudience] = useState<AudienceMember[]>([])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [loadingAud, setLoadingAud] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [params, setParams] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // Reload the checklist whenever the PINs change; everyone starts ticked.
  useEffect(() => {
    if (!chosenPins.length) { setAudience([]); setTicked(new Set()); return }
    setLoadingAud(true)
    getAudience(businessId, chosenPins)
      .then(a => { setAudience(a); setTicked(new Set(a.map(x => x.patient_member_id))) })
      .catch(e => setErr((e as Error).message))
      .finally(() => setLoadingAud(false))
  }, [businessId, chosenPins])

  const tpl = templates.find(t => t.id === templateId)
  useEffect(() => { setParams(tpl ? Array(Math.max(tpl.placeholders.length - 1, 0)).fill('') : []) }, [templateId]) // eslint-disable-line react-hooks/exhaustive-deps

  const count = ticked.size
  const cost = count * settings.per_message_paise
  const short = cost > balance
  const blanks = params.some(p => !p.trim())
  const preview = useMemo(() => tpl ? renderTemplate(tpl.body, businessName, params) : '', [tpl, businessName, params])

  const reason =
    blocker ? blocker
    : !count ? 'Choose at least one patient.'
    : !tpl ? 'Choose a message.'
    : blanks ? 'Fill in every blank in the message.'
    : short ? `This needs ${rupees(cost)}; your wallet has ${rupees(balance)}. Top up to send.`
    : null

  const togglePin = (p: string) =>
    setChosenPins(cs => cs.includes(p) ? cs.filter(x => x !== p) : [...cs, p])
  const toggle = (id: string) => setTicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const send = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await createBroadcast({ businessId, templateId, params, memberIds: [...ticked], pins: chosenPins })
      setMsg(`Queued for ${r.recipients} patients · ${rupees(r.cost_paise)} taken · balance ${rupees(r.balance_paise)}.`)
      setConfirming(false); setChosenPins([]); setTemplateId(''); onSent()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card shadow-sm space-y-4">
      <h3 className="font-bold text-navy-700 flex items-center gap-2"><Send className="w-4 h-4 text-teal-600" /> New broadcast</h3>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">1. PIN codes</p>
        {!pins.length ? (
          <p className="text-sm text-gray-500">
            No patients have agreed to WhatsApp updates yet. Open a patient's record and use
            "Patient agreed…" under WhatsApp updates to add them.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pins.map(p => (
              <button key={p.pin_code || 'none'} onClick={() => togglePin(p.pin_code)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${chosenPins.includes(p.pin_code) ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                {p.pin_code || 'No PIN'} · {p.patients}
              </button>
            ))}
          </div>
        )}
      </div>

      {chosenPins.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500">2. Patients</p>
            <div className="flex gap-3 text-xs">
              <button className="text-teal-700 font-semibold" onClick={() => setTicked(new Set(audience.map(a => a.patient_member_id)))}>Select all</button>
              <button className="text-gray-500 font-semibold" onClick={() => setTicked(new Set())}>Clear</button>
            </div>
          </div>
          {loadingAud ? <p className="text-sm text-gray-400">Loading patients…</p> : (
            <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
              {audience.map(a => {
                const on = ticked.has(a.patient_member_id)
                return (
                  <button key={a.patient_member_id} onClick={() => toggle(a.patient_member_id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
                    {on ? <CheckSquare className="w-4 h-4 text-teal-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-300 shrink-0" />}
                    <span className="flex-1 truncate text-gray-800">{a.full_name}</span>
                    <span className="text-xs text-gray-400">{a.pin_code ?? ''} · ••••{a.phone.slice(-4)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">3. Message</p>
        <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="input-field text-sm">
          <option value="">Choose a message…</option>
          {templates.map(t => (
            <option key={t.id} value={t.id} disabled={!t.approved}>
              {t.name}{t.approved ? '' : ' (awaiting WhatsApp approval)'}
            </option>
          ))}
        </select>
        {tpl && (
          <div className="mt-3 space-y-2">
            {tpl.placeholders.slice(1).map((ph, i) => (
              <label key={i} className="block text-xs font-semibold text-gray-500">{ph}
                <input value={params[i] ?? ''} maxLength={300}
                  onChange={e => setParams(ps => ps.map((p, j) => j === i ? e.target.value : p))}
                  className="input-field mt-1 text-sm" />
              </label>
            ))}
            <div className="bg-[#e7f6ef] rounded-lg px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">{preview}</div>
          </div>
        )}
      </div>

      {/* The running total, beside the balance it has to fit in. */}
      <div className={`rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${short && count ? 'bg-red-50' : 'bg-gray-50'}`}>
        <div className="text-sm">
          <b>{count}</b> patient{count === 1 ? '' : 's'} selected — <b>{rupees(cost)}</b>
          <span className="text-xs text-gray-500"> ({rupees(settings.per_message_paise)} each)</span>
        </div>
        <div className="text-sm">Wallet: <b className={short && count ? 'text-red-600' : ''}>{rupees(balance)}</b></div>
      </div>

      {!confirming ? (
        <button onClick={() => setConfirming(true)} disabled={!!reason} className="btn-teal text-sm disabled:opacity-50">
          Send to {count} patient{count === 1 ? '' : 's'}
        </button>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm space-y-2">
          <p>Send this message to <b>{count}</b> patients? <b>{rupees(cost)}</b> will be taken from the wallet.</p>
          <div className="flex gap-2">
            <button onClick={send} disabled={busy} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Yes, send'}</button>
            <button onClick={() => setConfirming(false)} className="btn-outline text-sm">Cancel</button>
          </div>
        </div>
      )}
      {reason && count > 0 && <p className="text-xs text-gray-500">{reason}</p>}
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
