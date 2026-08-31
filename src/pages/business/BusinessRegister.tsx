import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useServiceAreas } from '../../hooks/useServiceAreas'
import { WA_NUMBER, SPECIALITIES } from '../../types'
import { BIZ, VERTICALS, VerticalKey, FALLBACK_AREAS, verticalFor, hasPractitioners } from './shared'
import { RegistrySearch } from './RegistrySearch'
import { PlacesSearch } from './PlacesSearch'
import { placesConfigured, guessSpeciality } from '../../lib/placesLookup'
import { searchClinicsByName, searchDoctorsByName } from '../../lib/registryLookup'
import VerticalIcon from './VerticalIcon'
import SandboxAutofill from '../../components/SandboxAutofill'
import SiteFooter from '../../components/SiteFooter'
import { generateBusiness } from '../../lib/sandboxData'
import {
  computePrice, createRazorpayOrder, verifyRazorpayPayment,
  loadRazorpayCheckout, businessBackendConfigured, listCareModules,
  PriceResult, DraftPractitioner, CareModule,
} from '../../lib/businessApi'
import { registerBusiness, registerPractitioner, attachPractitioner } from '../../lib/identityApi'
import { isValidEmail, isValidPhone, isValidRegNumber } from '../../lib/credentials'
import PractitionerPicker from './PractitionerPicker'
import { usePricing, monthlyAppliesTo, commissionFor, localMonthlyTotal } from '../../hooks/usePricing'
import { useTaxSettings, localTax, isValidGstin, GST_STATE_NAMES } from '../../hooks/useTaxSettings'
import { track } from '../../lib/analytics'
// Same file the pricing engine uses, so the quote here and the amount charged
// cannot describe different models.
import { headcountFor, applyHeadcount, describeDoctorRate } from '../../../supabase/functions/_shared/headcount'
import { money, num } from '../../lib/format'

// Design 2b — 3-step onboarding wizard.
// Layout: desktop = dark left step-rail + content pane; tablet (<900px) =
// horizontal stepper on top, content below.
//
// Coverage is not a step. Every listing is sold every service area we run in
// (see the effect that fills `zips`), so the wizard is: what you are → who you
// are → pay. The pincodes still travel with the quote and the order because
// they are what the price is computed from — they are simply no longer a
// question, since under a flat plan the answer never changed the total.
//
// Pricing is authoritative from the server: step 3 sends those pincodes to the
// compute-price Edge Function and shows what it returns. If the backend isn't
// configured (fresh dev), it falls back to summing the local list so the UI
// still works. Step 3 also pays via Razorpay, whose amount the server recomputes.
//
// Two billing models, decided by the step-1 vertical (see shared.ts):
//   • pincode_monthly (doctors, hospitals, labs) — pay per pincode per month,
//     Razorpay at step 3.
//   • commission (pharmacy, insurance, ambulance) — free to list, 10% of
//     billing. Step 3 takes no payment and asks the business to accept the
//     commission term instead.

const font = "'Manrope','Noto Sans Devanagari',system-ui,sans-serif"

// What a doctor may pick. LAB and PHRM are excluded deliberately: they are
// separate verticals with their own signup and their own billing, and choosing
// one here would bill a doctor as a diagnostics centre.
const DOCTOR_SPECIALITIES = SPECIALITIES.filter(s => s.id !== 'LAB' && s.id !== 'PHARMACY')

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

/** Which door they came in by. 'doctor' registers a person and gives them a
 *  listing of their own; 'business' registers the establishment and attaches
 *  whichever doctors work there. */
export type RegisterMode = 'business' | 'doctor'

interface RazorpayResponse {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export default function BusinessRegister({ mode = 'business' }: { mode?: RegisterMode }) {
  const { areas } = useServiceAreas()
  const soloDoctor = mode === 'doctor'
  const [step, setStep] = useState(mode === 'doctor' ? 2 : 1)
  // A doctor registering themselves is a clinic of one: they still need a
  // listing to be found and billed through, so the vertical is fixed rather
  // than asked for.
  const [vertical, setVertical] = useState<VerticalKey>('clinic')
  const [form, setForm] = useState<Record<string, string>>({})
  const [zips, setZips] = useState<string[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [paid, setPaid] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  // The doctors who work here. Each is either a person already on the platform
  // (attached, not copied) or a new one; the picker decides which, and
  // saveRegistration below links them either way.
  const [practitioners, setPractitioners] = useState<DraftPractitioner[]>([])
  const [invoiceToken, setInvoiceToken] = useState<string | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)

  // The live pricing plan. Everything below asks the plan how to price rather
  // than assuming per-pincode tiers, so switching plans in admin changes the
  // wizard with no deploy.
  const { plan, tiers, verticals: vbRows, terms } = usePricing()
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

  // The term they are buying.
  //
  // 0060 pinned this to a constant 1 and said a longer term would be "three
  // numbers in pricing_plans and this line". It turned out to need a table too —
  // ₹10,000 for twelve months is not ₹1,000 × 12 — so terms now carry their own
  // price and this is a choice again. See migration 0082.
  //
  // A plan with no terms keeps the old behaviour exactly: termChoices is empty,
  // no picker is drawn, and months falls back to the plan's default.
  const termChoices = terms
  const [months, setMonths] = useState<number>(plan.default_months || 1)

  // The plan loads after the first render, so the default has to follow it.
  // Only ever snaps to a term that exists — never leaves a stale 1 selected on
  // a plan whose shortest term is 6, which would ask the server to price a term
  // it does not sell.
  useEffect(() => {
    if (!termChoices.length) { setMonths(plan.default_months || 1); return }
    setMonths(prev => termChoices.some(t => t.months === prev)
      ? prev
      : (termChoices.find(t => t.months === plan.default_months) ?? termChoices[0]).months)
  }, [termChoices, plan.default_months])

  const selectedTerm = termChoices.find(t => t.months === months) ?? null

  // Auto-renewal, ticked by default as asked. Unticking it here means no mandate
  // is ever taken and the business is reminded to pay instead — 15 days out, by
  // email and on WhatsApp (migration 0083).
  const [autoRenew, setAutoRenew] = useState(true)

  // The clinical systems on offer, and which ones they have ticked. Priced by
  // the server from care_modules — this list is for drawing the choice, never
  // for deciding an amount.
  const [careModules, setCareModules] = useState<CareModule[]>([])
  const [modules, setModules] = useState<string[]>([])
  useEffect(() => { listCareModules().then(setCareModules).catch(() => setCareModules([])) }, [])

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

  // Coverage is no longer asked for. Every business is listed across every
  // service area we run in, and this keeps that in step with `coverage` as the
  // live service_areas load in.
  //
  // Nothing is lost by not asking: the live plans are flat_all_pincodes, where
  // the price is the same whether they pick one area or all of them, so the
  // step only ever cost them reach. It is also not a free choice to skip under
  // a per-pincode plan — see the guard on `zips` below, which is why this sets
  // the full list rather than the wizard quietly billing for it.
  useEffect(() => {
    setZips(coverage.map(z => z.pin_code))
  }, [coverage])

  // Counted in one place: the local quote, the server quote and the re-quote
  // effect must all agree on how many consultants have been entered.
  const namedHospitalDoctors = practitioners.filter(d => d.name.trim()).length

  // ── Live pricing: prefer the server (authoritative); fall back to a local
  //    sum when the backend isn't configured or is unreachable. ──
  const localPrice: PriceResult = useMemo(() => {
    const chosen = coverage.filter(z => zips.includes(z.pin_code))
    // Consultants beyond the plan's included headcount. Mirrors the server so
    // the number on screen matches what Razorpay is asked for.
    const namedDoctors = namedHospitalDoctors
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
      // A priced term is charged as written; only a plan without one falls back
      // to the monthly arithmetic. Mirrors computePrice on the server, which
      // remains the authority for what is actually taken.
      monthlyTotal, months,
      total: selectedTerm ? selectedTerm.price : monthlyTotal * months,
      termPrice: selectedTerm ? selectedTerm.price : null,
      modules: [], moduleTotal: 0,
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
      tax: localTax(selectedTerm ? selectedTerm.price : monthlyTotal * months, tax, form.gstin),
      priceIncludesGst: plan.price_includes_gst ?? false,
    }
  }, [coverage, zips, plan, tiers, months, selectedTerm, monthlyApplies, commission, tax, form.gstin, vertical, practitioners])

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
        // Without this the server counts zero consultants — there is no listing
        // yet — and its answer overrides the local one that does count them. A
        // hospital saw one doctor's price and would have been charged for all of
        // them at checkout, where the real doctorId is finally passed.
        const res = await computePrice(zips, null, vertical, months, namedHospitalDoctors, modules)
        if (id === priceReq.current) setServerPrice(res)
      } catch {
        if (id === priceReq.current) setServerPrice(null) // fall back to localPrice
      } finally {
        if (id === priceReq.current) setPricing(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [zips, vertical, months, namedHospitalDoctors, modules])

  // What the summary shows: server total when we have one, else the local sum.
  const price = serverPrice ?? localPrice

  // ── Step validation ──
  const stepValid = (s: number): boolean => {
    if (s === 1) return !!vertical
    // A doctor without a speciality is unsearchable — patients match on it
    // exactly — so it is required rather than defaulted to something wrong.
    // The doctor path needs the person's own name and speciality: they become
    // a practitioner row, and a doctor with neither is unsearchable.
    // Email, phone, name — and a registration number for anyone who will be
    // listed as a doctor. These are what sehat_register_business_with_doctors
    // requires since 0079, checked here so the refusal arrives before the
    // submit rather than after it.
    if (s === 2) return !!(form.business_name?.trim()
      && isValidPhone(form.phone)
      && isValidEmail(form.email)
      && (!soloDoctor || (form.speciality && form.owner_name?.trim()
                          && isValidRegNumber(form.reg_number))))
    return true
  }
  const nextStep = () => {
    if (!stepValid(step)) {
      setError(step === 2
        ? (!form.business_name?.trim()
            ? 'Please enter the name of your clinic or practice.'
            : !isValidPhone(form.phone)
              ? 'Please enter a 10-digit mobile number.'
              : !isValidEmail(form.email)
                ? 'Please enter an email address — it is how you will sign in.'
                : soloDoctor && !form.speciality
                  ? 'Please choose a speciality — it is how patients find you.'
                  : soloDoctor && !form.owner_name?.trim()
                    ? 'Please enter your name — it is what patients see.'
                    : 'Please enter your council registration number.')
        : 'Please complete this step.')
      return
    }
    setError('')
    setStep(s => Math.min(3, s + 1))
  }
  const prevStep = () => { setError(''); setStep(s => Math.max(soloDoctor ? 2 : 1, s - 1)) }
  const goStep = (n: number) => {
    // allow jumping back freely, and forward only through validated steps
    if (n <= step || [1, 2].slice(0, n - 1).every(stepValid)) { setError(''); setStep(n) }
  }

  // ── Sandbox autofill ──
  // Keeps the tester's chosen `vertical`: it decides whether step 3 ends at
  // Razorpay or at the WhatsApp commission path, so overwriting it would take
  // away control of which branch is under test.
  //
  // Pincodes are deliberately not touched. They used to be seeded here with the
  // two most expensive areas, back when a tester had to pick them by hand; now
  // every signup carries the full `coverage` list, so seeding a smaller set
  // would test a combination no real business can produce.
  const fillSandbox = () => {
    const { form: generated } = generateBusiness(vertical)
    setForm(generated)
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

  const businessIdRef = useRef<string | null>(null)

  /**
   * Save the business, its doctors, and the links between them.
   *
   * One path for every vertical. There used to be two — create_listing for
   * everyone and sehat_create_hospital for hospitals — and they disagreed about
   * what a doctor was: a hospital's consultants became listings of their own,
   * while a clinic's doctors became staff rows with no identity. That fork is
   * why the same doctor could exist twice and belong to neither place properly.
   *
   * All of it goes through SECURITY DEFINER RPCs rather than direct inserts,
   * because a just-created row is 'pending' and therefore invisible to its own
   * creator under the public read policy — a plain insert cannot even read back
   * the id it just made. See migration 0002 for the original diagnosis.
   */
  const saveRegistration = async (): Promise<string | null> => {
    if (businessIdRef.current) return businessIdRef.current

    // A doctor registering themselves is a person AND a one-doctor practice.
    // They need both rows: the business is what patients book and what we bill,
    // the practitioner is what makes them findable as a cardiologist — and it is
    // what lets them later be attached to a hospital they visit without any of
    // this being redone.
    const toAttach: DraftPractitioner[] = soloDoctor
      ? [{
          name: form.owner_name?.trim() || form.business_name?.trim() || 'Doctor',
          speciality: form.speciality || 'GEN',
          qualification: form.qualification || undefined,
          reg_number: form.reg_number || undefined,
          smc_id: form.smc_id ? Number(form.smc_id) : undefined,
          phone: form.phone || undefined,
          // A solo doctor is one person with one login: the same address on the
          // business row and the practitioner row. 0079 allows exactly that
          // pair and rejects any other repeat.
          email: form.email || undefined,
        }]
      : practitioners

    try {
      // One call, one transaction. Attaching is an owner-only operation and
      // nobody has logged in yet at signup, so the business and its doctors have
      // to be created together — split up, the link silently did not happen and
      // a registered doctor was missing from search.
      const businessId = await registerBusiness({
        name: form.business_name || form.owner_name || verticalObj.label,
        vertical,
        address: form.address || '',
        pinCodes: zips,
        phone: form.phone || '',
        email: form.email || '',
        // The BUSINESS's licence — a pharmacy's drug licence, a hospital's
        // registration. A doctor's own registration belongs to them and travels
        // with them, so on the solo path it goes to the practitioner instead.
        regNumber: soloDoctor ? null : (form.reg_number || null),
        workingHours: form.working_hours || null,
        placeId: form.place_id || null,
        // Recorded now, at signup, because there is no session yet to call the
        // owner-only sehat_set_auto_renew() with — see migration 0084.
        autoRenew,
        // Where the business IS, as opposed to `pinCodes` above, which is
        // everywhere it is sold. See migration 0094.
        ownPinCode: form.own_pin_code || null,
        ownCity: form.own_city || null,
        ownDistrict: form.own_district || null,
        ownState: form.own_state || null,
      }, toAttach.map((d, i) => ({
        practitioner_id: d.practitioner_id,
        name: d.name,
        speciality: d.speciality,
        qualification: d.qualification,
        reg_number: d.reg_number,
        smc_id: d.smc_id,
        phone: d.phone,
        // Was missing entirely until 0079: the wizard asked for it, the payload
        // dropped it, and the column was never written. It is how they sign in.
        email: d.email,
        consultation_fee: d.consultation_fee ?? 0,
        // A doctor registering their own practice is primarily there. Somebody a
        // clinic added may already be primary elsewhere, and the server leaves
        // that alone.
        is_primary: soloDoctor && i === 0,
      })))

      businessIdRef.current = businessId
      return businessId
    } catch (e) {
      setError(`Could not save: ${(e as Error).message}`)
      return null
    }
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
    const id = await saveRegistration()
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
      const id = await saveRegistration()
      if (!id) { setSubmitting(false); return }
      // A wrong GSTIN produces an invoice they cannot claim against, and it is
      // not correctable afterwards without a credit note. Stop here instead.
      if (gstinState === 'bad' || gstinState === 'partial') {
        setError('Please correct your GST number, or clear the field if you are not registered.')
        setSubmitting(false)
        return
      }
      const order = await createRazorpayOrder(zips, id, months, modules, {
        gstin: gstinState === 'ok' ? form.gstin : undefined,
        gstLegalName: form.gst_legal_name || undefined,
        billingAddress: form.address || undefined,
      })
      await loadRazorpayCheckout()
      const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay
      const rzp = new Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency,
        order_id: order.orderId, name: 'Sehatsandhi Business',
        description: [verticalObj.label, `${zips.length} pincode${zips.length === 1 ? '' : 's'}`,
          ...modules.map(c => careModules.find(m => m.code === c)?.label ?? c), 'monthly'].join(' · '),
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

  // The doctor path skips the vertical picker: they are a doctor, and asking
  // whether they are an ambulance service is noise. Numbering stays 2/3 so the
  // step bodies below need no special casing.
  const RAIL_STEPS = soloDoctor
    ? [
        { n: 2, label: 'Your details' },
        { n: 3, label: onCommission ? 'Review & activate' : 'Review & pay' },
      ]
    : [
        { n: 1, label: 'Service type' },
        { n: 2, label: 'Business details' },
        { n: 3, label: onCommission ? 'Review & activate' : 'Review & pay' },
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
                aria-label={`Step ${s.n} of ${RAIL_STEPS.length}: ${s.label}`}
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
          <span style={{ fontSize: 13, fontWeight: 700, color: '#9fb3aa', flex: '0 0 auto', marginLeft: 'auto' }}>{step}/{RAIL_STEPS.length}</span>
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
                    {/* A plain link now: the new tab is the same build, so it
                        resolves the same backend. This used to need ?env= to
                        carry the choice across the tab boundary. */}
                    <a href={`/invoice/${invoiceToken}`}
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
                      <StepKicker n={RAIL_STEPS.findIndex(r => r.n === 1) + 1} of={RAIL_STEPS.length} />
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
                      <StepKicker n={RAIL_STEPS.findIndex(r => r.n === 2) + 1} of={RAIL_STEPS.length} />
                      <h3 style={h3Style}>{soloDoctor ? 'Tell us about yourself' : 'Tell us about your business'}</h3>
                      <p style={pStyle}>
                        {soloDoctor
                          ? <>Your own practice. If you also consult at a hospital, you can add that from your dashboard once you are set up.</>
                          : <>Listing as <strong style={{ color: BIZ.green }}>{verticalObj.label}</strong>. This is what patients will see.</>}
                      </p>
                      <div className="grid gap-[18px] grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                        {/* Google Places when it is configured, the clinic
                            directory when it is not. Places wins where it can:
                            it is current, and it carries the phone number and
                            opening hours that the government directory simply
                            does not have — 1,655 addresses and not one phone.
                            The fallback is not a lesser feature so much as the
                            thing that keeps signup working if the key is missing
                            or Google is unreachable. */}
                        {placesConfigured() ? (
                          <PlacesSearch
                            label={soloDoctor ? 'Clinic / practice name *' : 'Business name *'}
                            placeholder="Start typing — e.g. Garg ENT"
                            hint={soloDoctor
                              ? 'Your clinic — pick it and we will fill in the address.'
                              : 'Pick your clinic and we will fill in the rest.'}
                            value={form.business_name ?? ''}
                            onChange={v => upd('business_name', v)}
                            onPick={d => {
                              upd('business_name', d.name)
                              upd('address', d.address)
                              upd('place_id', d.placeId)
                              // Where the business IS. Google already returned
                              // these and the wizard used to drop them, which
                              // is why every listing was filed at the front of
                              // its coverage array — see migration 0094.
                              if (d.pincode) upd('own_pin_code', d.pincode)
                              if (d.city) upd('own_city', d.city)
                              if (d.district) upd('own_district', d.district)
                              if (d.state) upd('own_state', d.state)
                              // Suggested, not assumed: the number Google lists
                              // is often a reception landline, and this field is
                              // the WhatsApp number we send login codes to.
                              if (d.phone && !form.phone) upd('phone', d.phone)
                              if (d.hours?.length) upd('working_hours', d.hours.join('; '))
                              // Clinics here name themselves after what they do —
                              // "SN Eye Hospital", "Garg ENT" — which is a better
                              // signal than Places' own category, where an eye
                              // hospital and a maternity home are both 'hospital'.
                              // Only ever a preselection; the dropdown is right
                              // there and they change it if this guessed wrong.
                              if (!form.speciality) {
                                const guess = guessSpeciality(d.name)
                                if (guess) upd('speciality', guess)
                              }
                            }}
                          />
                        ) : (
                        <RegistrySearch
                          label={soloDoctor ? 'Clinic / practice name *' : 'Business name *'}
                          placeholder="e.g. Aggarwal Eye Care"
                          hint="Type a few letters and press Find — we may already have your address."
                          value={form.business_name ?? ''}
                          onChange={v => upd('business_name', v)}
                          onSearch={async q => {
                            const found = await searchClinicsByName(q)
                            return found.map(c => ({
                              ...c,
                              title: c.name,
                              subtitle: [c.address, c.pincode].filter(Boolean).join(' — ') || 'No address on record',
                            }))
                          }}
                          onPick={c => {
                            upd('business_name', c.name)
                            if (c.address) upd('address', c.address)
                          }}
                          emptyNote="No match — just carry on and type your details."
                        />
                        )}
                        <Field
                          label={soloDoctor ? 'Your full name *' : 'Owner / contact name'}
                          placeholder="e.g. Dr. Ramesh Aggarwal"
                          value={form.owner_name} onChange={v => upd('owner_name', v)} />
                        <Field label="WhatsApp number *" placeholder="+91 " value={form.phone} onChange={v => upd('phone', v)} type="tel" inputMode="tel" autoComplete="tel" />
                        {/* The speciality of the DOCTOR registering, which is
                            what patients match on. Only asked on the doctor
                            path: a clinic does not have a speciality, the
                            doctors who work there do — and they are added
                            through the picker below. */}
                        {soloDoctor ? (
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
                        {/* Doctors search the Indian Medical Register by name and
                            get their own registration number back, which is
                            easier than finding the certificate. A business types
                            its own licence number, which we cannot check. */}
                        {soloDoctor ? (
                          <RegistrySearch
                            label="Find your registration"
                            placeholder="Your name, as registered"
                            hint="Search the medical register by name — or leave this blank."
                            value={form.doctor_search ?? ''}
                            onChange={v => upd('doctor_search', v)}
                            onSearch={async q => {
                              const found = await searchDoctorsByName(q)
                              return found.map(d => ({
                                ...d,
                                title: d.name,
                                subtitle: `${d.council} · Reg ${d.regNo}${d.year ? ` · ${d.year}` : ''}`,
                              }))
                            }}
                            onPick={d => {
                              upd('reg_number', d.regNo)
                              upd('smc_id', String(d.smcId))
                              upd('doctor_search', d.name)
                            }}
                            emptyNote="Not found — type it in the box below instead."
                          />
                        ) : (
                          <Field label="Registration number *" placeholder="e.g. HR-12345" value={form.reg_number} onChange={v => upd('reg_number', v)} />
                        )}
                        {/* The register is not complete — it has nobody who
                            qualified in the last few months, and the search only
                            matches how a council chose to spell someone. Typing
                            the number has to stay possible. */}
                        {soloDoctor && (
                          <Field label="Registration number"
                            placeholder={form.reg_number ? '' : 'or type it — e.g. HR-12345'}
                            value={form.reg_number} onChange={v => upd('reg_number', v)} />
                        )}
                        <Field label="Email *" placeholder="you@example.com" value={form.email} onChange={v => upd('email', v)} type="email" inputMode="email" autoComplete="email" />
                        <p className="text-xs text-gray-500 -mt-2">
                          This is your sign-in, and where your login code is sent. One account per address.
                        </p>
                        <div className="sm:col-span-2 xl:col-span-3">
                          {/* Also a lookup, in address mode rather than business
                              mode. Picking the clinic by name fills this in, but
                              two cases leave it to be typed: a clinic with no
                              Google listing of its own, and one whose listed
                              address is out of date. Both are the moment someone
                              is typing a street name into a phone, which is
                              exactly when suggestions help most.
                              A street always exists in Places even when the
                              business on it does not, so this finds things the
                              name search cannot. */}
                          {placesConfigured() ? (
                            <PlacesSearch
                              mode="address"
                              label="Full address"
                              placeholder="Start typing — e.g. Model Town, Yamunanagar"
                              hint="Pick the nearest street or locality, then add your shop or building number."
                              value={form.address ?? ''}
                              onChange={v => upd('address', v)}
                              onPick={d => {
                                upd('address', d.address)
                                // The address search returns the same components
                                // the business search does; taking them here too
                                // means a clinic that typed its own name still
                                // gets filed in the right town.
                                if (d.pincode) upd('own_pin_code', d.pincode)
                                if (d.city) upd('own_city', d.city)
                                if (d.district) upd('own_district', d.district)
                                if (d.state) upd('own_state', d.state)
                              }}
                            />
                          ) : (
                            <Field label="Full address" placeholder="Shop / building, area, city" value={form.address} onChange={v => upd('address', v)} />
                          )}

                          {/* Where the business IS. Google fills these in when
                              they picked themselves from the search; this is
                              for everyone else, and for correcting it.
                              NOT required — a signup that fails because
                              somebody does not know their own pincode costs
                              more than a blank column, and admin can fix it.
                              Coverage is unaffected: the plan still sells every
                              area, this is only the branch's own address. */}
                          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginTop: 12 }}>
                            <Field label="Your pincode" placeholder="e.g. 411005" inputMode="numeric"
                              value={form.own_pin_code} onChange={v => upd('own_pin_code', v.replace(/\D/g, '').slice(0, 6))} />
                            <Field label="Town / city" placeholder="e.g. Pune"
                              value={form.own_city} onChange={v => upd('own_city', v)} />
                            <Field label="State" placeholder="e.g. Maharashtra"
                              value={form.own_state} onChange={v => upd('own_state', v)} />
                          </div>
                          <p style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 8, lineHeight: 1.6 }}>
                            We list businesses across India. This is where you are —
                            separate from the areas your listing reaches, which the plan covers in full.
                          </p>
                        </div>
                      </div>

                      {/* The doctors who work here.
                          This used to exist only for hospitals, because only a
                          hospital's consultants became rows of their own — a
                          clinic's doctors had nowhere to go. Both are the same
                          thing now, so a clinic can name its doctors too, and
                          either can attach somebody who already works elsewhere
                          instead of creating a second copy of them. */}
                      {hasPractitioners(vertical) && !soloDoctor && (
                        <div style={{ marginTop: 28, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: '20px 22px' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: BIZ.ink, marginBottom: 4 }}>
                            Your doctors
                          </div>
                          <p style={{ fontSize: 13.5, color: BIZ.muted, margin: '0 0 16px', lineHeight: 1.6 }}>
                            Add each doctor who sees patients here. Every one gets their own profile, so a
                            patient searching for a cardiologist in your area finds them by name.
                            {describeDoctorRate(plan) && <> {describeDoctorRate(plan)}</>}
                          </p>

                          <PractitionerPicker
                            added={practitioners}
                            onAdd={d => setPractitioners(list => [...list, d])}
                            onRemove={i => setPractitioners(list => list.filter((_, j) => j !== i))}
                            clinicPhone={form.phone}
                          />

                          {namedHospitalDoctors > 0 && (
                            <div style={{ marginTop: 14, fontSize: 13.5, color: BIZ.ink }}>
                              <strong>{namedHospitalDoctors}</strong> doctor
                              {namedHospitalDoctors === 1 ? '' : 's'} added
                              {price.doctorBilling === 'per_doctor' && price.doctorMultiplier > 1 && (
                                <span style={{ color: BIZ.mutedWarm }}>
                                  {' '}· {price.doctorMultiplier} × {money((plan.monthly_price ?? 0))}
                                  {' '}= <strong style={{ color: BIZ.ink }}>{money(price.monthlyTotal)}/month</strong>
                                </span>
                              )}
                              {price.extraDoctors > 0 && (
                                <span style={{ color: BIZ.mutedWarm }}>
                                  {' '}· {price.extraDoctors} beyond the {price.includedDoctors} included
                                  {' '}= <strong style={{ color: BIZ.ink }}>+{money(price.extraDoctorCost)}/month</strong>
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
                      <StepKicker n={RAIL_STEPS.findIndex(r => r.n === 3) + 1} of={RAIL_STEPS.length} />
                      <h3 style={h3Style}>{onCommission ? 'Review & activate' : 'Review & pay'}</h3>
                      <p style={pStyle}>Confirm your listing. Your team can adjust coverage later on WhatsApp.</p>
                      <div style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, overflow: 'hidden' }}>
                        <ReviewRow label="Service type" value={verticalObj.label} />
                        <ReviewRow label="Business name" value={form.business_name || form.owner_name || '—'} />
                        {/* Coverage was never asked for, so it is stated rather
                            than described as a selection — this is the only
                            place a business sees how wide their listing runs
                            before they pay for it. */}
                        <ReviewRow label="Areas covered" value={`All ${price.count} service area${price.count === 1 ? '' : 's'}`} />
                        <ReviewRow label="Total reach" value={`${num(price.residents)} residents`} />
                        {onCommission
                          ? <ReviewRow label="Plan" value={`${commissionPct}% of ${commissionBasis}`} />
                          : <ReviewRow label="Plan" value={flatPlan ? plan.label : (price.topTier?.tier_name ?? '—')} />}
                        {!onCommission && (
                          <>
                            <ReviewRow label="Monthly price" value={`${money(price.monthlyTotal)}/mo`} />
                            {(price.moduleTotal ?? 0) > 0 && (
                              <ReviewRow
                                label="Systems included"
                                value={(price.modules ?? []).map(m => `${m.label} ${money(m.monthly_price)}`).join(' · ')}
                              />
                            )}
                          </>
                        )}
                        {!onCommission && price.tax?.applied && (
                          <>
                            <ReviewRow label="Taxable value" value={`${money(price.total)}`} />
                            {price.tax.interState
                              ? <ReviewRow label={`IGST @ ${price.tax.rate}%`} value={`${money(price.tax.igst)}`} />
                              : <>
                                  <ReviewRow label={`CGST @ ${price.tax.rate / 2}%`} value={`${money(price.tax.cgst)}`} />
                                  <ReviewRow label={`SGST @ ${price.tax.rate / 2}%`} value={`${money(price.tax.sgst)}`} />
                                </>}
                          </>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 22px', background: '#f7f3ea' }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: BIZ.ink }}>Due today</span>
                          <span style={{ fontSize: 26, fontWeight: 800, color: BIZ.green }}>
                            {money((onCommission ? 0 : (price.tax?.applied ? price.tax.grandTotal : price.total)))}
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
                            You can then claim the {money((price.tax?.taxTotal ?? 0))} GST back as
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

                      {/* The term. Drawn only when the plan actually prices terms
                          (migration 0082); a monthly plan shows nothing here and
                          behaves exactly as it did before. Prices come from
                          plan_terms and are totals for the whole term, never a
                          monthly rate to be multiplied. */}
                      {!onCommission && termChoices.length > 0 && (
                        <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: '20px 22px' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink, marginBottom: 4 }}>
                            How long would you like to pay for?
                          </div>
                          <p style={{ fontSize: 13, color: BIZ.muted, margin: '0 0 14px', lineHeight: 1.6 }}>
                            Introductory pricing. Paid once, upfront, for the whole term.
                          </p>
                          <div style={{ display: 'grid', gap: 10 }}>
                            {termChoices.map(t => {
                              const on = t.months === months
                              return (
                                <label key={t.months} style={{
                                  display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
                                  padding: '13px 15px', borderRadius: 13,
                                  border: `2px solid ${on ? BIZ.green : '#e9e2d5'}`,
                                  background: on ? '#f3faf6' : '#fff',
                                }}>
                                  <input
                                    type="radio"
                                    name="plan-term"
                                    checked={on}
                                    onChange={() => setMonths(t.months)}
                                    style={{ width: 18, height: 18, marginTop: 2, accentColor: BIZ.green, cursor: 'pointer' }}
                                  />
                                  <span style={{ flex: 1 }}>
                                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                      <strong style={{ fontSize: 14.5, color: BIZ.ink }}>{t.label ?? `${t.months} months`}</strong>
                                      <strong style={{ fontSize: 14.5, color: on ? BIZ.green : BIZ.ink, whiteSpace: 'nowrap' }}>
                                        {money(t.price)}
                                      </strong>
                                    </span>
                                    {/* These prices are quoted EX-GST, so the figure
                                        above is not what leaves their account. Saying
                                        so on the option itself — not only in the review
                                        rows further down — is the difference between an
                                        offer and a surprise on the statement. Uses the
                                        same localTax() the quote and the invoice use, so
                                        the three cannot disagree. */}
                                    {(() => {
                                      const tt = localTax(t.price, tax, form.gstin)
                                      return tt.applied ? (
                                        <span style={{ display: 'block', fontSize: 12.5, color: BIZ.muted, marginTop: 3 }}>
                                          + {tt.rate}% GST · {money(tt.grandTotal)} payable today
                                        </span>
                                      ) : null
                                    })()}
                                    {t.savings_note && (
                                      <span style={{ display: 'block', fontSize: 12.5, color: BIZ.green, fontWeight: 700, marginTop: 3 }}>
                                        {t.savings_note}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Clinical systems. Bought per month per business and
                          switched on the moment the payment clears — 0060.
                          NOT multiplied by consultant headcount: a ward system
                          is one system whoever is using it. */}
                      {!onCommission && careModules.length > 0 && (
                        <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: '20px 22px' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink, marginBottom: 4 }}>
                            Which systems do you want? <span style={{ color: BIZ.green }}>Free</span>
                          </div>
                          <p style={{ fontSize: 13, color: BIZ.muted, margin: '0 0 14px', lineHeight: 1.6 }}>
                            Included free with your plan. Tick what you want and it is switched on
                            in your dashboard as soon as this payment clears — you can change your mind later.
                          </p>
                          <div style={{ display: 'grid', gap: 10 }}>
                            {careModules.map(m => {
                              const on = modules.includes(m.code)
                              return (
                                <label key={m.code} style={{
                                  display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
                                  padding: '13px 15px', borderRadius: 13,
                                  border: `2px solid ${on ? BIZ.green : '#e9e2d5'}`,
                                  background: on ? '#f3faf6' : '#fff',
                                }}>
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => setModules(prev =>
                                      prev.includes(m.code) ? prev.filter(c => c !== m.code) : [...prev, m.code])}
                                    style={{ width: 18, height: 18, marginTop: 2, accentColor: BIZ.green, cursor: 'pointer' }}
                                  />
                                  <span style={{ flex: 1 }}>
                                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                      <strong style={{ fontSize: 14.5, color: BIZ.ink }}>{m.label}</strong>
                                      <strong style={{ fontSize: 14.5, color: on ? BIZ.green : BIZ.ink, whiteSpace: 'nowrap' }}>
                                        {m.monthly_price > 0 ? `${money(m.monthly_price)}/mo` : 'Free'}
                                      </strong>
                                    </span>
                                    {m.description && (
                                      <span style={{ display: 'block', fontSize: 12.5, color: BIZ.muted, marginTop: 3, lineHeight: 1.55 }}>
                                        {m.description}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              )
                            })}
                          </div>

                          {/* The arithmetic, spelled out. With GST on, the
                              monthly total is the taxable value and not the
                              amount charged — one "=" across both would be
                              wrong by the tax. */}
                          <div style={{ fontSize: 13, color: BIZ.mutedWarm, marginTop: 13, lineHeight: 1.7, borderTop: `1px solid ${BIZ.border}`, paddingTop: 11 }}>
                            Listing {money(price.monthlyTotal - (price.moduleTotal ?? 0))}
                            {(price.moduleTotal ?? 0) > 0 && <> + systems {money(price.moduleTotal ?? 0)}</>}
                            {' = '}{money(price.monthlyTotal)} a month
                            {price.tax?.applied && <> + {price.tax.rate}% GST {money(price.tax.taxTotal)}</>}
                            <br />
                            <strong style={{ color: BIZ.ink, fontSize: 15 }}>
                              {money((price.tax?.applied ? price.tax.grandTotal : price.monthlyTotal))}
                            </strong> payable today, then monthly
                          </div>
                        </div>
                      )}

                      {/* Auto-renewal. Ticked by default, as asked — which is only
                          defensible because unticking it is one click here and a
                          toggle in the dashboard afterwards. Unticked means no
                          mandate is taken at all and we remind them instead, by
                          email and on WhatsApp, 15 days before the term ends
                          (migration 0083). */}
                      {!onCommission && (
                        <div style={{ marginTop: 20, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: '20px 22px' }}>
                          <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={autoRenew}
                              onChange={e => setAutoRenew(e.target.checked)}
                              style={{ width: 18, height: 18, marginTop: 2, accentColor: BIZ.green, cursor: 'pointer' }}
                            />
                            <span style={{ flex: 1 }}>
                              <strong style={{ fontSize: 14.5, color: BIZ.ink, display: 'block' }}>
                                Renew automatically
                              </strong>
                              <span style={{ display: 'block', fontSize: 12.5, color: BIZ.muted, marginTop: 4, lineHeight: 1.6 }}>
                                {autoRenew
                                  ? `We will renew for another ${months} months at ${money(price.total)} plus GST when this term ends, and tell you before we charge. You can turn this off at any time from your dashboard.`
                                  : 'We will not charge you again. We will email and WhatsApp you 15 days before your plan ends so you can renew yourself.'}
                              </span>
                            </span>
                          </label>
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

      {/* Below the wizard, not inside it: this is the page that takes payment,
          so the refund policy and the entity being paid have to be reachable
          from it without leaving the flow. */}
      <SiteFooter />
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

function StepKicker({ n, of }: { n: number; of: number }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.mutedWarm, letterSpacing: '.06em' }}>STEP {n} OF {of}</div>
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

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '18px clamp(16px,4vw,22px)', borderBottom: '1px solid #f0ebe0' }}>
      <span style={{ fontSize: 14, color: BIZ.muted, flex: '0 0 auto' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}
