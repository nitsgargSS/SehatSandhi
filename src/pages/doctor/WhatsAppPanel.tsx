import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Wallet, Send, CheckSquare, Square } from 'lucide-react'
import { shortDate, dateTime } from '../../lib/format'
import PayListingPanel from './PayListingPanel'
import { supabase } from '../../lib/supabase'
import { whatsappAddon, WhatsappAddonQuote, loadRazorpayCheckout, verifyRazorpayPayment } from '../../lib/businessApi'
import { BIZ } from '../business/shared'
import { Business } from '../../types'
import {
  WaAccess, getWaAccess,
  MarketingSettings, WaAccount, WalletTx, WaTemplate, AudienceMember, Broadcast,
  rupees, renderTemplate, getMarketingSettings, getWaAccount, getWallet, getBroadcastBlocker,
  getAudiencePins, getAudience, listTemplates, type AudiencePin, listBroadcasts, createBroadcast, topUpWallet,
  acceptWaTerms, sendTestMessage, uploadBroadcastPicture, broadcastPictureUrl,
  type WaClinicTemplate, listOwnTemplates, waConnect,
  type WaAutoSettings, type WaAutoOverview, getAutoSettings, saveAutoSettings, getAutoOverview,
} from '../../lib/marketingApi'
import { embeddedSignup, loadFacebookSdk } from '../../lib/embeddedSignup'
import { WA_TERMS, WA_TERMS_VERSION, PICTURE_RULES, templateRules } from '../../lib/waTerms'
import { getSendOptions, type SendOptions } from '../../lib/sendApi'

// 0155: what each broadcast status means to the clinic.
const BROADCAST_STATUS: Record<string, string> = {
  pending_approval: 'Waiting for approval', rejected: 'Not approved', queued: 'Approved — sending soon',
  sending: 'Sending', sent: 'Sent', partly_sent: 'Partly sent', failed: 'Failed',
}

// A clinic's WhatsApp marketing (0116): its wallet, and broadcasts to the
// its own patients, until they say STOP (0239).
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

  // Mid-term (26 Sep 2026): with a plan already paid for, WhatsApp is its own
  // fee, pro rata to the plan's end — not a second plan term. The renewal
  // screen below is only for a business with no active plan to add it to.
  const [addon, setAddon] = useState<WhatsappAddonQuote | 'none' | null>(null)
  const offerable = !!access && (access.state === 'locked' || access.state === 'none')
  useEffect(() => {
    if (!offerable) return
    let live = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { if (live) setAddon('none'); return }
      whatsappAddon(businessId, 'quote', session.access_token)
        .then(q => { if (live) setAddon(q) }, () => { if (live) setAddon('none') })
    })
    return () => { live = false }
  }, [offerable, businessId])

  if (offerable && addon === null) {
    return <div className="text-sm text-gray-500 py-6">Loading…</div>
  }

  if (offerable && addon && addon !== 'none') {
    return <AddWhatsApp quote={addon} businessId={businessId} businessName={businessName}
      email={business.email || undefined} locked={access!.state === 'locked'} expiresOn={access!.expires_on} />
  }

  if (access && (access.state === 'locked' || access.state === 'none')) {
    return (
      <div className="space-y-4">
        <div className={`rounded-xl px-4 py-3 text-sm border ${access.state === 'locked' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-teal-50 border-teal-200 text-teal-900'}`}>
          {access.state === 'locked' ? (
            <><b>WhatsApp marketing is paused.</b> Your WhatsApp plan ended on {access.expires_on ? shortDate(access.expires_on) : '—'} and
            was not renewed. Renew below to pick up where you left off — your wallet balance, patients and past broadcasts are all kept.</>
          ) : (
            <><b>Add WhatsApp to your plan</b> to send camp, notice and health-tip messages to your patients.
            It is charged with your plan every term; each message is paid separately from a wallet.</>
          )}
        </div>
        <PayListingPanel business={business} canPay onPaid={() => window.location.reload()} />
      </div>
    )
  }

  return <WhatsAppWorkspace business={business} businessId={businessId} businessName={businessName} prefill={prefill}
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

const inr0 = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function AddWhatsApp({ quote, businessId, businessName, email, locked, expiresOn, upgrade }: {
  quote: WhatsappAddonQuote
  /** 0262: on Basic already — this pays the difference to Pro for the rest of the term. */
  upgrade?: boolean
  businessId: string
  businessName: string
  email?: string
  locked: boolean
  expiresOn?: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 0262: Basic or Pro; the quote follows the choice.
  const [plan, setPlan] = useState<'basic' | 'pro'>(upgrade ? 'pro' : quote.plan ?? 'basic')
  const [q, setQ] = useState<WhatsappAddonQuote>(quote)
  const [proQuote, setProQuote] = useState<WhatsappAddonQuote | null>(upgrade ? quote : null)
  useEffect(() => {
    if (upgrade) return
    let live = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      whatsappAddon(businessId, 'quote', session.access_token, 'pro').then(p => { if (live) setProQuote(p) }, () => undefined)
    })
    return () => { live = false }
  }, [businessId, upgrade])
  useEffect(() => { setQ(plan === 'pro' && proQuote ? proQuote : quote) }, [plan, proQuote, quote])

  const pay = async () => {
    setBusy(true); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const order = await whatsappAddon(businessId, 'order', session.access_token, plan)
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      new Razorpay({
        key: order.keyId, amount: order.amountPaise, currency: order.currency, order_id: order.orderId,
        name: 'Sehatsandhi Business', description: `${businessName} · WhatsApp ${plan === 'pro' ? 'Pro ' : ''}until ${shortDate(q.termEnd)}`,
        prefill: { name: businessName, email },
        theme: { color: BIZ.green },
        remember_customer: false,
        modal: { ondismiss: () => setBusy(false) },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const v = await verifyRazorpayPayment({
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature, paymentRowId: order.paymentRowId,
          })
          setBusy(false)
          if (v.ok) window.location.reload()
          else setError('Payment could not be verified. If money was deducted, our team will reconcile it.')
        },
      }).open()
    } catch (e) {
      setError(`Payment failed to start: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  const prorated = q.daysLeft < q.daysInTerm
  if (upgrade) return (
    <div className="card shadow-sm space-y-3">
      <h3 className="font-bold text-navy-700 flex items-center gap-2">
        Upgrade to WhatsApp Pro <span className="text-[11px] font-semibold bg-teal-50 text-teal-700 rounded-full px-2 py-0.5">Pro</span>
      </h3>
      <ul className="text-sm text-gray-600 list-disc ml-5 space-y-0.5">
        <li>Your clinic’s own WhatsApp number and name — patients see you, not Sehatsandhi.</li>
        <li>Sends by itself: welcome on registration, prescription and bill after the visit, a thank-you with a rating request, and follow-up reminders.</li>
        <li>Patients with the Sehatsandhi app get these in the app instead, free.</li>
        <li>Once your number is connected you pay Meta for messages directly; until then they are included.</li>
      </ul>
      <div className="text-sm border rounded-lg divide-y">
        <div className="flex justify-between px-3 py-2"><span>Difference to Pro ({q.termLabel.toLowerCase()})</span><span>{inr0(q.fullFee)}</span></div>
        {prorated && <div className="flex justify-between px-3 py-2 text-gray-600"><span>{q.daysLeft} of {q.daysInTerm} days left</span><span>{inr0(q.amount)}</span></div>}
        {q.tax.applied && <div className="flex justify-between px-3 py-2 text-gray-600"><span>GST {q.tax.rate}%</span><span>{inr0(q.tax.taxTotal)}</span></div>}
        <div className="flex justify-between px-3 py-2 font-bold"><span>Pay now</span><span>{inr0(q.tax.grandTotal)}</span></div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={pay} disabled={busy} className="btn-teal disabled:opacity-60">
        {busy ? 'Opening payment…' : `Pay ${inr0(q.tax.grandTotal)} and move to Pro`}
      </button>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className={`rounded-xl px-4 py-3 text-sm border ${locked ? 'bg-red-50 border-red-200 text-red-800' : 'bg-teal-50 border-teal-200 text-teal-900'}`}>
        {locked
          ? <><b>WhatsApp marketing is paused.</b> It ended on {expiresOn ? shortDate(expiresOn) : '—'}. Add it again below — your wallet, patients and past broadcasts are all kept.</>
          : <><b>Add WhatsApp to your plan</b> to send camp, notice and health-tip messages to your patients. Each message is paid separately from a wallet.</>}
      </div>
      <div className="card shadow-sm max-w-xl space-y-3">
        <h3 className="font-bold text-navy-700">Add WhatsApp messaging</h3>
        {proQuote && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <button type="button" onClick={() => setPlan('basic')}
              className={`text-left rounded-lg border px-3 py-2 ${plan === 'basic' ? 'border-teal-500 bg-teal-50' : 'border-gray-200'}`}>
              <div className="font-semibold">Basic</div>
              <div className="text-xs text-gray-500">Send prescriptions, bills and broadcasts yourself, from the Sehatsandhi number.</div>
            </button>
            <button type="button" onClick={() => setPlan('pro')}
              className={`text-left rounded-lg border px-3 py-2 ${plan === 'pro' ? 'border-teal-500 bg-teal-50' : 'border-gray-200'}`}>
              <div className="font-semibold">Pro</div>
              <div className="text-xs text-gray-500">Your own number and name; welcome, prescription and bill, thank-you and follow-ups go by themselves.</div>
            </button>
          </div>
        )}
        <p className="text-sm text-gray-600">
          Your plan is already paid until <b>{shortDate(q.termEnd)}</b>, so you pay only the WhatsApp fee
          {prorated ? ' for the days left in it' : ''}. From {shortDate(q.termEnd)} it renews together with your {q.termLabel.toLowerCase()} plan.
        </p>
        <div className="text-sm border rounded-lg divide-y">
          <div className="flex justify-between px-3 py-2"><span>WhatsApp {plan === 'pro' ? 'Pro' : 'Basic'} fee ({q.termLabel.toLowerCase()})</span><span>{inr0(q.fullFee)}</span></div>
          {prorated && (
            <div className="flex justify-between px-3 py-2 text-gray-600">
              <span>{q.daysLeft} of {q.daysInTerm} days left</span><span>{inr0(q.amount)}</span>
            </div>
          )}
          {q.tax.applied && (
            <div className="flex justify-between px-3 py-2 text-gray-600"><span>GST {q.tax.rate}%</span><span>{inr0(q.tax.taxTotal)}</span></div>
          )}
          <div className="flex justify-between px-3 py-2 font-bold"><span>Pay now</span><span>{inr0(q.tax.grandTotal)}</span></div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={pay} disabled={busy} className="btn-teal w-full disabled:opacity-60">
          {busy ? 'Opening payment…' : `Pay ${inr0(q.tax.grandTotal)} and add WhatsApp`}
        </button>
      </div>
    </div>
  )
}

function WhatsAppWorkspace({ businessId, businessName, prefill, banner, business }: {
  business: { vertical?: string | null }
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
  const [pins, setPins] = useState<AudiencePin[]>([])
  // 0259: this month's free messages.
  const [send, setSend] = useState<SendOptions | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  // One part of the tab at a time; Pro clinics open on their automatic messages.
  const [section, setSection] = useState<'send' | 'pro' | 'wallet' | 'history' | 'terms'>('send')
  const [sectionSet, setSectionSet] = useState(false)
  useEffect(() => { if (!sectionSet && account) { setSectionSet(true); if (account.plan === 'pro') setSection('pro') } }, [account, sectionSet])

  const load = async () => {
    try {
      const [s, a, w, b, t, h, p, o] = await Promise.all([
        getMarketingSettings(), getWaAccount(businessId), getWallet(businessId),
        getBroadcastBlocker(businessId), listTemplates(), listBroadcasts(businessId), getAudiencePins(businessId),
        getSendOptions(businessId),
      ])
      setSettings(s); setAccount(a); setBalance(w.balance); setTxs(w.txs); setBlocker(b)
      setTemplates(t.filter(x => x.is_active)); setHistory(h); setPins(p); setSend(o); setError('')
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [businessId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-4">
      {banner}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* One line: what plan, where messages come from, the wallet, the free messages. Prices on demand. */}
      <div className="card shadow-sm space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
          <span className="flex items-center gap-2 flex-wrap">
            <MessageCircle className="w-4 h-4 text-teal-600" />
            <b className="text-navy-700">WhatsApp {account?.plan === 'pro' ? 'Pro' : 'Basic'}</b>
            <span className="text-gray-500">
              {account && account.subscription_status !== 'inactive'
                ? `${STATUS_TEXT[account.subscription_status]}${account.next_billing_date ? ` until ${shortDate(account.next_billing_date)}` : ''}`
                : 'not added'}
              {' · from '}{account?.own_status === 'connected' ? `your own number${account.whatsapp_number ? ` ${account.whatsapp_number}` : ''}` : 'the Sehatsandhi number'}
              {account?.status === 'suspended' ? <> · <b className="text-red-600">{STATUS_TEXT.suspended}</b></> : null}
            </span>
          </span>
          <span className="flex items-center gap-3 text-gray-600">
            <span>Wallet <b className="text-navy-700">{rupees(balance)}</b></span>
            {!!send?.free_total && <span><b className="text-navy-700">{Math.max(0, send.free_left ?? 0)}</b>/{send.free_total} free left</span>}
            <button onClick={() => setSection('wallet')} className="text-teal-700 font-semibold hover:underline">Top up</button>
          </span>
        </div>
        {blocker && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">{blocker}</p>}
        {account && account.plan !== 'pro' && account.subscription_status === 'active' && section !== 'pro' && (
          <button onClick={() => setSection('pro')} className="text-xs text-teal-700 font-semibold hover:underline">
            Upgrade to WhatsApp Pro — your own number, and messages that go by themselves →
          </button>
        )}
      </div>

      {/* One part at a time. */}
      <div className="flex gap-1.5 flex-wrap">
        {SECTIONS.filter(([k]) => k !== 'pro' || account?.plan === 'pro' || (account?.subscription_status === 'active')).map(([k, label]) => (
          <button key={k} onClick={() => setSection(k)}
            className={`text-sm px-3 py-1.5 rounded-full border ${section === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200 text-gray-600 hover:border-teal-400'}`}>
            {k === 'pro' && account?.plan !== 'pro' ? 'Pro' : label}
          </button>
        ))}
      </div>

      {section === 'send' && (
        <>
          {account && account.subscription_status !== 'inactive' && !(account.terms_version === WA_TERMS_VERSION && account.terms_accepted_at) && (
            <TermsCard businessId={businessId} account={account} onAccepted={load} />
          )}
          {settings && (
            <Composer insurance={business.vertical === 'insurance'}
              businessId={businessId} businessName={businessName} settings={settings} balance={balance}
              blocker={blocker} templates={templates} pins={pins} onSent={load}
            />
          )}
        </>
      )}

      {section === 'pro' && (
        account?.plan === 'pro' ? (
          <>
            <AutoMessagesCard businessId={businessId} />
            <OwnNumberCard businessId={businessId} account={account} onChange={load} />
          </>
        ) : <UpgradeToPro businessId={businessId} businessName={businessName} />
      )}

      {section === 'wallet' && (
        <>
          {!!send?.free_total && <div className="card shadow-sm"><FreeMessages o={send} /></div>}
          <WalletCard businessId={businessId} balance={balance} txs={txs} prefill={prefill} onChange={load} />
          {settings && (
            <details className="card shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-navy-700">Prices</summary>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-sm">
                <Price label="WhatsApp fee" value="With your plan — see the Plan tab" />
                <Price label="Each broadcast message" value={rupees(settings.per_message_paise)} />
                <Price label="Each prescription, bill or report" value={rupees(settings.direct_message_paise)} />
                <Price label="Replying within 24 hours" value="Free" />
              </div>
            </details>
          )}
        </>
      )}

      {section === 'history' && (
        <div className="card shadow-sm">
          <h3 className="font-bold text-navy-700 mb-3">Your broadcasts</h3>
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
                    <div className={b.status === 'rejected' ? 'text-red-600 font-medium' : b.status === 'pending_approval' ? 'text-amber-700 font-medium' : ''}>
                      {BROADCAST_STATUS[b.status] ?? b.status.replace('_', ' ')}
                    </div>
                    {b.status === 'rejected' && b.review_note && <div className="text-red-600 max-w-xs">“{b.review_note}” · refunded</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {section === 'terms' && account && account.subscription_status !== 'inactive' && (
        <TermsCard businessId={businessId} account={account} onAccepted={load} />
      )}
    </div>
  )
}

const SECTIONS: ['send' | 'pro' | 'wallet' | 'history' | 'terms', string][] = [
  ['send', 'Send a broadcast'], ['pro', 'Automatic & own number'], ['wallet', 'Wallet'], ['history', 'Sent'], ['terms', 'Terms'],
]

// 0259: the add-on's free messages this month — used first, before the wallet.
function FreeMessages({ o }: { o: SendOptions }) {
  const total = o.free_total ?? 0
  const left = Math.max(0, o.free_left ?? 0)
  const usedPct = total ? Math.round(((total - left) / total) * 100) : 0
  const renews = o.free_renews_on ? shortDate(o.free_renews_on) : 'next month'
  return (
    <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-sm text-navy-700"><b>{left}</b> of {total} free messages left this month</div>
        <div className="text-xs text-gray-500">Renews {renews} · unused ones do not carry over</div>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden">
        <div className={`h-full ${usedPct >= 80 ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${usedPct}%` }} />
      </div>
      <p className="text-xs text-gray-500 mt-1.5">
        {left === 0
          ? <>Used up — prescriptions, bills, reports and review requests now come from your wallet until {renews}.</>
          : usedPct >= 80
            ? <>Almost used up. After these, prescriptions, bills, reports and review requests come from your wallet.</>
            : <>With your WhatsApp add-on: prescriptions, bills, reports, review requests and a broadcast’s test message use these first, then your wallet. Broadcasts themselves are always from the wallet.</>}
      </p>
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
    recharge: 'Top-up', message_send: 'Message', refund: 'Refund', adjustment: 'Adjustment',
  }

  return (
    <div className="card shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-navy-700 flex items-center gap-2"><Wallet className="w-4 h-4 text-teal-600" /> Wallet</h3>
          <p className="text-3xl font-bold text-navy-700 mt-1">{rupees(balance)}</p>
          <p className="text-xs text-gray-400">Spent on the WhatsApp messages you send — broadcasts, prescriptions, bills and reports. Top-ups are not refundable.</p>
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

// 0219: the messaging terms, accepted once by the owner (and again if they change).
function TermsCard({ businessId, account, onAccepted }: { businessId: string; account: WaAccount; onAccepted: () => void }) {
  const accepted = account.terms_version === WA_TERMS_VERSION && !!account.terms_accepted_at
  const [open, setOpen] = useState(!accepted)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const accept = async () => {
    setBusy(true); setErr('')
    try { await acceptWaTerms(businessId, WA_TERMS_VERSION); setOpen(false); onAccepted() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (accepted && !open) {
    return (
      <p className="text-xs text-gray-500">
        WhatsApp messaging terms accepted on {shortDate(account.terms_accepted_at!)}. <button onClick={() => setOpen(true)} className="underline">Read them</button>
      </p>
    )
  }
  return (
    <div className={`card shadow-sm ${accepted ? '' : 'border-2 border-amber-300'}`}>
      <h3 className="font-bold text-navy-700">WhatsApp messaging terms</h3>
      {!accepted && <p className="text-sm text-gray-500 mt-1">Please read and accept these before your first broadcast. Only the clinic's owner can accept.</p>}
      <ol className="mt-3 space-y-2 text-sm text-gray-700 list-decimal pl-5">
        {WA_TERMS.map(t => <li key={t.title}><b>{t.title}.</b> {t.text}</li>)}
      </ol>
      {accepted ? (
        <button onClick={() => setOpen(false)} className="btn-outline text-sm mt-3">Close</button>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-1" />
            <span>I have read these terms and accept them for this clinic.</span>
          </label>
          <button onClick={accept} disabled={!agree || busy} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Accept the terms'}</button>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      )}
    </div>
  )
}

// The full emoji keyboard — every emoji, by category, with search and skin tones — loaded
// only when a clinic opens it. 'native' draws the device's own emoji: no images from elsewhere.
const EmojiPicker = lazy(() => import('emoji-picker-react'))

/** A message as WhatsApp shows it: *bold* in bold, line breaks kept. */
function WaText({ text }: { text: string }) {
  return <>{text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    /^\*[^*\n]+\*$/.test(part) ? <b key={i}>{part.slice(1, -1)}</b> : <span key={i}>{part}</span>)}</>
}

function Composer({ insurance = false, businessId, businessName, settings, balance, blocker, templates, pins, onSent }: {
  insurance?: boolean
  businessId: string; businessName: string; settings: MarketingSettings; balance: number
  blocker: string | null; templates: WaTemplate[]; pins: AudiencePin[]
  onSent: () => void
}) {
  // 0264: who first — everyone, chosen areas, or recent visitors.
  const [mode, setMode] = useState<'all' | 'area' | 'recent' | null>(null)
  const [recentDays, setRecentDays] = useState(90)
  const [search, setSearch] = useState('')
  const [allAreas, setAllAreas] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [chosenPins, setChosenPins] = useState<string[]>([])
  const [audience, setAudience] = useState<AudienceMember[]>([])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [loadingAud, setLoadingAud] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [params, setParams] = useState<string[]>([])
  const [picBusy, setPicBusy] = useState(false)
  const [picErr, setPicErr] = useState('')
  // The emoji tray, open under one blank at a time; and the boxes, to put an emoji where the cursor is.
  const [emojiFor, setEmojiFor] = useState<number | null>(null)
  const boxes = useRef<(HTMLTextAreaElement | null)[]>([])
  const setBlank = (i: number, v: string) => setParams(ps => ps.map((p, j) => j === i ? v : p))
  const addEmoji = (i: number, e: string) => {
    const el = boxes.current[i]
    const cur = params[i] ?? ''
    const at = el?.selectionStart ?? cur.length
    if (cur.length + e.length > 300) return
    setBlank(i, cur.slice(0, at) + e + cur.slice(at))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length) })
  }
  // A picture's rules are confirmed each time one is sent: a picture can say what the words do not.
  const [picOk, setPicOk] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // Reload the checklist whenever the choice changes; everyone starts ticked.
  useEffect(() => {
    if (!mode || (mode === 'area' && !chosenPins.length)) { setAudience([]); setTicked(new Set()); return }
    const since = mode === 'recent'
      ? new Date(Date.now() + 5.5 * 3_600_000 - recentDays * 86_400_000).toISOString().slice(0, 10) : undefined
    let live = true
    setLoadingAud(true)
    getAudience(businessId, mode === 'area' ? chosenPins : [], since)
      .then(a => { if (live) { setAudience(a); setTicked(new Set(a.map(x => x.patient_member_id))) } })
      .catch(e => setErr((e as Error).message))
      .finally(() => { if (live) setLoadingAud(false) })
    return () => { live = false }
  }, [businessId, mode, chosenPins, recentDays])

  const everyone = pins.reduce((n, p) => n + p.patients, 0)
  const areaLabel = (p: AudiencePin) => p.pin_code ? `${p.area ? `${p.area} · ` : ''}${p.pin_code}` : 'Without a PIN code'
  const matches = useMemo(() => {
    const t = search.trim().toLowerCase()
    const list = pins.filter(p => !chosenPins.includes(p.pin_code))
    if (t) return list.filter(p => p.pin_code.includes(t) || (p.area ?? '').toLowerCase().includes(t) || (!p.pin_code && 'without no pin'.includes(t)))
    return allAreas ? list : list.slice(0, 6)
  }, [pins, chosenPins, search, allAreas])
  const chosenCount = pins.filter(p => chosenPins.includes(p.pin_code)).reduce((n, p) => n + p.patients, 0)
  const who = insurance ? 'people' : 'patients'

  const tpl = templates.find(t => t.id === templateId)
  useEffect(() => { setParams(tpl ? Array(Math.max(tpl.placeholders.length - 1, 0)).fill('') : []); setPicOk(false); setPicErr(''); setEmojiFor(null) }, [templateId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    : tpl?.header_image && !picOk ? 'Tick the box confirming the picture rules.'
    : short ? `This needs ${rupees(cost)}; your wallet has ${rupees(balance)}. Top up to send.`
    : null

  const togglePin = (p: string) =>
    setChosenPins(cs => cs.includes(p) ? cs.filter(x => x !== p) : [...cs, p])
  const toggle = (id: string) => setTicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // 0219: the message as a patient would get it, on the clinic's own number first.
  const [testing, setTesting] = useState(false)
  const sendTest = async () => {
    setTesting(true); setErr(''); setMsg('')
    try {
      const r = await sendTestMessage({ businessId, templateId, params })
      setMsg(`Test sent to your clinic's number ending ${r.to.replace('…', '')}${r.free ? ' · one of your free messages used' : r.chargedPaise ? ` · ${rupees(r.chargedPaise)} from your wallet` : ''}. Check WhatsApp.`)
      onSent()
    } catch (e) { setErr((e as Error).message) } finally { setTesting(false) }
  }

  const send = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await createBroadcast({ businessId, templateId, params, memberIds: [...ticked], pins: mode === 'area' ? chosenPins : [] })
      // 0238: only a picture waits for Sehatsandhi's approval; a set template goes out at once.
      if (r.status === 'queued') setMsg(`Sending now: ${r.recipients} patients · ${rupees(r.cost_paise)} taken from your wallet (balance ${rupees(r.balance_paise)}). A message that is not delivered is refunded.`)
      else setMsg(`Sent for approval: ${r.recipients} patients · ${rupees(r.cost_paise)} held from your wallet (balance ${rupees(r.balance_paise)}). Sehatsandhi reviews it before it goes out; if it is not approved the money comes back and we email you why.`)
      setConfirming(false); setChosenPins([]); setMode(null); setSearch(''); setTemplateId(''); onSent()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card shadow-sm space-y-4">
      <h3 className="font-bold text-navy-700 flex items-center gap-2"><Send className="w-4 h-4 text-teal-600" /> New broadcast</h3>

      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">1. Who gets it</p>
        {!pins.length ? (
          <p className="text-sm text-gray-500">
            {insurance
              ? 'Nobody to message yet. Leads you accept appear here for 90 days.'
              : <>No patients to message yet. Every patient you register with a mobile number appears here, until they reply STOP.</>}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-2">
              {([
                ['all', `All my ${who}`, `${everyone}`],
                ['area', 'By area', 'Choose PIN codes'],
                ['recent', 'Visited recently', 'Seen in the last few months'],
              ] as const).map(([k, title, sub]) => (
                <button key={k} type="button" onClick={() => { setMode(k); setListOpen(false) }}
                  className={`text-left rounded-lg border px-3 py-2 ${mode === k ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white'}`}>
                  <div className="text-sm font-semibold text-navy-700">{title}</div>
                  <div className="text-xs text-gray-500">{sub}</div>
                </button>
              ))}
            </div>

            {mode === 'recent' && (
              <div className="flex flex-wrap gap-2">
                {[30, 90, 180, 365].map(d => (
                  <button key={d} type="button" onClick={() => setRecentDays(d)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${recentDays === d ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                    {d === 365 ? 'Last year' : `Last ${d} days`}
                  </button>
                ))}
              </div>
            )}

            {mode === 'area' && (
              <div className="space-y-2">
                {chosenPins.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {chosenPins.map(pc => {
                      const p = pins.find(x => x.pin_code === pc)
                      return (
                        <span key={pc || 'none'} className="text-xs bg-teal-50 border border-teal-200 text-teal-800 rounded-full pl-2.5 pr-1 py-1 inline-flex items-center gap-1">
                          {p ? areaLabel(p) : pc}
                          <button type="button" onClick={() => togglePin(pc)} className="px-1 text-teal-700 hover:text-red-600" aria-label="Remove">✕</button>
                        </span>
                      )
                    })}
                    <span className="text-xs text-gray-500 ml-1">{chosenCount} {who}</span>
                  </div>
                )}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search area or PIN code…"
                  className="input-field text-sm" />
                <ul className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-60 overflow-y-auto">
                  {matches.map(p => (
                    <li key={p.pin_code || 'none'}>
                      <button type="button" onClick={() => { togglePin(p.pin_code); setSearch('') }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
                        <span className="flex items-center gap-2"><Square className="w-4 h-4 text-gray-300" />{areaLabel(p)}</span>
                        <span className="text-xs text-gray-500">{p.patients}</span>
                      </button>
                    </li>
                  ))}
                  {!matches.length && <li className="px-3 py-2 text-sm text-gray-400">{search ? 'No area matches.' : 'Every area is chosen.'}</li>}
                </ul>
                {!search && !allAreas && pins.length - chosenPins.length > 6 && (
                  <button type="button" onClick={() => setAllAreas(true)} className="text-xs text-teal-700 font-semibold hover:underline">
                    Show all {pins.length - chosenPins.length} areas
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {mode && (mode !== 'area' || chosenPins.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-xs font-semibold text-gray-500">
              2. {loadingAud ? `Loading ${who}…` : `${ticked.size} of ${audience.length} ${who} selected`}
              {!loadingAud && audience.length > 0 && (
                <button type="button" onClick={() => setListOpen(v => !v)} className="ml-2 text-teal-700 font-semibold hover:underline">
                  {listOpen ? 'Hide list' : 'Review list'}
                </button>
              )}
            </p>
            {listOpen && (
              <div className="flex gap-3 text-xs">
                <button className="text-teal-700 font-semibold" onClick={() => setTicked(new Set(audience.map(a => a.patient_member_id)))}>Select all</button>
                <button className="text-gray-500 font-semibold" onClick={() => setTicked(new Set())}>Clear</button>
              </div>
            )}
          </div>
          {!listOpen || loadingAud ? null : (
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
            {tpl.placeholders.slice(1).map((ph, i) => {
              // 0235: a picture template's last blank is the picture itself.
              const isPicture = !!tpl.header_image && i === tpl.placeholders.length - 2
              if (!isPicture) return (
                <div key={i}>
                  <label className="block text-xs font-semibold text-gray-500">{ph}
                    {/* WhatsApp allows no line break inside a blank, so Enter is not a new line here: the box only wraps. */}
                    <textarea ref={el => { boxes.current[i] = el }} value={params[i] ?? ''} maxLength={300} rows={3}
                      onChange={e => setBlank(i, e.target.value.replace(/[\r\n\t]+/g, ' '))}
                      onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
                      className="input-field mt-1 text-sm leading-relaxed resize-y" />
                  </label>
                  <div className="flex items-center justify-between mt-1">
                    <button type="button" onClick={() => setEmojiFor(emojiFor === i ? null : i)}
                      className="text-xs text-teal-700 font-semibold hover:underline">😊 Add emoji</button>
                    <span className="text-[11px] text-gray-400">{(params[i] ?? '').length}/300</span>
                  </div>
                  {emojiFor === i && (
                    <div className="mt-1">
                      <Suspense fallback={<p className="text-xs text-gray-500 py-2">Loading emoji…</p>}>
                        <EmojiPicker onEmojiClick={d => addEmoji(i, d.emoji)} emojiStyle="native" width="100%" height={380}
                          lazyLoadEmojis previewConfig={{ showPreview: false }} searchPlaceholder="Search emoji" />
                      </Suspense>
                    </div>
                  )}
                </div>
              )
              return (
                <label key={i} className="block text-xs font-semibold text-gray-500">{ph}
                  <input type="file" accept="image/jpeg,image/png" disabled={picBusy} className="block mt-1 text-sm font-normal"
                    onChange={async e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      setPicBusy(true); setPicErr('')
                      try {
                        const path = await uploadBroadcastPicture(businessId, f)
                        setParams(ps => ps.map((p, j) => j === i ? path : p)); setPicOk(false)   // a new picture is confirmed afresh
                      } catch (x) { setPicErr((x as Error).message) } finally { setPicBusy(false) }
                    }} />
                  {picBusy && <span className="font-normal text-gray-500">Uploading…</span>}
                  {picErr && <span className="font-normal text-red-600">{picErr}</span>}
                </label>
              )
            })}
            {templateRules(tpl.code).length > 0 && (
              <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <b className="text-gray-700">For this kind of message:</b>
                <ul className="list-disc pl-4 mt-1 space-y-0.5">{templateRules(tpl.code).map(r => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            {tpl.header_image && (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <b>Before you send a picture.</b> A picture is read as carefully as the words, and one that breaks these rules is refused and refunded.
                <ul className="list-disc pl-4 mt-1 space-y-0.5">{PICTURE_RULES.map(r => <li key={r}>{r}</li>)}</ul>
                <label className="flex items-start gap-2 mt-2 font-semibold cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={picOk} onChange={e => setPicOk(e.target.checked)} />
                  I confirm all of the above for this picture.
                </label>
              </div>
            )}
            <div className="bg-[#e7f6ef] rounded-lg px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">
              {tpl.header_image && (params[params.length - 1]
                ? <img src={broadcastPictureUrl(params[params.length - 1])} alt="The picture that will be sent" className="rounded-md mb-2 max-h-64" />
                : <div className="rounded-md mb-2 h-24 bg-white/70 border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">Your picture appears here</div>)}
              <WaText text={preview} />
            </div>
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
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setConfirming(true)} disabled={!!reason} className="btn-teal text-sm disabled:opacity-50">
            Send to {count} patient{count === 1 ? '' : 's'}
          </button>
          <button onClick={sendTest} disabled={testing || !tpl || !tpl.approved || blanks || (!!tpl.header_image && !picOk)} className="btn-outline text-sm disabled:opacity-50"
            title="Sends this message to your clinic's own WhatsApp number, so you can see it before your patients do.">
            {testing ? 'Sending test…' : `Send a test to my clinic's number · ${rupees(settings.per_message_paise)}`}
          </button>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm space-y-2">
          <p>Send this message to <b>{count}</b> patients? <b>{rupees(cost)}</b> will be taken from the wallet.{' '}
            {tpl?.needs_review ? 'Because it carries a picture, Sehatsandhi reads it first; it goes out once approved.' : 'It goes out straight away and cannot be called back.'}</p>
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

// ── 0261: the clinic's own WhatsApp number (Pro) ────────────────────────────

const TEMPLATE_LABEL: Record<string, string> = {
  prescription_link: 'Prescription', bill_link: 'Bill', lab_report_link: 'Lab report', discharge_link: 'Discharge summary',
  appointment_update: 'Appointment update', rating_request: 'Rating request', welcome_patient: 'Welcome on registration',
  visit_summary: 'Prescription and bill after the visit', follow_up_reminder: 'Follow-up reminder',
}
const TEMPLATE_STATUS: Record<string, [string, string]> = {
  APPROVED: ['Approved', 'bg-green-50 text-green-700'], PENDING: ['Waiting for Meta', 'bg-amber-50 text-amber-700'],
  IN_APPEAL: ['Waiting for Meta', 'bg-amber-50 text-amber-700'], REJECTED: ['Rejected', 'bg-red-50 text-red-700'],
  PAUSED: ['Paused by Meta', 'bg-red-50 text-red-700'], DISABLED: ['Disabled by Meta', 'bg-red-50 text-red-700'],
  NOT_CREATED: ['Not created', 'bg-red-50 text-red-700'],
}
const QUALITY: Record<string, string> = { GREEN: 'Good', YELLOW: 'Warning — patients are blocking or reporting', RED: 'Poor — Meta may limit this number', UNKNOWN: 'Not rated yet' }
const LIMIT: Record<string, string> = {
  TIER_50: '50 patients a day', TIER_250: '250 patients a day', TIER_1K: '1,000 patients a day', TIER_10K: '10,000 patients a day',
  TIER_100K: '100,000 patients a day', TIER_UNLIMITED: 'No daily limit',
}

function OwnNumberCard({ businessId, account, onChange }: { businessId: string; account: WaAccount; onChange: () => void }) {
  const connected = account.own_status === 'connected'
  const [templates, setTemplates] = useState<WaClinicTemplate[]>([])
  const [existing, setExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { if (connected) listOwnTemplates(businessId).then(setTemplates).catch(() => setTemplates([])) }, [connected, businessId, account.own_checked_at])
  // Loaded now, so Connect can open Meta's window straight from the click.
  useEffect(() => { if (!connected) loadFacebookSdk().catch(() => undefined) }, [connected])

  const connect = async () => {
    setBusy(true); setNote(null)
    try {
      const r = await embeddedSignup(existing)
      const res = await waConnect(businessId, 'connect', { ...r, coexistence: existing })
      setNote({ ok: res.ok, text: res.message ?? (res.ok ? 'Connected.' : 'Could not connect.') })
      if (res.ok) onChange()
    } catch (e) { setNote({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }
  const act = async (action: 'refresh' | 'disconnect') => {
    if (action === 'disconnect' && !window.confirm('Stop sending from your own number? Messages will go from the Sehatsandhi number again, paid from your wallet.')) return
    setBusy(true); setNote(null)
    try {
      const res = await waConnect(businessId, action)
      setNote({ ok: res.ok, text: res.message ?? '' })
      onChange()
    } catch (e) { setNote({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const manager = account.waba_id ? `https://business.facebook.com/wa/manage/home/?waba_id=${account.waba_id}` : 'https://business.facebook.com/wa/manage/home/'

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-navy-700 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-teal-600" /> Your own WhatsApp number
            <span className="text-[11px] font-semibold bg-teal-50 text-teal-700 rounded-full px-2 py-0.5">Pro</span>
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {connected
              ? <>Patients get messages from your clinic’s own number and name. Meta charges your card for them directly; nothing is taken from the wallet.</>
              : <>Connect your clinic’s number and patients get every message from it, in your clinic’s name. You pay Meta for messages directly with your own card. Until then, messages go from the Sehatsandhi number.</>}
          </p>
        </div>
        {connected && (
          <div className="flex gap-2">
            <button onClick={() => act('refresh')} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">Refresh</button>
            <button onClick={() => act('disconnect')} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-50">Disconnect</button>
          </div>
        )}
      </div>

      {!connected ? (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <label className={`border rounded-lg px-3 py-2 cursor-pointer ${!existing ? 'border-teal-500 bg-teal-50' : 'border-gray-200'}`}>
              <input type="radio" className="mr-2" checked={!existing} onChange={() => setExisting(false)} />
              <b>A new number</b>
              <span className="block text-xs text-gray-500 ml-5">A SIM or landline that is not on WhatsApp yet.</span>
            </label>
            <label className={`border rounded-lg px-3 py-2 cursor-pointer ${existing ? 'border-teal-500 bg-teal-50' : 'border-gray-200'}`}>
              <input type="radio" className="mr-2" checked={existing} onChange={() => setExisting(true)} />
              <b>Our WhatsApp Business app number</b>
              <span className="block text-xs text-gray-500 ml-5">Keep using the app on the reception phone; automatic messages go from the same number.</span>
            </label>
          </div>
          <ol className="text-xs text-gray-500 list-decimal ml-5 space-y-0.5">
            <li>Meta’s window opens. Log in with Facebook and choose or create your clinic’s business.</li>
            <li>Enter your clinic’s name as patients should see it, and the number. Meta sends a code to it.</li>
            <li>That’s it — we set up the messages. Then add a card in Meta so it can charge for messages.</li>
          </ol>
          <button onClick={connect} disabled={busy} className="btn-teal text-sm disabled:opacity-50">
            {busy ? 'Connecting…' : 'Connect your WhatsApp number'}
          </button>
          {account.own_status === 'disconnected' && <p className="text-xs text-gray-500">Your number was disconnected. Connect it again any time.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <Price label="Number" value={account.whatsapp_number ?? '—'} />
            <Price label="Name patients see" value={`${account.verified_name ?? '—'}${account.name_status && account.name_status !== 'APPROVED' ? ` (${account.name_status.toLowerCase().replace(/_/g, ' ')})` : ''}`} />
            <Price label="Quality" value={QUALITY[account.quality_rating ?? 'UNKNOWN'] ?? account.quality_rating ?? '—'} />
            <Price label="Daily limit" value={LIMIT[account.messaging_limit ?? ''] ?? (account.messaging_limit || 'Starts at 250 patients a day')} />
          </div>
          {account.coexistence && <p className="text-xs text-gray-500">Connected together with your WhatsApp Business app — keep using the app on your phone as before.</p>}
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-1">Messages Meta has to approve</div>
            {!templates.length ? <p className="text-xs text-gray-400">Being set up…</p> : (
              <ul className="divide-y divide-gray-100 text-sm">
                {templates.map(t => {
                  const [label, cls] = TEMPLATE_STATUS[t.status] ?? [t.status, 'bg-gray-50 text-gray-600']
                  return (
                    <li key={`${t.name}:${t.language}`} className="py-1.5 flex items-center justify-between gap-2">
                      <span>{TEMPLATE_LABEL[t.name] ?? t.name}{t.language === 'hi' ? ' (Hindi)' : ''}
                        {t.reason && <span className="block text-[11px] text-red-600">{t.reason}</span>}</span>
                      <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${cls}`}>{label}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <a href={manager} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">Add your card in Meta →</a>
            <a href="https://business.facebook.com/settings/security" target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">Verify your business with Meta (raises the daily limit) →</a>
          </div>
        </div>
      )}

      {account.own_error && <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">{account.own_error}</p>}
      {note && <p className={`text-sm rounded-lg px-3 py-2 ${note.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{note.text}</p>}
    </div>
  )
}

// ── 0262: Basic → Pro, and what Pro sends by itself ─────────────────────────

function UpgradeToPro({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [quote, setQuote] = useState<WhatsappAddonQuote | null>(null)
  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      // Refused (no paid term, already Pro, given free…): the card simply does not show.
      whatsappAddon(businessId, 'quote', session.access_token, 'pro')
        .then(q => { if (live && q.upgrading) setQuote(q) }, () => undefined)
    })
    return () => { live = false }
  }, [businessId])
  if (!quote) return null
  return <AddWhatsApp quote={quote} businessId={businessId} businessName={businessName} locked={false} upgrade />
}

const AUTO_KINDS: { key: 'welcome' | 'visit_summary' | 'thank_you' | 'follow_up'; label: string; when: string }[] = [
  { key: 'welcome', label: 'Welcome', when: 'When a patient is registered: their file number, and that their records will be in the Sehatsandhi app.' },
  { key: 'visit_summary', label: 'Prescription and bill', when: '15 minutes after the consultation is marked done — both in one message.' },
  { key: 'thank_you', label: 'Thank-you and rating', when: 'After the visit, asking for a 1–5 rating. At most once in 30 days per patient.' },
  { key: 'follow_up', label: 'Follow-up reminder', when: 'At 10 am the day before the follow-up date the doctor wrote.' },
]
const AUTO_STATUS: Record<string, string> = { pending: 'Waiting', sending: 'Sending', sent: 'Sent', skipped: 'Not sent', failed: 'Failed' }

function AutoMessagesCard({ businessId }: { businessId: string }) {
  const [s, setS] = useState<WaAutoSettings | null>(null)
  const [o, setO] = useState<WaAutoOverview | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => {
    getAutoSettings(businessId).then(setS).catch(e => setNote((e as Error).message))
    getAutoOverview(businessId).then(setO).catch(() => setO(null))
  }, [businessId])
  if (!s) return null

  const save = async (next: WaAutoSettings) => {
    setS(next); setSaving(true); setNote('')
    try { await saveAutoSettings(businessId, next); setNote('Saved.') } catch (e) { setNote((e as Error).message) } finally { setSaving(false) }
  }
  const label = (k: string) => AUTO_KINDS.find(x => x.key === k)?.label ?? k

  return (
    <div className="card shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-navy-700 flex items-center gap-2">
          <Send className="w-4 h-4 text-teal-600" /> Automatic messages
          <span className="text-[11px] font-semibold bg-teal-50 text-teal-700 rounded-full px-2 py-0.5">Pro</span>
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          Sent by themselves, between 8 am and 9 pm. Patients with the Sehatsandhi app get them in the app instead. Anyone who replies STOP gets none.
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {AUTO_KINDS.map(k => {
          const m = o?.month?.[k.key]
          return (
            <li key={k.key} className="py-2 flex items-start gap-3">
              <button type="button" onClick={() => save({ ...s, [k.key]: !s[k.key] })} disabled={saving} className="mt-0.5 text-teal-600 disabled:opacity-50"
                aria-label={`${s[k.key] ? 'Turn off' : 'Turn on'} ${k.label}`}>
                {s[k.key] ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-gray-400" />}
              </button>
              <div className="flex-1 text-sm">
                <div className="font-semibold text-navy-700">{k.label}</div>
                <div className="text-xs text-gray-500">{k.when}</div>
                {k.key === 'thank_you' && s.thank_you && (
                  <label className="text-xs text-gray-600 mt-1 inline-flex items-center gap-1">
                    Send
                    <select value={s.thank_you_after_minutes} disabled={saving} className="border border-gray-200 rounded px-1 py-0.5"
                      onChange={e => save({ ...s, thank_you_after_minutes: Number(e.target.value) })}>
                      {[30, 60, 120, 240, 480].map(n => <option key={n} value={n}>{n < 60 ? `${n} minutes` : `${n / 60} hour${n > 60 ? 's' : ''}`}</option>)}
                    </select>
                    after the visit
                  </label>
                )}
              </div>
              {m && (
                <div className="text-[11px] text-gray-500 text-right whitespace-nowrap">
                  This month: <b>{m.whatsapp}</b> WhatsApp · <b>{m.app}</b> app
                  {m.failed ? <div className="text-red-600">{m.failed} failed</div> : null}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {!!o?.recent?.length && (
        <details className="text-sm">
          <summary className="cursor-pointer text-teal-700">Last {o.recent.length} messages</summary>
          <ul className="mt-2 divide-y divide-gray-100">
            {o.recent.map((r, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between gap-2">
                <span>{label(r.kind)} — {r.name ?? 'patient'}
                  {r.why && r.status !== 'sent' && <span className="block text-[11px] text-gray-500">{r.why}</span>}</span>
                <span className="text-[11px] text-gray-500 text-right whitespace-nowrap">
                  {AUTO_STATUS[r.status] ?? r.status}{r.status === 'sent' ? ` (${r.channel === 'push' ? 'app' : 'WhatsApp'})` : ''}
                  <br />{dateTime(r.sent_at ?? r.due_at)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {note && <p className={`text-xs ${note === 'Saved.' ? 'text-green-700' : 'text-red-600'}`}>{note}</p>}
    </div>
  )
}
