import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  computePrice, createRazorpayOrder, verifyRazorpayPayment, loadRazorpayCheckout, PriceResult,
} from '../../lib/businessApi'
import { usePublicAreas } from '../../hooks/useServiceAreas'
import { isValidGstin, GST_STATE_NAMES } from '../../hooks/useTaxSettings'
import { shortDate } from '../../lib/format'
import { BIZ } from '../business/shared'
import { Business } from '../../types'

// Plan & billing, on the dashboard (0117). The same pricing and payment as the
// signup wizard — compute-price quotes, razorpay-order prices and charges,
// razorpay-verify activates — called with the owner's session, so an owner or
// manager can pay, renew or change plan at any time. Prices are admin's alone:
// this screen only chooses between them.
//
// Opens on the choice already made — at signup, the last payment, or a saved
// renewal preference — so a business that registered and paid later finds its
// plan set.

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

type Biz = Business & {
  term_end?: string | null
  auto_renew?: boolean | null
  renewal_term_months?: number | null
  renewal_whatsapp?: boolean | null
  months_paid?: number | null
}

export default function PayListingPanel({ business, canPay, onPaid }: {
  business: Business
  /** Owner or manager. Others are told to ask them — the server refuses them anyway. */
  canPay: boolean
  onPaid: () => void
}) {
  const b = business as Biz
  const { areas } = usePublicAreas()
  const initialMonths = [1, 6, 12].includes(Number(b.renewal_term_months)) ? Number(b.renewal_term_months)
    : [1, 6, 12].includes(Number(b.months_paid)) ? Number(b.months_paid) : 1
  const [months, setMonths] = useState(initialMonths)
  // Ticked unless they chose to leave it out (0119): null = never chose.
  const [whatsapp, setWhatsapp] = useState(b.renewal_whatsapp !== false)
  const [autoRenew, setAutoRenew] = useState(b.auto_renew !== false)
  const [couponInput, setCouponInput] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [gstin, setGstin] = useState((b.gstin as string | undefined) ?? '')
  const [price, setPrice] = useState<PriceResult | null>(null)
  const [pricing, setPricing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const req = useRef(0)

  // Every service area, as at signup: coverage is automatic.
  const pins = b.pin_codes?.length ? b.pin_codes : areas.map(a => a.pin_code)
  const modules = [
    ...((b as unknown as { opd_module?: boolean }).opd_module ? ['opd'] : []),
    ...((b as unknown as { ipd_module?: boolean }).ipd_module ? ['ipd'] : []),
  ]

  useEffect(() => {
    if (!pins.length) return
    const id = ++req.current
    setPricing(true)
    computePrice(pins, b.id, null, months, null, modules, { whatsapp, couponCode: couponCode || undefined })
      .then(p => { if (id === req.current) { setPrice(p); setError('') } })
      .catch(e => { if (id === req.current) setError((e as Error).message) })
      .finally(() => { if (id === req.current) setPricing(false) })
  }, [pins.join(','), b.id, months, whatsapp, couponCode, modules.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const g = gstin.trim().toUpperCase()
  const gstState = !g ? 'empty' : g.length < 15 ? 'partial' : isValidGstin(g) ? 'ok' : 'bad'
  const due = price?.tax.grandTotal ?? 0
  const active = b.status === 'active'
  const termEnd = b.term_end ? new Date(b.term_end) : null
  const terms = price?.terms ?? []

  const saveChoice = async () => {
    setBusy(true); setError(''); setMsg('')
    const { error: e } = await supabase.rpc('sehat_set_renewal_preference', {
      p_business: b.id, p_months: months, p_whatsapp: whatsapp, p_auto_renew: autoRenew,
    })
    setBusy(false)
    if (e) setError(e.message)
    else setMsg(`Saved. Your next renewal will be ${months === 1 ? '1 month' : `${months} months`}${whatsapp ? ' with WhatsApp' : ''}${autoRenew ? ', renewed automatically' : ''}.`)
  }

  const pay = async () => {
    setError(''); setMsg('')
    if (gstState === 'bad' || gstState === 'partial') {
      setError('Please correct your GST number, or clear the field if you are not registered.'); return
    }
    if (couponCode && price?.couponError) { setError(`${price.couponError} Remove the coupon to continue.`); return }
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const order = await createRazorpayOrder(pins, b.id, months, modules, {
        ...(gstState === 'ok' ? { gstin: g, billingAddress: b.address || undefined } : {}),
        whatsapp, couponCode: couponCode || undefined, autoRenew,
      }, session.access_token)
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      new Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
        name: 'Sehatsandhi Business', description: `${b.name} · ${months === 1 ? '1 month' : `${months} months`}`,
        prefill: { name: b.name, email: b.email || undefined },
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

  return (
    <div className="card shadow-sm max-w-2xl space-y-4">
      <div>
        <h3 className="font-bold text-navy-700">Plan &amp; billing</h3>
        <p className="text-sm text-gray-500 mt-1">
          {active && termEnd
            ? <>Your plan runs until <b>{shortDate(termEnd)}</b>. Paying now adds the new term after that date.</>
            : active ? 'Your listing is active.'
            : 'Your listing goes live, and the dashboard opens fully, as soon as the payment goes through.'}
          {' '}Autopay is <b>{b.auto_renew === false ? 'off' : 'on'}</b>{b.renewal_whatsapp ? ' · WhatsApp included' : ''}.
        </p>
      </div>

      {!canPay ? (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          Only the owner or manager of {b.name} can pay or change the plan. Please ask them to log in.
        </p>
      ) : (
        <>
          {terms.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Plan</p>
              <div className="grid sm:grid-cols-3 gap-2">
                {terms.map(t => (
                  <button key={t.months} onClick={() => setMonths(t.months)}
                    className={`text-sm px-3 py-2.5 rounded-lg border text-left ${months === t.months ? 'bg-teal-50 border-teal-500 text-teal-800' : 'bg-white border-gray-200 text-gray-700'}`}>
                    <div className="font-semibold">{t.label || `${t.months} months`}</div>
                    <div>{t.price > 0 ? inr(t.price) : 'No subscription'}{whatsapp && (t.whatsapp_price ?? 0) > 0 ? ` + WhatsApp ${inr(t.whatsapp_price ?? 0)}` : ''}</div>
                    {t.savings_note && <div className="text-xs text-teal-700">{t.savings_note}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {price?.whatsappAvailable && (
            <label className="flex items-start gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2.5">
              <input type="checkbox" checked={whatsapp} onChange={e => setWhatsapp(e.target.checked)} className="mt-1" />
              <span>
                <b>WhatsApp messaging</b> — {inr(terms.find(t => t.months === months)?.whatsapp_price ?? 0)} for this term
                (WhatsApp Business Verification &amp; Activation Fee). Messages are paid separately from your WhatsApp wallet.
              </span>
            </label>
          )}

          {(price?.subscriptionTotal ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Coupon code</p>
              <div className="flex gap-2">
                <input value={couponInput} onChange={e => setCouponInput(e.target.value.toUpperCase())} maxLength={40}
                  placeholder="e.g. DIWALI30" className="input-field text-sm flex-1" />
                {couponCode
                  ? <button onClick={() => { setCouponCode(''); setCouponInput('') }} className="btn-outline text-sm">Remove</button>
                  : <button onClick={() => setCouponCode(couponInput.trim())} disabled={!couponInput.trim()} className="btn-outline text-sm disabled:opacity-50">Apply</button>}
              </div>
              {couponCode && price?.coupon && <p className="text-sm text-teal-700 mt-1">{price.coupon.label}: − {inr(price.coupon.discount)}</p>}
              {couponCode && price?.couponError && <p className="text-sm text-red-600 mt-1">{price.couponError}</p>}
            </div>
          )}

          <label className="block text-xs font-semibold text-gray-500">GSTIN (optional)
            <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15}
              placeholder="22AAAAA0000A1Z5" className="input-field mt-1 text-sm font-mono" />
            {gstState === 'ok' && <span className="text-teal-700 font-normal">Registered in {GST_STATE_NAMES[g.slice(0, 2)] ?? g.slice(0, 2)}</span>}
            {gstState === 'bad' && <span className="text-red-600 font-normal">That does not look like a valid GSTIN.</span>}
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} className="mt-1" />
            <span><b>Renew automatically</b> — {autoRenew
              ? 'we renew on this plan when the term ends and tell you before we charge.'
              : 'we will not charge you again; we remind you 15 days before the plan ends.'}</span>
          </label>

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm space-y-1">
            {pricing || !price ? <p className="text-gray-400">Working out the price…</p> : <>
              {(price.lineItems ?? []).map(li => (
                <div key={li.label} className={`flex justify-between gap-3 ${li.amount < 0 ? 'text-teal-700' : ''}`}>
                  <span>{li.label}</span><span>{li.amount < 0 ? `− ${inr(-li.amount)}` : inr(li.amount)}</span>
                </div>
              ))}
              {price.tax.applied && due > 0 && (price.tax.igst > 0
                ? <div className="flex justify-between text-gray-500"><span>IGST {price.tax.rate}%</span><span>{inr(price.tax.igst)}</span></div>
                : <div className="flex justify-between text-gray-500"><span>CGST + SGST {price.tax.rate}%</span><span>{inr(price.tax.cgst + price.tax.sgst)}</span></div>)}
              <div className="flex justify-between font-bold text-navy-700 pt-1 border-t border-gray-200"><span>Due now</span><span>{inr(due)}</span></div>
              {price.commissionPercent > 0 && <p className="text-xs text-gray-500">Plus {price.commissionPercent}% commission{price.commissionBasis ? ` on ${price.commissionBasis}` : ''}.</p>}
            </>}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button onClick={pay} disabled={busy || pricing || due <= 0} className="btn-teal disabled:opacity-50">
              {busy ? 'Opening payment…' : `${active ? 'Renew' : 'Pay'} ${inr(due)} with Razorpay`}
            </button>
            {active && (
              <button onClick={saveChoice} disabled={busy} className="btn-outline disabled:opacity-50">Save for next renewal</button>
            )}
          </div>
        </>
      )}
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
