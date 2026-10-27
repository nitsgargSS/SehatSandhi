import { useEffect, useState } from 'react'
import { BedDouble, Check, FlaskConical, Pill, ScanLine, Stethoscope } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { LabAddonQuote, loadRazorpayCheckout, planAddon, verifyRazorpayPayment } from '../../lib/businessApi'
import { shortDate } from '../../lib/format'
import { BIZ } from '../business/shared'

// 0272: the plan by doctors and its add-ons — shown once the plans are live
// (until then the Dashboard keeps the old Add-ons panel). One line for the
// plan, one per add-on. Adding one is paid for the rest of the term; "Don't
// renew" leaves it on until the term ends and drops it from the renewal.

const ICON: Record<string, JSX.Element> = {
  ipd: <BedDouble className="w-5 h-5 text-indigo-600" />,
  pathology: <FlaskConical className="w-5 h-5 text-purple-600" />,
  diagnostics: <ScanLine className="w-5 h-5 text-sky-600" />,
  pharmacy: <Pill className="w-5 h-5 text-teal-600" />,
  opd: <Stethoscope className="w-5 h-5 text-emerald-600" />,
}
// 0278: which add-ons each kind of plan can take.
const OFFERED: Record<string, string[]> = {
  core: ['ipd', 'pathology', 'diagnostics', 'pharmacy'],
  lab_pathology: ['opd', 'pharmacy'],
  lab_diagnostic: ['pharmacy'],
  lab_both: ['pharmacy'],
}
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

interface Addon { code: string; label: string; description: string | null; monthly_price: number; logins_included: number }
interface Quote {
  live: boolean; family: string; tier_label: string; doctors: number; doctors_included: number; staff: number; staff_included: number
  beds: number; addons: string[]; bundle_pct: number; monthly: number
  lines: { kind: string; code?: string; label: string; monthly: number; free?: boolean }[]
}

/** True once an admin has switched the plans by doctors on. */
export function usePlansLive(): boolean | null {
  const [live, setLive] = useState<boolean | null>(null)
  useEffect(() => {
    supabase.from('plan_settings').select('tiered_live').maybeSingle()
      .then(({ data }) => setLive(!!data?.tiered_live), () => setLive(false))
  }, [])
  return live
}

export default function PlanAddons({ businessId, businessName, email, canChange, months }: {
  businessId: string; businessName: string; email?: string; canChange: boolean; months: number
}) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [addons, setAddons] = useState<Addon[]>([])
  const [renewal, setRenewal] = useState<string[] | null>(null)
  const [offer, setOffer] = useState<LabAddonQuote | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = async () => {
    const [q, a, b] = await Promise.all([
      supabase.rpc('sehat_plan_quote', { p_business: businessId, p_months: 1 }),
      supabase.from('plan_addons').select('code, label, description, monthly_price, logins_included').eq('is_enabled', true).order('sort_order'),
      supabase.from('businesses').select('renewal_plan_addons').eq('id', businessId).maybeSingle(),
    ])
    if (q.error) { setErr(q.error.message); return }
    setQuote(q.data as Quote)
    setAddons((a.data ?? []) as Addon[])
    setRenewal((b.data?.renewal_plan_addons as string[] | null) ?? null)
  }
  useEffect(() => { load() }, [businessId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!quote) return err ? <p className="text-sm text-red-600">{err}</p> : null
  const on = new Set(quote.addons)
  const renews = new Set(renewal ?? quote.addons)

  const token = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Please sign in again.')
    return session.access_token
  }
  const clean = (e: unknown) => (e as Error).message.replace(/^plan-addon-order failed: /, '')

  const ask = async (code: string) => {
    setBusy(code); setErr('')
    try { setOffer(await planAddon(businessId, code, 'quote', await token())) } catch (e) { setErr(clean(e)) } finally { setBusy(null) }
  }

  const setRenews = async (code: string, keep: boolean) => {
    setErr('')
    const next = [...renews].filter(c => c !== code).concat(keep ? [code] : [])
    const { error } = await supabase.rpc('sehat_set_renewal_plan_addons', { p_business: businessId, p_addons: next })
    if (error) setErr(error.message); else setRenewal(next)
  }

  const pay = async (q: LabAddonQuote) => {
    setBusy(q.code); setErr('')
    try {
      const order = await planAddon(businessId, q.code, 'order', await token())
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      new Razorpay({
        key: order.keyId, amount: order.amountPaise, currency: order.currency, order_id: order.orderId,
        name: 'Sehatsandhi Business', description: `${businessName} · ${q.label} until ${shortDate(q.termEnd)}`,
        prefill: { name: businessName, email }, theme: { color: BIZ.green }, remember_customer: false,
        modal: { ondismiss: () => setBusy(null) },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const v = await verifyRazorpayPayment({
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature, paymentRowId: order.paymentRowId,
          })
          setBusy(null)
          if (v.ok) window.location.reload()
          else setErr('Payment could not be verified. If money was deducted, our team will reconcile it.')
        },
      }).open()
    } catch (e) { setErr(`Payment failed to start: ${clean(e)}`); setBusy(null) }
  }

  const bedsLine = quote.lines.find(l => l.code === 'ipd')
  return (
    <div className="card shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-navy-700">Your plan — {quote.tier_label} · {inr(quote.monthly)}/month + GST</h3>
        <p className="text-xs text-gray-500">
          {quote.doctors} of {quote.doctors_included} doctors · {quote.staff} of {quote.staff_included} staff logins
          {quote.bundle_pct > 0 && <> · {Number(quote.bundle_pct)}% bundle discount on add-ons</>}
          {months > 1 && <> · billed {months === 12 ? 'yearly' : 'half-yearly'}</>}
        </p>
      </div>

      {addons.filter(a => (OFFERED[quote.family] ?? []).includes(a.code)).map(a => {
        const isOn = on.has(a.code)
        const free = !!quote.lines.find(l => l.code === a.code)?.free
        const line = a.code === 'ipd' ? bedsLine?.label.replace(/^IPD — /, '') : null
        return (
          <div key={a.code} className="border border-gray-100 rounded-xl p-3 flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-start gap-3 min-w-0">
              {ICON[a.code]}
              <div className="min-w-0">
                <div className="font-semibold text-navy-700">{a.label}</div>
                <div className="text-xs text-gray-500">
                  {inr(a.monthly_price)}/month{a.code === 'ipd' ? ' with 20 beds' : ''}{a.logins_included ? ` · ${a.logins_included} technician logins` : ''}
                  {isOn && line ? ` · ${line}` : ''}
                  {isOn && !renews.has(a.code) && !free ? ' · on until the term ends, not renewing' : ''}
                  {free ? ' · free for you' : ''}
                </div>
              </div>
            </div>
            {canChange && (isOn && free ? (
              <span className="text-xs text-teal-700 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> On · free</span>
            ) : isOn ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-teal-700 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> On</span>
                {renews.has(a.code)
                  ? <button className="text-xs text-gray-500 underline" onClick={() => {
                      if (window.confirm(`Stop renewing ${a.label}? It stays on until your term ends. Your records are kept.`)) setRenews(a.code, false)
                    }}>Don't renew</button>
                  : <button className="text-xs text-teal-700 underline" onClick={() => setRenews(a.code, true)}>Renew it</button>}
              </div>
            ) : (
              <button disabled={!!busy} className="btn-teal text-xs py-2 px-4" onClick={() => ask(a.code)}>
                {busy === a.code ? 'Working out…' : 'Add'}
              </button>
            ))}
          </div>
        )
      })}

      {offer && (
        <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-sm space-y-2">
          <div className="font-semibold text-navy-700">{offer.label}</div>
          <div className="text-gray-600">
            Your plan goes up by {inr(offer.monthly)}/month (bundle discount counted).
            {offer.daysLeft < offer.daysInTerm && <> {offer.daysLeft} of {offer.daysInTerm} days are left, so you pay {inr(offer.amount)}.</>}
            {' '}With GST: <b>{inr(offer.tax.grandTotal)}</b>. Then it renews with your plan.
          </div>
          <div className="flex gap-2">
            <button disabled={!!busy} onClick={() => pay(offer)} className="btn-teal text-xs py-2 px-4">{busy ? 'Opening payment…' : `Pay ${inr(offer.tax.grandTotal)}`}</button>
            <button onClick={() => setOffer(null)} className="btn-outline text-xs py-2 px-3">Cancel</button>
          </div>
        </div>
      )}

      {!canChange && <p className="text-xs text-gray-400">Only the owner can change the plan.</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
