import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useServiceAreas } from '../../hooks/useServiceAreas'
import { WA_NUMBER, SPECIALITIES } from '../../types'
import { BIZ, VERTICALS, VerticalKey, FALLBACK_AREAS, verticalFor } from './shared'
import VerticalIcon from './VerticalIcon'
import SandboxAutofill from '../../components/SandboxAutofill'
import { generateBusiness } from '../../lib/sandboxData'
import {
  computePrice, createRazorpayOrder, verifyRazorpayPayment,
  loadRazorpayCheckout, businessBackendConfigured, PriceResult, HospitalDoctor,
} from '../../lib/businessApi'
import { usePricing, monthlyAppliesTo, commissionFor, localMonthlyTotal } from '../../hooks/usePricing'
import { useTaxSettings, localTax, isValidGstin, GST_STATE_NAMES } from '../../hooks/useTaxSettings'
import { track } from '../../lib/analytics'
import { isSandbox } from '../../lib/env'
// Same file the pricing engine uses, so the quote here and the amount charged
// cannot describe different models.
import { headcountFor, applyHeadcount, describeDoctorRate } from '../../../supabase/functions/_shared/headcount'

// Design 2b — 4-step onboarding wizard.
// Layout: desktop = dark left step-rail + content pane; tablet (<900px) =
// horizontal stepper on top, content below (and in step 3 the summary drops
// below the pincode grid).
//
// Pricing is authoritative from the server: step 3 sends the selected pincodes
// to the compute-price Edge Function and shows what it returns. If the backend
// isn't configured (fresh dev), it falls back to summing the local list so the
// UI still works. Step 4 pays via Razorpay, whose amount the server recomputes.
//
// Two billing models, decided by the step-1 vertical (see shared.ts):
//   • pincode_monthly (doctors, hospitals, labs) — pay per pincode per month,
//     Razorpay at step 4.
//   • commission (pharmacy, insurance, ambulance) — free to list, 10% of
//     billing. Step 3 shows reach without a price, step 4 takes no payment and
//     asks the business to accept the commission term instead.

const font = "'Manrope','Noto Sans Devanagari',system-ui,sans-serif"

// What a doctor may pick. LAB and PHRM are excluded deliberately: they are
// separate verticals with their own signup and their own billing, and choosing
// one here would bill a doctor as a diagnostics centre.
const DOCTOR_SPECIALITIES = SPECIALITIES.filter(s => s.id !== 'LAB' && s.id !== 'PHRM')

// Compact row input for the consultant list — narrower than the main Field so
// four of them fit one line on a laptop.
const hospInput: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BIZ.inputBorder}`,
  fontFamily: 'inherit', fontSize: 14, color: BIZ.ink, background: '#fff', width: '100%',
}

interface CoverageArea {
  pin_code: string
  area_name: string
  tier_number: number
  tier_name: string
  monthly_price: number
  population: number
}

interface RazorpayResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export default function BusinessRegister() {
  const { areas } = useServiceAreas()
  const [step, setStep] = useState(1)
  const [vertical, setVertical] = useState<VerticalKey>('doctors')
  const [form, setForm] = useState<Record<string, string>>({})
  const [zips, setZips] = useState<string[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [paid, setPaid] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  // Consultants, for a hospital. Each becomes an ordinary doctors row, so they
  // get profiles, search results and their own appointments.
  const [hospDoctors, setHospDoctors] = useState<HospitalDoctor[]>([])
  const [invoiceToken, setInvoiceToken] = useState<string | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)

  // The live pricing plan. Everything below asks the plan how to price rather
  // than assuming per-pincode tiers, so switching plans in admin changes the
  // wizard with no deploy.
  const { plan, tiers, verticals: vbRows } = usePricing()
  const vb = vbRows.find(v => v.vertical === vertical)

  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  // Depends on which backend is active, so it is resolved here rather than
  // being a module constant.
  const backendReady = businessBackendConfigured()
  const verticalObj = verticalFor(vertical)

  const monthlyApplies = monthlyAppliesTo(plan, vb)
  const commission = commissionFor(plan, vb)
  // "Commission only" — no monthly fee at all, so there is nothing to pay today.
  const onCommission = !monthlyApplies && commission.percent > 0
  const commissionPct = commission.percent || verticalObj.commissionPercent || 10
  const commissionBasis = commission.basis ?? verticalObj.commissionBasis ?? 'billing'
  const flatPlan = plan.mode !== 'pincode_tiers'

  // GST, from tax_settings. Zero while it is switched off, so the wizard shows
  // exactly what will be charged either way.
  const tax = useTaxSettings()

  // Entering the wizard is the top of the sales funnel; comparing this against
  // paid listings is what shows where signups are being lost.
  useEffect(() => { track('business_lead') }, [])

  // How many months they're buying upfront — always their choice.
  //
  // This used to open at plan.default_months, which was 5, so a business that
  // wanted one month was pre-committed to five and had to notice the picker to
  // undo it. It opens at the shortest allowed term instead; default_months only
  // marks one option as best value (see the ★ below) and never preselects.
  const [months, setMonths] = useState(plan.min_months)
  useEffect(() => { setMonths(plan.min_months) }, [plan.min_months])
  const monthOptions = Array.from(
    { length: Math.max(1, plan.max_months - plan.min_months + 1) },
    (_, i) => plan.min_months + i,
  )

  const coverage: CoverageArea[] = useMemo(() => {
    if (areas.length) {
      return areas.map(a => ({
        pin_code: a.pin_code, area_name: a.area_name, tier_number: a.tier_number,
        tier_name: a.tier_name || `Tier ${a.tier_number}`, monthly_price: a.monthly_price,
        population: a.population,
      }))
    }
    return FALLBACK_AREAS.map(a => ({ ...a, population: a.pop }))
  }, [areas])

  const toggleZip = (pin: string) =>
    setZips(s => (s.includes(pin) ? s.filter(p => p !== pin) : [...s, pin]))

  // ── Area picker ──
  // Twenty areas as twenty large cards was a wall, especially on a phone where
  // they stack. A filter, two bulk actions and one compact row each turns it
  // into a list you can scan. Under a flat plan "select all" is usually the
  // right answer anyway, so it is one tap away.
  const [areaQuery, setAreaQuery] = useState('')
  const visibleAreas = useMemo(() => {
    const q = areaQuery.trim().toLowerCase()
    if (!q) return coverage
    return coverage.filter(z =>
      z.area_name.toLowerCase().includes(q) || z.pin_code.includes(q))
  }, [coverage, areaQuery])

  // ── Live pricing: prefer the server (authoritative); fall back to a local
  //    sum when the backend isn't configured or is unreachable. ──
  const localPrice: PriceResult = useMemo(() => {
    const chosen = coverage.filter(z => zips.includes(z.pin_code))
    // Consultants beyond the plan's included headcount. Mirrors the server so
    // the number on screen matches what Razorpay is asked for.
    const namedDoctors = vertical === 'hospital'
      ? hospDoctors.filter(d => d.name.trim()).length : 0
    const hc = headcountFor(plan, namedDoctors)
    const monthlyTotal = monthlyApplies
      ? applyHeadcount(localMonthlyTotal(plan, tiers, chosen), hc) : 0
    const residents = chosen.reduce((a, z) => a + z.population, 0)
    // "Plan tier" only means something when pincodes are individually priced.
    const top = monthlyApplies && plan.mode === 'pincode_tiers'
      ? chosen.reduce<CoverageArea | null>((a, z) => (!a || z.monthly_price > a.monthly_price ? z : a), null)
      : null
    return {
      pincodes: chosen.map(z => z.pin_code), count: chosen.length, residents,
      topTier: top ? { tier_number: top.tier_number, tier_name: top.tier_name } : null,
      breakdown: [],
      planCode: plan.code, planLabel: plan.label, mode: plan.mode,
      monthlyTotal, months, total: monthlyTotal * months,
      defaultMonths: plan.default_months, minMonths: plan.min_months, maxMonths: plan.max_months,
      doctorCount: hc.doctorCount,
      includedDoctors: plan.included_doctors ?? 1,
      extraDoctors: hc.extraDoctors,
      extraDoctorCost: hc.extraCost,
      doctorBilling: plan.doctor_billing ?? 'none',
      doctorMultiplier: hc.multiplier,
      monthlyApplies,
      commissionPercent: commission.percent,
      commissionBasis: commission.basis,
      commissionSuspended: commission.suspended,
      tax: localTax(monthlyTotal * months, tax, form.gstin),
      priceIncludesGst: plan.price_includes_gst ?? false,
    }
  }, [coverage, zips, plan, tiers, months, monthlyApplies, commission, tax, form.gstin, vertical, hospDoctors])

  const [serverPrice, setServerPrice] = useState<PriceResult | null>(null)
  const [pricing, setPricing] = useState(false)
  const priceReq = useRef(0)
  useEffect(() => {
    if (!backendReady || !zips.length) { setServerPrice(null); return }
    const id = ++priceReq.current
    setPricing(true)
    const t = setTimeout(async () => {
      try {
        // Vertical is a display hint here (no listing row yet); the server still
        // decides the plan and re-derives the vertical from the row before
        // charging. Months are clamped server-side to the plan's bounds.
        const res = await computePrice(zips, null, vertical, months)
        if (id === priceReq.current) setServerPrice(res)
      } catch {
        if (id === priceReq.current) setServerPrice(null) // fall back to localPrice
      } finally {
        if (id === priceReq.current) setPricing(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [zips, vertical, months, hospDoctors.length])

  // What the summary shows: server total when we have one, else the local sum.
  const price = serverPrice ?? localPrice

  // ── Step validation ──
  const stepValid = (s: number): boolean => {
    if (s === 1) return !!vertical
    // A doctor without a speciality is unsearchable — patients match on it
    // exactly — so it is required rather than defaulted to something wrong.
    if (s === 2) return !!(form.business_name?.trim() && form.phone?.trim()
      && (vertical !== 'doctors' || form.speciality))
    if (s === 3) return zips.length > 0
    return true
  }
  const nextStep = () => {
    if (!stepValid(step)) {
      setError(step === 2
        ? (vertical === 'doctors' && !form.speciality
            ? 'Please choose a speciality — it is how patients find you.'
            : 'Please enter at least a business name and WhatsApp number.')
        : step === 3 ? 'Select at least one pincode to continue.' : 'Please complete this step.')
      return
    }
    setError('')
    setStep(s => Math.min(4, s + 1))
  }
  const prevStep = () => { setError(''); setStep(s => Math.max(1, s - 1)) }
  const goStep = (n: number) => {
    // allow jumping back freely, and forward only through validated steps
    if (n <= step || [1, 2, 3].slice(0, n - 1).every(stepValid)) { setError(''); setStep(n) }
  }

  // ── Sandbox autofill ──
  // Keeps the tester's chosen `vertical`: it decides whether step 4 ends at
  // Razorpay or at the WhatsApp commission path, so overwriting it would take
  // away control of which branch is under test.
  //
  // Pincodes come from `coverage` (live service_areas when available) rather
  // than a hardcoded list, because compute-price only prices pincodes the
  // server knows. Picking the two most expensive makes the charge clearly
  // non-zero, so a ₹0 total is unambiguous evidence that seeding failed rather
  // than a plausible-looking result.
  const fillSandbox = () => {
    const { form: generated } = generateBusiness(vertical)
    setForm(generated)
    setZips(
      [...coverage]
        .sort((a, b) => b.monthly_price - a.monthly_price)
        .slice(0, 2)
        .map(z => z.pin_code),
    )
    setAcceptedTerms(true)
    setError('')
  }

  const navCircle = (n: number): React.CSSProperties => ({
    width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 800, fontSize: 14, flex: '0 0 auto',
    background: step >= n ? BIZ.green : '#eee6d8', color: step >= n ? '#fff' : '#9a8f7c',
  })

  // Create (or reuse) the pending doctor row; returns its id for payment.
  // Three states, not two: an empty field is neither valid nor invalid, and
  // colouring a half-typed GSTIN red is just nagging.
  const gstinState: 'empty' | 'partial' | 'ok' | 'bad' = (() => {
    const v = (form.gstin ?? '').trim()
    if (!v) return 'empty'
    if (v.length < 15) return 'partial'
    return isValidGstin(v) ? 'ok' : 'bad'
  })()

  const buyerStateName = gstinState === 'ok'
    ? (GST_STATE_NAMES[(form.gstin ?? '').slice(0, 2)] ?? null)
    : null

  const doctorIdRef = useRef<string | null>(null)
  const ensureDoctorRow = async (): Promise<string | null> => {
    if (doctorIdRef.current) return doctorIdRef.current
    // Via RPC, not a direct insert. `.insert(...).select('id')` asks PostgREST
    // to read the row back, and that read is filtered by
    // allow_read_active_doctors (status = 'active') — so a just-created
    // 'pending' listing is invisible to its own creator and the whole call
    // fails as an RLS violation. create_listing is SECURITY DEFINER and
    // returns only the new id; it also forces status server-side, so a caller
    // cannot self-activate a listing. See migration 0002.
    // A hospital is an organisation with consultants, not a single listing, so
    // it takes a different RPC — one transaction for the org, its own listing
    // and every consultant.
    if (vertical === 'hospital') {
      const { data: hid, error: hErr } = await supabase.rpc('sehat_create_hospital', {
        p_name: form.business_name || form.owner_name || 'Hospital',
        p_address: form.address || '',
        p_pin_codes: zips,
        p_phone: form.phone || '',
        p_email: form.email || '',
        p_reg_number: form.reg_number || null,
        p_doctors: hospDoctors.filter(d => d.name.trim()),
      })
      if (hErr) { setError(`Could not save hospital: ${hErr.message}`); return null }
      doctorIdRef.current = hid as string
      return hid as string
    }

    const { data, error: insErr } = await supabase.rpc('create_listing', {
      p_name: form.business_name || form.owner_name || 'Business',
      // The doctor's own speciality when they chose one; the vertical's own code
      // otherwise (PHARMACY, LAB, …), which is what identifies those businesses.
      p_speciality: vertical === 'doctors' && form.speciality
        ? form.speciality
        : verticalObj.dbSpeciality,
      p_clinic_name: form.business_name || form.owner_name,
      p_address: form.address || '',
      p_pin_codes: zips,
      p_phone: form.phone || '',
      p_email: form.email || '',
      p_qualification: verticalObj.qualification,
      p_consultation_fee: 0,
    })
    if (insErr) { setError(`Could not save listing: ${insErr.message}`); return null }
    doctorIdRef.current = data as string
    return data as string
  }

  const waLink = `https://wa.me/${WA_NUMBER.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Business signup: ' + verticalObj.label + ' — ' + (form.business_name || ''))}`

  // "Activate on WhatsApp" — save the listing, then hand off to WhatsApp.
  const activateOnWhatsApp = async () => {
    // On the commission plan nothing is charged, so this click is the only place
    // the business assents to the 10% term — don't let it through without it.
    if (onCommission && !acceptedTerms) {
      setError(`Please accept the ${commissionPct}% commission terms to continue.`)
      return
    }
    setSubmitting(true); setError('')
    const id = await ensureDoctorRow()
    setSubmitting(false)
    if (!id) return
    setDone(true)
    window.open(waLink, '_blank', 'noopener')
  }

  // "Pay with Razorpay" — server creates the order (amount from pincodes),
  // Checkout runs, then the server verifies the signature before marking paid.
  const payWithRazorpay = async () => {
    setSubmitting(true); setError('')
    try {
      const id = await ensureDoctorRow()
      if (!id) { setSubmitting(false); return }
      // A wrong GSTIN produces an invoice they cannot claim against, and it is
      // not correctable afterwards without a credit note. Stop here instead.
      if (gstinState === 'bad' || gstinState === 'partial') {
        setError('Please correct your GST number, or clear the field if you are not registered.')
        setSubmitting(false)
        return
      }
      const order = await createRazorpayOrder(zips, id, months, {
        gstin: gstinState === 'ok' ? form.gstin : undefined,
        gstLegalName: form.gst_legal_name || undefined,
        billingAddress: form.address || undefined,
      })
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      const rzp = new Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency,
        order_id: order.orderId, name: 'Sehatsandhi Business',
        description: `${verticalObj.label} · ${zips.length} pincode${zips.length === 1 ? '' : 's'} · ${months} month${months === 1 ? '' : 's'}`,
        // Razorpay wants a bare 10-digit number or +91XXXXXXXXXX with nothing
        // else in it. Our field is placeholdered "+91 ", so what people type
        // usually carries a country code and spaces — passed through raw, the
        // Checkout form can land in a state it will not advance out of.
        // An unusable value is dropped rather than sent: Checkout then just asks
        // for it, which is recoverable, where a malformed one is not.
        prefill: {
          name: form.owner_name || form.business_name,
          contact: (() => {
            const digits = (form.phone ?? '').replace(/\D/g, '')
            if (digits.length === 10) return digits
            if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
            if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
            return undefined
          })(),
          email: form.email || undefined,
        },
        theme: { color: BIZ.green },
        // Don't offer to save the card. A business pays for a listing term once
        // and renews months later, so a stored card buys nothing — and the
        // tokenisation consent it triggers adds a second OTP screen ("Securely
        // saving your card") on top of the payment's own, which is a step to
        // lose people on.
        remember_customer: false,
        handler: async (r: RazorpayResponse) => {
          const v = await verifyRazorpayPayment({
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature, paymentRowId: order.paymentRowId,
          })
          if (v.ok) {
            // The invoice is issued inside razorpay-verify, so its number comes
            // back with the confirmation — show it rather than making them wait
            // for the WhatsApp message.
            setInvoiceNumber(v.invoiceNumber ?? null)
            setInvoiceToken(v.invoiceToken ?? null)
            setPaid(true); setDone(true)
          }
          else setError('Payment could not be verified. If money was deducted, our team will reconcile it.')
        },
      })
      rzp.open()
    } catch (e) {
      setError(`Payment failed to start: ${(e as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const RAIL_STEPS = [
    { n: 1, label: 'Service type' },
    { n: 2, label: 'Business details' },
    { n: 3, label: onCommission ? 'Coverage' : 'Coverage & pricing' },
    { n: 4, label: onCommission ? 'Review & activate' : 'Review & pay' },
  ]

  // Full-bleed at every width — the wizard IS the page, so it gets no outer
  // padding, border or card shadow. On desktop the dark rail runs the full
  // height against the cream content pane, matching the landing page's flat,
  // edge-to-edge sections rather than floating a card on a cream backdrop.
  return (
    <div style={{ background: BIZ.cream, fontFamily: font, minHeight: '100vh' }}>
      <SandboxAutofill onFill={fillSandbox} hint={verticalObj.label} />
      <div>
        {/* Tablet/mobile stepper (hidden on desktop, where the rail shows).
            Dots rather than numbered circles: numbers duplicated the "STEP n OF 4"
            kicker below and made every step look equally weighted. As dots, all
            four fit easily — the current one stretches into a pill and carries
            the only label, so progress reads at a glance without scrolling. */}
        <div className="flex lg:hidden items-center" style={{ background: BIZ.ink, padding: '7px 18px', gap: 7 }}>
          {RAIL_STEPS.map(s => {
            const current = s.n === step
            const done = s.n < step
            return (
              <button key={s.n} onClick={() => goStep(s.n)} aria-current={current ? 'step' : undefined}
                aria-label={`Step ${s.n} of 4: ${s.label}`}
                style={{
                  // The dot is only 8px, so the button pads out to a ~44px tap
                  // target around it; negative margin keeps the dots visually
                  // tight despite the larger hit area.
                  display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
                  padding: current ? '11px 0' : '11px 7px', margin: current ? 0 : '0 -7px',
                  flex: current ? '1 1 auto' : '0 0 auto',
                }}>
                <span style={{
                  // completed/current read green; upcoming stays a dim outline.
                  height: 8, width: current ? 22 : 8, borderRadius: 999, flex: '0 0 auto',
                  background: done || current ? BIZ.green : 'rgba(255,255,255,.22)',
                  transition: 'width .2s ease, background .2s ease',
                }} />
                {current && (
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{s.label}</span>
                )}
              </button>
            )
          })}
          <span style={{ fontSize: 13, fontWeight: 700, color: '#9fb3aa', flex: '0 0 auto', marginLeft: 'auto' }}>{step}/4</span>
        </div>

        <div style={{ background: BIZ.cream }} className="grid lg:grid-cols-[300px_1fr] lg:min-h-screen">
          {/* desktop step rail — sticky so it stays put while the form scrolls */}
          <div className="hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen" style={{ background: BIZ.ink, padding: '36px 30px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}>
              {/* full logo, centered + large. It's transparent, and its blue elements
                  need a light backing on the dark rail, so it sits on a cream chip. */}
              <img src="/logo-tight.png" alt="Sehatsandhi" style={{ height: 132, width: 'auto', objectFit: 'contain', borderRadius: 16, background: '#FBF7F0', padding: '16px 20px' }} />
            </div>
            {RAIL_STEPS.map(s => (
              <button key={s.n} onClick={() => goStep(s.n)} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '11px 0', fontFamily: 'inherit', textAlign: 'left' }}>
                <span style={navCircle(s.n)}>{s.n}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: step === s.n ? '#fff' : '#e8efeb' }}>{s.label}</span>
              </button>
            ))}
            {/* marginTop:auto pins this to the bottom of the full-height rail */}
            <div style={{ marginTop: 'auto', background: 'rgba(255,255,255,.06)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 12, color: '#8fa89d', fontWeight: 700, marginBottom: 6 }}>NEED HELP?</div>
              <div style={{ fontSize: 13, color: '#c9d6d0', lineHeight: 1.5 }}>Our team can register your business over a call in Hindi.</div>
            </div>
          </div>

          {/* step content — fills the pane at every width. padding/min-height are
              inline (not Tailwind) because inline styles win over utility
              classes, so they have to be fluid here. */}
          <div style={{ padding: 'clamp(22px,5.5vw,48px) clamp(18px,5vw,56px)', display: 'flex', flexDirection: 'column', minHeight: 'min(640px, 70vh)', width: '100%' }}>
            {done ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <CheckCircle2 style={{ width: 64, height: 64, color: BIZ.green, marginBottom: 16 }} />
                <h3 style={{ fontSize: 26, fontWeight: 800, color: BIZ.ink, margin: '0 0 8px' }}>{paid ? 'Payment received — listing active!' : 'Listing submitted!'}</h3>
                <p style={{ fontSize: 15, color: BIZ.muted, maxWidth: 440, margin: '0 0 24px' }}>
                  Your {verticalObj.label} listing across {zips.length} pincode{zips.length === 1 ? '' : 's'} {paid ? 'is now live for patients in those areas.' : 'is pending review. Our team will WhatsApp you to activate it.'}
                </p>
                {paid && invoiceToken && (
                  <div style={{ marginBottom: 20, background: BIZ.chipBg, border: '1px solid #cfe8dc', borderRadius: 16, padding: '16px 20px', maxWidth: 440 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink }}>
                      Tax invoice {invoiceNumber ?? ''} is ready
                    </div>
                    <p style={{ fontSize: 13, color: BIZ.muted, margin: '4px 0 12px', lineHeight: 1.6 }}>
                      We've sent the link to your WhatsApp. You can open it any time and save it as a PDF.
                    </p>
                    {/* Carry the backend choice across the tab boundary.
                        target="_blank" opens a tab with its own sessionStorage,
                        where getEnv() falls back to prod — so a sandbox invoice
                        was being looked up in production and reported invalid.
                        applyEnvFromUrl() consumes this param and strips it. */}
                    <a href={`/invoice/${invoiceToken}${isSandbox() ? '?env=sandbox' : ''}`}
                       target="_blank" rel="noreferrer"
                       style={{ display: 'inline-block', background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 14, padding: '10px 18px', borderRadius: 11 }}>
                      View invoice
                    </a>
                  </div>
                )}
                {!paid && <a href={waLink} target="_blank" rel="noreferrer" style={{ background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 15, padding: '13px 28px', borderRadius: 12 }}>Message us on WhatsApp</a>}
              </div>
            ) : (
              <>
                {step === 1 && (
                  <>
                    <div style={{ flex: 1 }}>
                      <StepKicker n={1} />
                      <h3 style={h3Style}>What kind of business are you listing?</h3>
                      <p style={pStyle}>Choose the category patients will find you under.</p>
                      <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {VERTICALS.map(v => {
                          const on = vertical === v.key
                          return (
                            <button key={v.key} onClick={() => setVertical(v.key)} style={{
                              display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 16, cursor: 'pointer',
                              fontFamily: 'inherit', textAlign: 'left', background: '#fff',
                              border: `2px solid ${on ? BIZ.green : '#eee6d8'}`,
                              boxShadow: on ? '0 0 0 4px rgba(14,159,110,.12)' : 'none',
                            }}>
                              <span style={{ color: v.color }}><VerticalIcon vertical={v.key} size={30} /></span>
                              <span style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink }}>{v.label}</span>
                              <span style={{ fontSize: 12.5, color: BIZ.mutedWarm }}>{v.sub}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <FooterBar error={error}><span /><button onClick={nextStep} style={btnPrimary}>Continue →</button></FooterBar>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div style={{ flex: 1 }}>
                      <StepKicker n={2} />
                      <h3 style={h3Style}>Tell us about your business</h3>
                      <p style={pStyle}>Listing as <strong style={{ color: BIZ.green }}>{verticalObj.label}</strong>. This is what patients will see.</p>
                      <div className="grid gap-[18px] grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                        <Field label="Business name *" placeholder="e.g. Aggarwal Eye Care" value={form.business_name} onChange={v => upd('business_name', v)} />
                        <Field label="Owner / contact name" placeholder="e.g. Dr. Ramesh Aggarwal" value={form.owner_name} onChange={v => upd('owner_name', v)} />
                        <Field label="WhatsApp number *" placeholder="+91 " value={form.phone} onChange={v => upd('phone', v)} type="tel" inputMode="tel" autoComplete="tel" />
                        {/* A dropdown, and it is now saved. This was free text
                            that create_listing ignored — every doctor was stored
                            as GEN, so a cardiologist never appeared in a
                            cardiology search. Patients match on this exact value. */}
                        {vertical === 'doctors' ? (
                          <div>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: BIZ.ink, marginBottom: 7 }}>
                              Speciality *
                            </label>
                            <select value={form.speciality ?? ''}
                              onChange={e => upd('speciality', e.target.value)}
                              style={{
                                width: '100%', padding: '13px 14px', borderRadius: 12,
                                border: `1.5px solid ${BIZ.inputBorder}`, fontFamily: 'inherit',
                                fontSize: 15, color: form.speciality ? BIZ.ink : BIZ.mutedWarm, background: '#fff',
                              }}>
                              <option value="">Choose a speciality…</option>
                              {DOCTOR_SPECIALITIES.map(sp => (
                                <option key={sp.id} value={sp.id}>{sp.en}</option>
                              ))}
                            </select>
                            <p style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 6 }}>
                              This is what patients search by, so pick the one they would look for.
                            </p>
                          </div>
                        ) : (
                          <Field label="Category / speciality" placeholder="e.g. Ophthalmology" value={form.category} onChange={v => upd('category', v)} />
                        )}
                        <Field label="Registration number" placeholder="e.g. HR-12345 (optional)" value={form.reg_number} onChange={v => upd('reg_number', v)} />
                        <Field label="Email" placeholder="you@example.com (optional)" value={form.email} onChange={v => upd('email', v)} type="email" inputMode="email" autoComplete="email" />
                        <div className="sm:col-span-2 xl:col-span-3">
                          <Field label="Full address" placeholder="Shop / building, area, city" value={form.address} onChange={v => upd('address', v)} />
                        </div>
                      </div>

                      {/* Consultants. Only hospitals: a solo practice is one
                          doctor and must never be asked to list itself. Each
                          becomes a real listing — searchable, with its own
                          profile and appointment calendar. */}
                      {vertical === 'hospital' && (
                        <div style={{ marginTop: 28, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: '20px 22px' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: BIZ.ink, marginBottom: 4 }}>
                            Your doctors
                          </div>
                          <p style={{ fontSize: 13.5, color: BIZ.muted, margin: '0 0 16px', lineHeight: 1.6 }}>
                            Add each consultant who sees patients here. Every one gets their own profile and
                            appointment calendar, so a patient searching for a cardiologist in your area finds
                            them by name.
                            {describeDoctorRate(plan) && <> {describeDoctorRate(plan)}</>}
                          </p>

                          {/* Grouped per doctor. Stacked as four bare fields the
                              remove button ended up orphaned on its own line and
                              nothing showed which doctor it belonged to — three
                              doctors read as twelve unrelated inputs. Each is a
                              card on mobile, one row from sm up. */}
                          {hospDoctors.map((doc, i) => (
                            <div key={i}
                              style={{
                                border: `1px solid ${BIZ.border}`, borderRadius: 14,
                                padding: 12, marginBottom: 10, background: '#fdfcfa',
                              }}
                              className="sm:border-0 sm:p-0 sm:bg-transparent sm:rounded-none">
                              <div className="flex items-center justify-between mb-2 sm:hidden">
                                <span style={{ fontSize: 12.5, fontWeight: 800, color: BIZ.mutedWarm, letterSpacing: '.04em' }}>
                                  DOCTOR {i + 1}
                                </span>
                                <button onClick={() => setHospDoctors(list => list.filter((_, j) => j !== i))}
                                  style={{
                                    border: 'none', background: 'transparent', cursor: 'pointer',
                                    color: '#d94848', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                                    padding: '2px 4px',
                                  }}>
                                  Remove
                                </button>
                              </div>
                              <div className="grid gap-2 grid-cols-1 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
                                <input placeholder="Doctor's name" value={doc.name}
                                  onChange={e => setHospDoctors(list => list.map((d, j) => j === i ? { ...d, name: e.target.value } : d))}
                                  style={hospInput} />
                                <select value={doc.speciality}
                                  onChange={e => setHospDoctors(list => list.map((d, j) => j === i ? { ...d, speciality: e.target.value } : d))}
                                  style={hospInput}>
                                  {SPECIALITIES.map(sp => <option key={sp.id} value={sp.id}>{sp.en}</option>)}
                                </select>
                                <input placeholder="Qualification" value={doc.qualification ?? ''}
                                  onChange={e => setHospDoctors(list => list.map((d, j) => j === i ? { ...d, qualification: e.target.value } : d))}
                                  style={hospInput} />
                                {/* The × only exists from sm up, where the row
                                    layout gives it a column of its own. */}
                                <button onClick={() => setHospDoctors(list => list.filter((_, j) => j !== i))}
                                  className="hidden sm:block"
                                  style={{ ...hospInput, width: 44, cursor: 'pointer', color: '#d94848', fontWeight: 800, borderColor: '#f0d9d9' }}
                                  title="Remove">×</button>
                              </div>
                            </div>
                          ))}

                          <button
                            onClick={() => setHospDoctors(list => [...list, { name: '', speciality: 'GEN', qualification: '' }])}
                            style={{
                              marginTop: 6, padding: '10px 18px', borderRadius: 11, cursor: 'pointer',
                              border: `2px dashed ${BIZ.green}`, background: '#fff', color: BIZ.green,
                              fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
                            }}>
                            + Add a doctor
                          </button>

                          {hospDoctors.filter(d => d.name.trim()).length > 0 && (
                            <div style={{ marginTop: 14, fontSize: 13.5, color: BIZ.ink }}>
                              <strong>{hospDoctors.filter(d => d.name.trim()).length}</strong> doctor
                              {hospDoctors.filter(d => d.name.trim()).length === 1 ? '' : 's'} added
                              {price.doctorBilling === 'per_doctor' && price.doctorMultiplier > 1 && (
                                <span style={{ color: BIZ.mutedWarm }}>
                                  {' '}· {price.doctorMultiplier} × ₹{(plan.monthly_price ?? 0).toLocaleString('en-IN')}
                                  {' '}= <strong style={{ color: BIZ.ink }}>₹{price.monthlyTotal.toLocaleString('en-IN')}/month</strong>
                                </span>
                              )}
                              {price.extraDoctors > 0 && (
                                <span style={{ color: BIZ.mutedWarm }}>
                                  {' '}· {price.extraDoctors} beyond the {price.includedDoctors} included
                                  {' '}= <strong style={{ color: BIZ.ink }}>+₹{price.extraDoctorCost.toLocaleString('en-IN')}/month</strong>
                                </span>
                              )}
                            </div>
                          )}
                          <p style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 10, lineHeight: 1.6 }}>
                            You can add or remove doctors later from your dashboard — the price follows.
                          </p>
                        </div>
                      )}
                    </div>
                    <FooterBar error={error}>
                      <button onClick={prevStep} style={btnBack}>← Back</button>
                      <button onClick={nextStep} style={btnPrimary}>Continue →</button>
                    </FooterBar>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div style={{ flex: 1 }}>
                      <StepKicker n={3} />
                      <h3 style={h3Style}>Choose your coverage</h3>
                      <p style={pStyle}>
                        {onCommission
                          ? `Tap the pincodes you want to reach. Coverage is free on your plan — you only pay ${commissionPct}% of ${commissionBasis}.`
                          : flatPlan
                            ? `Tap the pincodes you want to reach. Every pincode is included in ${plan.label.toLowerCase()} — pick as many as you can serve.`
                            : 'Tap the pincodes you want to reach. Price updates as you go.'}
                      </p>
                      {/* desktop: grid + sticky summary side by side; tablet: summary below */}
                      <div className="grid gap-6 items-start lg:grid-cols-[1fr_300px]">
                        <div>
                          {/* Filter and bulk actions, above the list they act on. */}
                          <div className="flex gap-2 flex-wrap items-center mb-3">
                            <input
                              value={areaQuery}
                              onChange={e => setAreaQuery(e.target.value)}
                              placeholder="Search area or pincode…"
                              style={{
                                flex: '1 1 180px', minWidth: 0, padding: '10px 13px', borderRadius: 11,
                                border: `1.5px solid ${BIZ.inputBorder}`, fontFamily: 'inherit',
                                fontSize: 14, color: BIZ.ink, background: '#fff',
                              }} />
                            <button onClick={() => setZips(coverage.map(z => z.pin_code))}
                              style={{
                                padding: '10px 14px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                                fontSize: 13, fontWeight: 800, border: `1.5px solid ${BIZ.green}`,
                                background: '#fff', color: BIZ.green, whiteSpace: 'nowrap',
                              }}>
                              Select all
                            </button>
                            {zips.length > 0 && (
                              <button onClick={() => setZips([])}
                                style={{
                                  padding: '10px 14px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 13, fontWeight: 700, border: `1.5px solid ${BIZ.inputBorder}`,
                                  background: '#fff', color: BIZ.muted, whiteSpace: 'nowrap',
                                }}>
                                Clear
                              </button>
                            )}
                          </div>

                          {/* Count first, so the choice is visible without
                              scrolling back through the list. */}
                          <div style={{ fontSize: 13, color: BIZ.mutedWarm, marginBottom: 10 }}>
                            {zips.length === 0
                              ? `${visibleAreas.length} area${visibleAreas.length === 1 ? '' : 's'} available`
                              : <><strong style={{ color: BIZ.ink }}>{zips.length} selected</strong>
                                  {areaQuery && ` · ${visibleAreas.length} matching`}</>}
                          </div>

                          <div style={{ border: `1px solid ${BIZ.border}`, borderRadius: 14, overflow: 'hidden' }}>
                            {visibleAreas.length === 0 && (
                              <div style={{ padding: '18px 14px', fontSize: 14, color: BIZ.mutedWarm, textAlign: 'center' }}>
                                Nothing matches "{areaQuery}".
                              </div>
                            )}
                            {visibleAreas.map((z, i) => {
                              const on = zips.includes(z.pin_code)
                              return (
                                <button key={z.pin_code} onClick={() => toggleZip(z.pin_code)} style={{
                                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                  textAlign: 'left', padding: '11px 13px', cursor: 'pointer',
                                  fontFamily: 'inherit', border: 'none',
                                  borderTop: i === 0 ? 'none' : `1px solid ${BIZ.border}`,
                                  background: on ? 'rgba(14,159,110,.08)' : '#fff',
                                }}>
                                  <span style={{
                                    width: 20, height: 20, borderRadius: 6, flex: '0 0 auto',
                                    border: `2px solid ${on ? BIZ.green : '#d8cfbd'}`,
                                    background: on ? BIZ.green : '#fff', color: '#fff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                                  }}>{on ? '✓' : ''}</span>
                                  <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink }}>{z.area_name}</span>
                                    <span style={{ fontSize: 12.5, color: BIZ.mutedWarm }}> · {z.pin_code}</span>
                                    <span style={{ display: 'block', fontSize: 12, color: BIZ.mutedWarm, marginTop: 2 }}>
                                      {z.population.toLocaleString('en-IN')} residents
                                    </span>
                                  </span>
                                  {/* Only show a per-area price when the plan
                                      actually charges per area — under a flat
                                      plan it is noise on every row. */}
                                  <span style={{ fontSize: 12.5, fontWeight: 700, color: BIZ.green, flex: '0 0 auto', textAlign: 'right' }}>
                                    {onCommission
                                      ? 'no fee'
                                      : plan.mode === 'flat_all_pincodes'
                                        ? 'included'
                                        : plan.mode === 'flat_per_pincode'
                                          ? `₹${(plan.monthly_price ?? 0).toLocaleString('en-IN')}/mo`
                                          : `₹${z.monthly_price.toLocaleString('en-IN')}/mo`}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: 22 }} className="lg:sticky lg:top-5">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.mutedWarm, textTransform: 'uppercase', letterSpacing: '.06em' }}>Your plan</div>
                            {pricing && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: BIZ.green }} />}
                          </div>
                          <SummaryRow label="Pincodes" value={String(price.count)} />
                          <SummaryRow label="Residents reached" value={price.residents.toLocaleString('en-IN')} />
                          {onCommission ? (
                            <div style={{ borderTop: `1px dashed ${BIZ.inputBorder}`, paddingTop: 16 }}>
                              <div style={{ fontSize: 13, color: BIZ.mutedWarm, marginBottom: 2 }}>Monthly listing fee</div>
                              <div style={{ fontSize: 32, fontWeight: 800, color: BIZ.green, letterSpacing: '-.02em' }}>₹0</div>
                              <div style={{ fontSize: 13.5, fontWeight: 800, color: BIZ.ink, marginTop: 12 }}>
                                {commissionPct}% of {commissionBasis}
                              </div>
                              <div style={{ fontSize: 12, color: BIZ.mutedWarm, lineHeight: 1.5, marginTop: 4 }}>{verticalObj.commissionNote}</div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <span style={{ fontSize: 14, color: BIZ.muted }}>{flatPlan ? 'Plan' : 'Plan tier'}</span>
                                <span style={{ background: BIZ.chipBg, color: BIZ.chipText, fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 999 }}>
                                  {flatPlan ? 'All pincodes' : (price.topTier?.tier_name ?? '—')}
                                </span>
                              </div>
                              <div style={{ borderTop: `1px dashed ${BIZ.inputBorder}`, paddingTop: 16 }}>
                                <div style={{ fontSize: 13, color: BIZ.mutedWarm, marginBottom: 2 }}>
                                  {flatPlan ? plan.label : 'Estimated monthly'}
                                </div>
                                <div style={{ fontSize: 32, fontWeight: 800, color: BIZ.green, letterSpacing: '-.02em' }}>₹{price.monthlyTotal.toLocaleString('en-IN')}<span style={{ fontSize: 15, color: BIZ.mutedWarm, fontWeight: 600 }}>/mo</span></div>
                                {flatPlan && (
                                  <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 4, lineHeight: 1.5 }}>
                                    Every pincode you pick is included — the price does not change with coverage.
                                  </div>
                                )}
                                {months > 1 && (
                                  <div style={{ fontSize: 13, color: BIZ.ink, fontWeight: 700, marginTop: 10 }}>
                                    ₹{(price.monthlyTotal * months).toLocaleString('en-IN')} for {months} months
                                  </div>
                                )}
                                {price.tax?.applied && (
                                  <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 8, lineHeight: 1.6 }}>
                                    + {price.tax.rate}% GST ₹{price.tax.taxTotal.toLocaleString('en-IN')}
                                    <div style={{ fontSize: 13, fontWeight: 800, color: BIZ.ink, marginTop: 2 }}>
                                      ₹{price.tax.grandTotal.toLocaleString('en-IN')} payable
                                    </div>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <FooterBar error={error}>
                      <button onClick={prevStep} style={btnBack}>← Back</button>
                      <button onClick={nextStep} style={btnPrimary}>Review →</button>
                    </FooterBar>
                  </>
                )}

                {step === 4 && (
                  <>
                    <div style={{ flex: 1 }}>
                      <StepKicker n={4} />
                      <h3 style={h3Style}>{onCommission ? 'Review & activate' : 'Review & pay'}</h3>
                      <p style={pStyle}>Confirm your listing. You can change coverage anytime.</p>
                      <div style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, overflow: 'hidden' }}>
                        <ReviewRow label="Service type" value={verticalObj.label} />
                        <ReviewRow label="Business name" value={form.business_name || form.owner_name || '—'} />
                        <ReviewRow label="Pincodes selected" value={String(price.count)} />
                        <ReviewRow label="Total reach" value={`${price.residents.toLocaleString('en-IN')} residents`} />
                        {onCommission
                          ? <ReviewRow label="Plan" value={`${commissionPct}% of ${commissionBasis}`} />
                          : <ReviewRow label="Plan" value={flatPlan ? plan.label : (price.topTier?.tier_name ?? '—')} />}
                        {!onCommission && (
                          <ReviewRow label="Monthly price" value={`₹${price.monthlyTotal.toLocaleString('en-IN')}/mo × ${months} month${months === 1 ? '' : 's'}`} />
                        )}
                        {!onCommission && price.tax?.applied && (
                          <>
                            <ReviewRow label="Taxable value" value={`₹${(price.monthlyTotal * months).toLocaleString('en-IN')}`} />
                            {price.tax.interState
                              ? <ReviewRow label={`IGST @ ${price.tax.rate}%`} value={`₹${price.tax.igst.toLocaleString('en-IN')}`} />
                              : <>
                                  <ReviewRow label={`CGST @ ${price.tax.rate / 2}%`} value={`₹${price.tax.cgst.toLocaleString('en-IN')}`} />
                                  <ReviewRow label={`SGST @ ${price.tax.rate / 2}%`} value={`₹${price.tax.sgst.toLocaleString('en-IN')}`} />
                                </>}
                          </>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 22px', background: '#f7f3ea' }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: BIZ.ink }}>Due today</span>
                          <span style={{ fontSize: 26, fontWeight: 800, color: BIZ.green }}>
                            ₹{(onCommission ? 0 : (price.tax?.applied ? price.tax.grandTotal : price.monthlyTotal * months)).toLocaleString('en-IN')}
                          </span>
                        </div>
                        {!onCommission && price.tax?.applied && (
                          <div style={{ padding: '0 22px 16px', fontSize: 12.5, color: BIZ.mutedWarm, background: '#f7f3ea' }}>
                            Includes {price.tax.rate}% GST. A tax invoice is issued as soon as payment succeeds —
                            we'll WhatsApp you the link and you can download it any time.
                          </div>
                        )}
                      </div>

                      {/* The buyer's own GSTIN. Optional, and only worth showing
                          while we are actually charging GST — without it the
                          18% is a cost to them; with it they claim it back as
                          input credit, so the field pays for itself. */}
                      {!onCommission && price.tax?.applied && (
                        <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: '20px 22px' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink, marginBottom: 4 }}>
                            Your GST number <span style={{ fontWeight: 600, color: BIZ.mutedWarm }}>— optional</span>
                          </div>
                          <p style={{ fontSize: 13, color: BIZ.muted, margin: '0 0 12px', lineHeight: 1.6 }}>
                            If your business is GST registered, add it and we will print it on your tax invoice.
                            You can then claim the ₹{(price.tax?.taxTotal ?? 0).toLocaleString('en-IN')} GST back as
                            input credit. Leave it blank if you are not registered — the price does not change either way.
                          </p>
                          <input
                            value={form.gstin ?? ''}
                            onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase().replace(/\s/g, '') }))}
                            maxLength={15}
                            placeholder="22AAAAA0000A1Z5"
                            style={{
                              width: '100%', maxWidth: 280, padding: '11px 13px', borderRadius: 11,
                              border: `2px solid ${gstinState === 'bad' ? '#d94848' : gstinState === 'ok' ? BIZ.green : BIZ.inputBorder}`,
                              fontFamily: 'inherit', fontSize: 15, fontWeight: 700, letterSpacing: '.04em',
                              textTransform: 'uppercase', color: BIZ.ink, background: '#fff',
                            }} />
                          {/* Say which state it implies. A wrong first two digits
                              is the commonest GSTIN typo and it silently changes
                              the tax split between CGST/SGST and IGST. */}
                          {gstinState === 'ok' && (
                            <div style={{ fontSize: 13, color: BIZ.green, fontWeight: 700, marginTop: 8 }}>
                              ✓ Valid{buyerStateName ? ` · registered in ${buyerStateName}` : ''}
                              {price.tax?.interState
                                ? ' · your invoice will show IGST'
                                : ' · your invoice will show CGST + SGST'}
                            </div>
                          )}
                          {gstinState === 'bad' && (
                            <div style={{ fontSize: 13, color: '#d94848', fontWeight: 700, marginTop: 8 }}>
                              That does not look like a valid GSTIN — please check it against your GST certificate.
                            </div>
                          )}
                        </div>
                      )}

                      {/* Term picker — paying several months upfront holds this
                          price for the whole term, even if the plan changes. */}
                      {!onCommission && monthOptions.length > 1 && (
                        <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: '20px 22px' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink, marginBottom: 4 }}>How many months would you like to pay for?</div>
                          <p style={{ fontSize: 13, color: BIZ.muted, margin: '0 0 14px', lineHeight: 1.6 }}>
                            Start with {plan.min_months} month{plan.min_months === 1 ? '' : 's'} if you prefer — it is entirely your choice.
                            Your rate is locked for the months you pay now, so a longer term holds ₹{price.monthlyTotal.toLocaleString('en-IN')}/mo for longer.
                          </p>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {monthOptions.map(m => {
                              const on = months === m
                              return (
                                <button key={m} onClick={() => setMonths(m)} style={{
                                  padding: '9px 14px', borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 14, fontWeight: 700, minWidth: 52,
                                  border: `2px solid ${on ? BIZ.green : '#e9e2d5'}`,
                                  background: on ? BIZ.green : '#fff',
                                  color: on ? '#fff' : BIZ.ink,
                                }}>
                                  {m}{m === plan.default_months && plan.default_months > plan.min_months ? '★' : ''}
                                </button>
                              )
                            })}
                          </div>
                          {/* Spell the arithmetic out. With GST on, months × rate
                              is the taxable value, not the amount charged — one
                              "=" across both would be wrong by the tax. */}
                          <div style={{ fontSize: 13, color: BIZ.mutedWarm, marginTop: 12, lineHeight: 1.7 }}>
                            {months} month{months === 1 ? '' : 's'} × ₹{price.monthlyTotal.toLocaleString('en-IN')} ={' '}
                            ₹{(price.monthlyTotal * months).toLocaleString('en-IN')}
                            {price.tax?.applied && <> + {price.tax.rate}% GST ₹{price.tax.taxTotal.toLocaleString('en-IN')}</>}
                            <br />
                            <strong style={{ color: BIZ.ink, fontSize: 15 }}>
                              ₹{(price.tax?.applied ? price.tax.grandTotal : price.monthlyTotal * months).toLocaleString('en-IN')}
                            </strong> payable today
                            {plan.default_months > plan.min_months && ` · ★ = best value at ${plan.default_months} months`}
                          </div>
                        </div>
                      )}

                      {onCommission ? (
                        <>
                          {/* No payment on this plan — so this card and its checkbox
                              are where the commission term is stated and accepted. */}
                          <div style={{ marginTop: 20, background: BIZ.chipBg, border: `1px solid #cfe8dc`, borderRadius: 18, padding: '20px 22px' }}>
                            <div style={{ fontSize: 17, fontWeight: 800, color: BIZ.ink }}>
                              No monthly fee · {commissionPct}% of {commissionBasis}
                            </div>
                            <p style={{ fontSize: 14, color: BIZ.muted, lineHeight: 1.6, margin: '8px 0 0' }}>{verticalObj.commissionNote}</p>
                            <p style={{ fontSize: 13, color: BIZ.mutedWarm, lineHeight: 1.6, margin: '10px 0 0' }}>
                              Nothing is charged now and no card is needed. Our team confirms the settlement cycle on WhatsApp once your listing is verified.
                            </p>
                            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 16, cursor: 'pointer' }}>
                              <input type="checkbox" checked={acceptedTerms}
                                onChange={e => { setAcceptedTerms(e.target.checked); if (e.target.checked) setError('') }}
                                style={{ width: 18, height: 18, accentColor: BIZ.green, marginTop: 1, flex: '0 0 auto', cursor: 'pointer' }} />
                              <span style={{ fontSize: 13.5, color: BIZ.ink, fontWeight: 600, lineHeight: 1.5 }}>
                                I agree to pay {commissionPct}% of {commissionBasis} on business that comes through Sehatsandhi.
                              </span>
                            </label>
                          </div>
                          <div style={{ marginTop: 20 }}>
                            <button onClick={activateOnWhatsApp} disabled={submitting || !acceptedTerms}
                              style={{ ...btnWhatsApp, opacity: submitting || !acceptedTerms ? 0.6 : 1, cursor: submitting || !acceptedTerms ? 'not-allowed' : 'pointer' }}>
                              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <WaGlyph />} Activate on WhatsApp
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2" style={{ marginTop: 20 }}>
                            <button onClick={activateOnWhatsApp} disabled={submitting} style={{ ...btnWhatsApp, opacity: submitting ? 0.6 : 1 }}>
                              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <WaGlyph />} Activate on WhatsApp
                            </button>
                            <button onClick={payWithRazorpay} disabled={submitting || !backendReady} style={{ ...btnPrimary, width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 8, opacity: submitting || !backendReady ? 0.6 : 1 }}>
                              {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Pay with Razorpay
                            </button>
                          </div>
                          {!backendReady && (
                            <p style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 10 }}>Razorpay checkout activates once the Supabase Edge Functions are deployed. Until then, use “Activate on WhatsApp”.</p>
                          )}
                        </>
                      )}
                    </div>
                    <FooterBar error={error}>
                      <button onClick={prevStep} style={btnBack}>← Back</button>
                      <span />
                    </FooterBar>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── small presentational helpers ──
const h3Style: React.CSSProperties = { fontSize: 'clamp(21px,5.2vw,26px)', fontWeight: 800, color: BIZ.ink, margin: '8px 0 6px', letterSpacing: '-.02em' }
const pStyle: React.CSSProperties = { fontSize: 15, color: BIZ.muted, margin: '0 0 26px' }
// minHeight 48 keeps every wizard button a full touch target on phones.
const btnPrimary: React.CSSProperties = { background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 15, padding: '13px clamp(20px,5vw,28px)', minHeight: 48, borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }
const btnBack: React.CSSProperties = { background: '#fff', color: '#3f4a44', fontWeight: 700, fontSize: 15, padding: '13px clamp(18px,4.5vw,24px)', minHeight: 48, borderRadius: 12, border: `1px solid ${BIZ.inputBorder}`, cursor: 'pointer', fontFamily: 'inherit' }
const btnWhatsApp: React.CSSProperties = { background: '#25D366', color: '#fff', fontWeight: 800, fontSize: 15, padding: '13px 20px', minHeight: 48, borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }

function StepKicker({ n }: { n: number }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.mutedWarm, letterSpacing: '.06em' }}>STEP {n} OF 4</div>
}

function FooterBar({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <div style={{ paddingTop: 24, borderTop: `1px solid ${BIZ.border}`, marginTop: 24 }}>
      {error && <div style={{ fontSize: 13, color: '#b91c1c', marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

function WaGlyph() {
  return <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.6 14.2c-.2.6-1.4 1.2-2 1.3-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-1.9.9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.5.7 1.8.8 1.9.1.1.1.3 0 .5l-.5.6-.4.4c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.2 1.3 1 2.3 1.4 2.6 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.7.9c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z" /></svg>
}

function Field({ label, placeholder, value, onChange, type = 'text', inputMode, autoComplete }: {
  label: string; placeholder: string; value?: string; onChange: (v: string) => void
  type?: string; inputMode?: 'text' | 'tel' | 'email' | 'numeric'; autoComplete?: string
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#3f4a44', display: 'block', marginBottom: 7 }}>{label}</span>
      {/* 16px font is required: iOS Safari auto-zooms the page on focus for
          anything smaller, which leaves the user zoomed into the form. */}
      <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        type={type} inputMode={inputMode} autoComplete={autoComplete}
        style={{ width: '100%', padding: '12px 14px', border: `1px solid ${BIZ.inputBorder}`, borderRadius: 12, fontSize: 16, fontFamily: 'inherit', outline: 'none', background: '#fdfbf6' }} />
    </label>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <span style={{ fontSize: 14, color: BIZ.muted }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink }}>{value}</span>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '18px clamp(16px,4vw,22px)', borderBottom: '1px solid #f0ebe0' }}>
      <span style={{ fontSize: 14, color: BIZ.muted, flex: '0 0 auto' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}
