import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  computePrice, createRazorpayOrder, verifyRazorpayPayment, loadRazorpayCheckout,
  listCareModules, PriceResult, CareModule,
} from '../../lib/businessApi'
import { usePricing } from '../../hooks/usePricing'
import { usePublicAreas } from '../../hooks/useServiceAreas'
import { isValidGstin, GST_STATE_NAMES } from '../../hooks/useTaxSettings'
import { BIZ } from '../business/shared'
import { Business } from '../../types'

// Paying for a listing from the dashboard, for a business that registered but
// did not pay at signup. The same order and verification as the signup wizard
// (razorpay-order prices it on the server; razorpay-verify activates the
// listing), called with the owner's own session so razorpay-order's caller
// check lets a signed-in owner or manager pay at any time.

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function PayListingPanel({ business, canPay, onPaid }: {
  business: Business
  /** Owner or manager. Others are told to ask them — razorpay-order refuses them anyway. */
  canPay: boolean
  onPaid: () => void
}) {
  const { terms, plan } = usePricing()
  const { areas } = usePublicAreas()
  const [months, setMonths] = useState<number>(plan.default_months || 1)
  const [careModules, setCareModules] = useState<CareModule[]>([])
  const [modules, setModules] = useState<string[]>(['opd'])
  const [gstin, setGstin] = useState((business.gstin as string | undefined) ?? '')
  const [price, setPrice] = useState<PriceResult | null>(null)
  const [pricing, setPricing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const req = useRef(0)

  useEffect(() => { listCareModules().then(setCareModules).catch(() => setCareModules([])) }, [])
  useEffect(() => {
    if (!terms.length) { setMonths(plan.default_months || 1); return }
    setMonths(m => terms.some(t => t.months === m) ? m : (terms.find(t => t.months === plan.default_months) ?? terms[0]).months)
  }, [terms, plan.default_months])

  // Every service area, as at signup: coverage is automatic.
  const pins = business.pin_codes?.length ? business.pin_codes : areas.map(a => a.pin_code)

  useEffect(() => {
    if (!pins.length) return
    const id = ++req.current
    setPricing(true)
    computePrice(pins, business.id, null, months, null, modules)
      .then(p => { if (id === req.current) setPrice(p) })
      .catch(e => { if (id === req.current) setError((e as Error).message) })
      .finally(() => { if (id === req.current) setPricing(false) })
  }, [pins.join(','), business.id, months, modules.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const g = gstin.trim().toUpperCase()
  const gstState = !g ? 'empty' : g.length < 15 ? 'partial' : isValidGstin(g) ? 'ok' : 'bad'

  const pay = async () => {
    setError('')
    if (gstState === 'bad' || gstState === 'partial') {
      setError('Please correct your GST number, or clear the field if you are not registered.'); return
    }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const order = await createRazorpayOrder(pins, business.id, months, modules,
        gstState === 'ok' ? { gstin: g, billingAddress: business.address || undefined } : {},
        session.access_token)
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      new Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
        name: 'Sehatsandhi Business', description: `${business.name} · listing`,
        prefill: { name: business.name, email: business.email || undefined },
        theme: { color: BIZ.green },
        remember_customer: false,
        modal: { ondismiss: () => setBusy(false) },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const v = await verifyRazorpayPayment({
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature, paymentRowId: order.paymentRowId,
          })
          setBusy(false)
          if (v.ok) onPaid()
          else setError('Payment could not be verified. If money was deducted, our team will reconcile it.')
        },
      }).open()
    } catch (e) {
      setError(`Payment failed to start: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  const due = price?.tax.grandTotal ?? null

  return (
    <div className="card shadow-sm max-w-xl space-y-4">
      <div>
        <h3 className="font-bold text-navy-700">Pay for your listing</h3>
        <p className="text-sm text-gray-500 mt-1">
          Your listing goes live, and the dashboard opens again, as soon as the payment goes through.
        </p>
      </div>

      {!canPay ? (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          Only the owner or manager of {business.name} can pay. Please ask them to log in and pay.
        </p>
      ) : (
        <>
          {terms.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">How long</p>
              <div className="flex flex-wrap gap-2">
                {terms.map(t => (
                  <button key={t.months} onClick={() => setMonths(t.months)}
                    className={`text-sm px-3 py-2 rounded-lg border text-left ${months === t.months ? 'bg-teal-50 border-teal-500 text-teal-800' : 'bg-white border-gray-200 text-gray-700'}`}>
                    <div className="font-semibold">{t.label || `${t.months} month${t.months === 1 ? '' : 's'}`} · {inr(t.price)}</div>
                    {t.savings_note && <div className="text-xs text-teal-700">{t.savings_note}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {careModules.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Systems (free)</p>
              {careModules.map(m => (
                <label key={m.code} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={modules.includes(m.code)}
                    onChange={e => setModules(ms => e.target.checked ? [...ms, m.code] : ms.filter(x => x !== m.code))} />
                  {m.label}
                </label>
              ))}
            </div>
          )}

          <label className="block text-xs font-semibold text-gray-500">GSTIN (optional)
            <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15}
              placeholder="22AAAAA0000A1Z5" className="input-field mt-1 text-sm font-mono" />
            {gstState === 'ok' && <span className="text-teal-700 font-normal">Registered in {GST_STATE_NAMES[g.slice(0, 2)] ?? g.slice(0, 2)}</span>}
            {gstState === 'bad' && <span className="text-red-600 font-normal">That does not look like a valid GSTIN.</span>}
          </label>

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm space-y-1">
            {pricing || !price ? <p className="text-gray-400">Working out the price…</p> : <>
              <div className="flex justify-between"><span>Listing, {price.months} month{price.months === 1 ? '' : 's'}</span><span>{inr(price.tax.taxableValue)}</span></div>
              {price.tax.applied && (price.tax.igst > 0
                ? <div className="flex justify-between text-gray-500"><span>IGST {price.tax.rate}%</span><span>{inr(price.tax.igst)}</span></div>
                : <div className="flex justify-between text-gray-500"><span>CGST + SGST {price.tax.rate}%</span><span>{inr(price.tax.cgst + price.tax.sgst)}</span></div>)}
              <div className="flex justify-between font-bold text-navy-700 pt-1 border-t border-gray-200"><span>Due now</span><span>{inr(price.tax.grandTotal)}</span></div>
            </>}
          </div>

          <button onClick={pay} disabled={busy || pricing || due === null || due <= 0} className="btn-teal disabled:opacity-50">
            {busy ? 'Opening payment…' : due ? `Pay ${inr(due)} with Razorpay` : 'Pay with Razorpay'}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
