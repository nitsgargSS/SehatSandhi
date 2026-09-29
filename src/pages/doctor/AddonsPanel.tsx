import { useEffect, useState } from 'react'
import { FlaskConical, HeartPulse, ScanLine, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { AddonPrice, LabAddonQuote, getAddonPrices, labAddon, loadRazorpayCheckout, verifyRazorpayPayment } from '../../lib/businessApi'
import { setLabTests } from '../../lib/labApi'
import { shortDate } from '../../lib/format'
import { BIZ } from '../business/shared'

// 0178: tests a clinic or hospital does in-house, as add-ons on its plan.
//   Heart tests & X-ray — free; switched on here.
//   Pathology, Radiology — a monthly price (set in the admin). Bought mid-term:
//   pro rata to the plan's end (lab-addon-order), then renewed with the plan.
// Turning one on opens the Lab tab with just those tests.

const ICON: Record<string, JSX.Element> = {
  cardiology: <HeartPulse className="w-5 h-5 text-rose-600" />,
  pathology: <FlaskConical className="w-5 h-5 text-purple-600" />,
  radiology: <ScanLine className="w-5 h-5 text-sky-600" />,
}
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function AddonsPanel({ businessId, businessName, email, current, canChange, onChanged }: {
  businessId: string
  businessName: string
  email?: string
  current: string[] | null | undefined
  canChange: boolean
  onChanged: (r: { lab_categories: string[]; lab_module: boolean }) => void
}) {
  const [prices, setPrices] = useState<AddonPrice[]>([])
  const [quote, setQuote] = useState<LabAddonQuote | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const on = new Set(current ?? [])

  useEffect(() => { getAddonPrices().then(p => setPrices(p.filter(a => a.is_enabled)), e => setErr((e as Error).message)) }, [])

  const token = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Please sign in again.')
    return session.access_token
  }

  const setKinds = async (next: string[], done: string) => {
    setErr(''); setMsg('')
    try { const r = await setLabTests(businessId, next); onChanged(r); setMsg(done) } catch (e) { setErr((e as Error).message) }
  }

  const getQuote = async (code: string) => {
    setBusy(code); setErr(''); setMsg('')
    try { setQuote(await labAddon(businessId, code, 'quote', await token())) }
    catch (e) { setErr((e as Error).message.replace(/^lab-addon-order failed: /, '')) }
    finally { setBusy(null) }
  }

  const pay = async (q: LabAddonQuote) => {
    setBusy(q.code); setErr('')
    try {
      const order = await labAddon(businessId, q.code, 'order', await token())
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      new Razorpay({
        key: order.keyId, amount: order.amountPaise, currency: order.currency, order_id: order.orderId,
        name: 'Sehatsandhi Business', description: `${businessName} · ${q.label} until ${shortDate(q.termEnd)}`,
        prefill: { name: businessName, email },
        theme: { color: BIZ.green },
        remember_customer: false,
        modal: { ondismiss: () => setBusy(null) },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const v = await verifyRazorpayPayment({
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature, paymentRowId: order.paymentRowId,
          })
          setBusy(null)
          if (v.ok) window.location.reload()
          else setErr('Payment could not be verified. If money was deducted, our team will reconcile it.')
        },
      }).open()
    } catch (e) {
      setErr(`Payment failed to start: ${(e as Error).message.replace(/^lab-addon-order failed: /, '')}`)
      setBusy(null)
    }
  }

  return (
    <div className="card shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-navy-700">Add-ons — tests you do in your clinic</h3>
        <p className="text-sm text-gray-500">
          Switch one on and a Lab tab appears for orders, results and reports sent to patients on WhatsApp — no separate lab registration.
          Paid add-ons are charged for the rest of your current plan term, then renew with your plan.
        </p>
      </div>

      {prices.map(a => {
        const isOn = on.has(a.code)
        const free = !(a.monthly_price > 0)
        return (
          <div key={a.code} className="border border-gray-100 rounded-xl p-3 flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-start gap-3 min-w-0">
              {ICON[a.code]}
              <div className="min-w-0">
                <div className="font-semibold text-navy-700">{a.label}</div>
                <div className="text-xs text-gray-500">{free ? 'Free' : `${inr(a.monthly_price)}/month + GST`}{isOn ? (free ? ' · on' : ' · on, renews with your plan') : ''}</div>
              </div>
            </div>
            {canChange && (
              isOn ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-teal-700 font-semibold inline-flex items-center gap-1"><Check className="w-4 h-4" /> On</span>
                  <button className="text-xs text-gray-500 underline"
                    onClick={() => {
                      if (!free && !window.confirm(`Switch off ${a.label}? It stops renewing with your plan. What you paid for this term is not refunded.`)) return
                      setKinds([...on].filter(c => c !== a.code), `${a.label} switched off.`)
                    }}>Switch off</button>
                </div>
              ) : free ? (
                <button className="btn-teal text-xs py-2 px-4" onClick={() => setKinds([...on, a.code], `✓ ${a.label} is on. Open the Lab tab to load the standard tests.`)}>Switch on — free</button>
              ) : (
                <button disabled={busy === a.code} className="btn-teal text-xs py-2 px-4" onClick={() => getQuote(a.code)}>
                  {busy === a.code ? 'Working…' : 'Add'}
                </button>
              )
            )}
          </div>
        )
      })}

      {quote && (
        <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-sm space-y-2">
          <div className="font-semibold text-navy-700">{quote.label}</div>
          <div className="text-gray-600">
            {inr(quote.monthly)}/month × {quote.termMonths} = {inr(quote.fullFee)} for your {quote.termLabel.toLowerCase()} plan.
            {quote.daysLeft < quote.daysInTerm && <> You have {quote.daysLeft} of {quote.daysInTerm} days left, so you pay {inr(quote.amount)}.</>}
            {' '}With GST: <b>{inr(quote.tax.grandTotal)}</b>. Runs until {shortDate(quote.termEnd)}, then renews with your plan.
          </div>
          <div className="flex gap-2">
            <button disabled={!!busy} onClick={() => pay(quote)} className="btn-teal text-xs py-2 px-4">{busy ? 'Opening payment…' : `Pay ${inr(quote.tax.grandTotal)}`}</button>
            <button onClick={() => setQuote(null)} className="btn-outline text-xs py-2 px-3">Cancel</button>
          </div>
        </div>
      )}

      {!canChange && <p className="text-xs text-gray-400">Only the owner or a manager can change add-ons.</p>}
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
