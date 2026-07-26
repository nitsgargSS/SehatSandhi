import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useServiceAreas } from '../../hooks/useServiceAreas'
import { WA_NUMBER } from '../../types'
import { BIZ, VERTICALS, VerticalKey, FALLBACK_AREAS, verticalFor, isCommissionVertical } from './shared'
import VerticalIcon from './VerticalIcon'
import SandboxAutofill from '../../components/SandboxAutofill'
import { generateBusiness } from '../../lib/sandboxData'
import {
  computePrice, createRazorpayOrder, verifyRazorpayPayment,
  loadRazorpayCheckout, businessBackendConfigured, PriceResult,
} from '../../lib/businessApi'

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

  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))
  // Depends on which backend is active, so it is resolved here rather than
  // being a module constant.
  const backendReady = businessBackendConfigured()
  const verticalObj = verticalFor(vertical)
  const onCommission = isCommissionVertical(vertical)
  const commissionPct = verticalObj.commissionPercent ?? 10

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

  // ── Live pricing: prefer the server (authoritative); fall back to a local
  //    sum when the backend isn't configured or is unreachable. ──
  const localPrice: PriceResult = useMemo(() => {
    const chosen = coverage.filter(z => zips.includes(z.pin_code))
    // Commission verticals owe nothing for coverage — only reach is summed.
    const monthlyTotal = onCommission ? 0 : chosen.reduce((a, z) => a + z.monthly_price, 0)
    const residents = chosen.reduce((a, z) => a + z.population, 0)
    const top = onCommission
      ? null
      : chosen.reduce<CoverageArea | null>((a, z) => (!a || z.monthly_price > a.monthly_price ? z : a), null)
    return {
      pincodes: chosen.map(z => z.pin_code), count: chosen.length, monthlyTotal, residents,
      topTier: top ? { tier_number: top.tier_number, tier_name: top.tier_name } : null,
      breakdown: [],
      model: onCommission ? 'commission' : 'pincode_monthly',
      commissionPercent: onCommission ? commissionPct : 0,
      commissionBasis: onCommission ? verticalObj.commissionBasis ?? null : null,
    }
  }, [coverage, zips, onCommission, commissionPct, verticalObj])

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
        // decides the model, and re-derives it from the row before charging.
        const res = await computePrice(zips, null, vertical)
        if (id === priceReq.current) setServerPrice(res)
      } catch {
        if (id === priceReq.current) setServerPrice(null) // fall back to localPrice
      } finally {
        if (id === priceReq.current) setPricing(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [zips, vertical])

  // What the summary shows: server total when we have one, else the local sum.
  const price = serverPrice ?? localPrice

  // ── Step validation ──
  const stepValid = (s: number): boolean => {
    if (s === 1) return !!vertical
    if (s === 2) return !!(form.business_name?.trim() && form.phone?.trim())
    if (s === 3) return zips.length > 0
    return true
  }
  const nextStep = () => {
    if (!stepValid(step)) {
      setError(step === 2 ? 'Please enter at least a business name and WhatsApp number.'
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
    const { data, error: insErr } = await supabase.rpc('create_listing', {
      p_name: form.business_name || form.owner_name || 'Business',
      p_speciality: verticalObj.dbSpeciality,
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
      const order = await createRazorpayOrder(zips, id, 1)
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      const rzp = new Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency,
        order_id: order.orderId, name: 'Sehatsandhi Business',
        description: `${verticalObj.label} · ${zips.length} pincode${zips.length === 1 ? '' : 's'}`,
        prefill: { name: form.owner_name || form.business_name, contact: form.phone, email: form.email },
        theme: { color: BIZ.green },
        handler: async (r: RazorpayResponse) => {
          const v = await verifyRazorpayPayment({
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature, paymentRowId: order.paymentRowId,
          })
          if (v.ok) { setPaid(true); setDone(true) }
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
                        <Field label="Category / speciality" placeholder="e.g. Ophthalmology" value={form.category} onChange={v => upd('category', v)} />
                        <Field label="Registration number" placeholder="e.g. HR-12345 (optional)" value={form.reg_number} onChange={v => upd('reg_number', v)} />
                        <Field label="Email" placeholder="you@example.com (optional)" value={form.email} onChange={v => upd('email', v)} type="email" inputMode="email" autoComplete="email" />
                        <div className="sm:col-span-2 xl:col-span-3">
                          <Field label="Full address" placeholder="Shop / building, area, city" value={form.address} onChange={v => upd('address', v)} />
                        </div>
                      </div>
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
                          ? `Tap the pincodes you want to reach. Coverage is free on your plan — you only pay ${commissionPct}% of ${verticalObj.commissionBasis}.`
                          : 'Tap the pincodes you want to reach. Price updates as you go.'}
                      </p>
                      {/* desktop: grid + sticky summary side by side; tablet: summary below */}
                      <div className="grid gap-6 items-start lg:grid-cols-[1fr_300px]">
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                          {coverage.map(z => {
                            const on = zips.includes(z.pin_code)
                            return (
                              <button key={z.pin_code} onClick={() => toggleZip(z.pin_code)} style={{
                                textAlign: 'left', padding: '13px 14px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                                border: `2px solid ${on ? BIZ.green : '#e9e2d5'}`, background: on ? 'rgba(14,159,110,.09)' : '#fff',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                  <span style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink }}>{z.area_name}</span>
                                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: BIZ.green, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flex: '0 0 auto', opacity: on ? 1 : 0 }}>✓</span>
                                </div>
                                <div style={{ marginTop: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: 12, color: BIZ.mutedWarm, fontWeight: 600 }}>{z.pin_code}</span>
                                    <span style={{ fontSize: 12, color: BIZ.green, fontWeight: 700 }}>{z.population.toLocaleString('en-IN')} residents</span>
                                  </div>
                                  <div style={{ fontSize: 11, color: '#a89e8a', fontWeight: 600, marginTop: 4 }}>
                                    {onCommission ? `${z.tier_name} · no monthly fee` : `${z.tier_name} · ₹${z.monthly_price.toLocaleString('en-IN')}/mo`}
                                  </div>
                                </div>
                              </button>
                            )
                          })}
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
                                {commissionPct}% of {verticalObj.commissionBasis}
                              </div>
                              <div style={{ fontSize: 12, color: BIZ.mutedWarm, lineHeight: 1.5, marginTop: 4 }}>{verticalObj.commissionNote}</div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <span style={{ fontSize: 14, color: BIZ.muted }}>Plan tier</span>
                                <span style={{ background: BIZ.chipBg, color: BIZ.chipText, fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 999 }}>{price.topTier?.tier_name ?? '—'}</span>
                              </div>
                              <div style={{ borderTop: `1px dashed ${BIZ.inputBorder}`, paddingTop: 16 }}>
                                <div style={{ fontSize: 13, color: BIZ.mutedWarm, marginBottom: 2 }}>Estimated monthly</div>
                                <div style={{ fontSize: 32, fontWeight: 800, color: BIZ.green, letterSpacing: '-.02em' }}>₹{price.monthlyTotal.toLocaleString('en-IN')}<span style={{ fontSize: 15, color: BIZ.mutedWarm, fontWeight: 600 }}>/mo</span></div>
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
                          ? <ReviewRow label="Plan" value={`${commissionPct}% of ${verticalObj.commissionBasis}`} />
                          : <ReviewRow label="Plan tier" value={price.topTier?.tier_name ?? '—'} />}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 22px', background: '#f7f3ea' }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: BIZ.ink }}>{onCommission ? 'Due today' : 'Monthly total'}</span>
                          <span style={{ fontSize: 26, fontWeight: 800, color: BIZ.green }}>₹{price.monthlyTotal.toLocaleString('en-IN')}</span>
                        </div>
                      </div>

                      {onCommission ? (
                        <>
                          {/* No payment on this plan — so this card and its checkbox
                              are where the commission term is stated and accepted. */}
                          <div style={{ marginTop: 20, background: BIZ.chipBg, border: `1px solid #cfe8dc`, borderRadius: 18, padding: '20px 22px' }}>
                            <div style={{ fontSize: 17, fontWeight: 800, color: BIZ.ink }}>
                              No monthly fee · {commissionPct}% of {verticalObj.commissionBasis}
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
                                I agree to pay {commissionPct}% of {verticalObj.commissionBasis} on business that comes through Sehatsandhi.
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
