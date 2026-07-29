import { Link } from 'react-router-dom'
import SiteHeader, { HeaderLink, HeaderCta, shopIcon, PAGE } from '../../components/SiteHeader'
import { BIZ, VERTICALS } from './shared'
import VerticalIcon from './VerticalIcon'
import WhatsAppBotMock from './WhatsAppBotMock'
import ReachSnapshot from './ReachSnapshot'
import { usePricing, commissionFor, monthlyAppliesTo } from '../../hooks/usePricing'
import { useTaxSettings } from '../../hooks/useTaxSettings'

// Design 2a — "List your business" marketing landing, desktop-first, Warm Care look.
// Colors are the exact design values (kept off the site's teal/navy theme on purpose).
//
// Pricing is read live from the active plan, never hardcoded — switching plans in
// admin changes this page with no deploy. Under a flat plan it shows one price
// card; under tier pricing it shows the population grid. Commission verticals
// only get a commission block when a commission is actually being charged.

const font = "'Manrope','Noto Sans Devanagari',system-ui,sans-serif"

// What each category gets out of being listed. This is what the six separate
// /for-* marketing pages said; they are gone, and the Partners section below
// says it here instead. Keyed by VerticalKey so the cards stay in step with
// VERTICALS rather than being a second list that can drift from it.
const VERTICAL_TITLES: Record<string, string> = {
  doctors: 'Doctors & clinics', hospital: 'Hospitals', pharmacy: 'Pharmacies',
  lab: 'Diagnostic labs', insurance: 'Insurance agents', ambulance: 'Ambulance services',
}
const VERTICAL_BLURBS: Record<string, string> = {
  doctors: 'Patients in your pincodes find you on WhatsApp and book a time — no app for them to install, no call for you to miss.',
  hospital: 'Every consultant gets their own profile and calendar, under one hospital listing and one bill.',
  pharmacy: 'Prescriptions come straight to you from patients nearby, to fill in store or deliver home.',
  lab: 'Test bookings arrive with the patient details, and you can offer home sample collection.',
  insurance: 'Warm leads from families already looking for cover — not cold calling.',
  ambulance: 'Emergency and scheduled transport requests from your own area, the moment they are needed.',
}

export default function BusinessLanding() {
  const { plan, tiers, verticals } = usePricing()
  const tax = useTaxSettings()
  const flatPlan = plan.mode !== 'pincode_tiers'
  const flatPrice = plan.monthly_price ?? 0

  // Say on the card what the number does and does not include, so the figure
  // here and the figure at checkout are never a surprise to each other.
  const gstNote = !tax.enabled ? null
    : plan.price_includes_gst ? `incl. ${tax.rate}% GST`
    : `+ ${tax.rate}% GST`

  // Verticals actually paying a commission right now (empty while a flat plan
  // suspends it), and those on the monthly fee.
  const commissionRows = VERTICALS
    .map(v => ({ v, c: commissionFor(plan, verticals.find(r => r.vertical === v.key)) }))
    .filter(x => x.c.percent > 0)
  const monthlyVerticals = VERTICALS
    .filter(v => monthlyAppliesTo(plan, verticals.find(r => r.vertical === v.key)))

  const verticalNoun = (key: string) =>
    key === 'doctors' ? 'Doctors' : key === 'hospital' ? 'Hospitals'
      : key === 'pharmacy' ? 'Pharmacies' : key === 'lab' ? 'Labs'
        : key === 'insurance' ? 'Insurance agents' : 'Ambulance services'

  return (
    <div style={{ background: BIZ.cream, fontFamily: font }}>
      {/* Sticky, because every link but two is an anchor into this page:
          scrolling to Pricing and then wanting Partners should not mean
          scrolling back up. The logo goes home, to the patient side — it is how
          someone who followed a business link gets across. */}
      <SiteHeader sticky>
        <HeaderLink href="#how">How it works</HeaderLink>
        <HeaderLink href="#pricing">Pricing</HeaderLink>
        <HeaderLink href="#partners">Partners</HeaderLink>
        <HeaderLink to="/business/login">Log in</HeaderLink>
        <HeaderCta to="/business/register" icon={shopIcon}>List your business</HeaderCta>
      </SiteHeader>

      {/* hero */}
      <div className="mx-auto grid gap-10 items-center lg:grid-cols-[1.15fr_.85fr]" style={{ maxWidth: PAGE.maxWidth, padding: 'clamp(28px,7vw,56px) ' + PAGE.padX }}>
        <div>
          <div style={{ display: 'inline-block', background: BIZ.chipBg, color: BIZ.chipText, fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, marginBottom: 18 }}>Now live in Yamunanagar · rolling out across India</div>
          <h1 style={{ fontSize: 'clamp(30px,7.5vw,46px)', lineHeight: 1.1, fontWeight: 800, color: BIZ.ink, margin: '0 0 18px', letterSpacing: '-.03em' }}>Reach every patient in your pincodes.</h1>
          <p style={{ fontSize: 'clamp(16px,4vw,18px)', color: BIZ.muted, lineHeight: 1.55, margin: '0 0 28px', maxWidth: 520 }}>
            Doctors, hospitals, pharmacies, labs, insurers and ambulance services get discovered by families nearby — over WhatsApp &amp; SMS.
            {flatPlan
              ? ` Every pincode included for ₹${flatPrice.toLocaleString('en-IN')} a month.`
              : ' Choose your pincodes, pay only for the audience you reach.'}
          </p>
          {/* on phones the CTA goes full-width so it's an easy thumb target */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/business/register" className="max-sm:w-full max-sm:justify-center max-sm:flex" style={{ background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 16, padding: '15px 26px', borderRadius: 14, textAlign: 'center' }}>List your business — free to start</Link>
            <a href="#pricing" style={{ fontSize: 14, fontWeight: 700, color: BIZ.green }}>See pricing →</a>
          </div>
        </div>
        <ReachSnapshot />
      </div>

      {/* trust strip */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 'clamp(16px,5vw,48px)', padding: '20px clamp(16px,4vw,40px)', background: BIZ.creamAlt, borderTop: `1px solid ${BIZ.border}`, borderBottom: `1px solid ${BIZ.border}`, flexWrap: 'wrap', textAlign: 'center' }}>
        {['6 service categories',
          flatPlan ? `₹${flatPrice.toLocaleString('en-IN')}/month, all pincodes` : 'Pay by audience, not per click',
          'WhatsApp & SMS delivery', 'Villages to tier-1 cities'].map(s => (
          <span key={s} style={{ fontSize: 14, fontWeight: 700, color: '#3f4a44' }}>{s}</span>
        ))}
      </div>

      {/* how it works */}
      <div id="how" className="mx-auto" style={{ maxWidth: PAGE.maxWidth, padding: 'clamp(28px,7vw,56px) ' + PAGE.padX }}>
        <h2 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>How zipcode reach works</h2>
        <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 0 36px' }}>Three steps to start appearing for patients around you.</p>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { n: '1', t: 'Pick your pincodes', d: 'Select any number of pincodes — villages, towns or full cities — where you want patients to find you.' },
            { n: '2', t: 'We show you to those users', d: 'When a patient in your pincodes needs your category, you appear in their WhatsApp options.' },
            flatPlan
              ? { n: '3', t: 'One flat monthly price', d: `₹${flatPrice.toLocaleString('en-IN')} a month covers every pincode you pick, for as many months as you pay upfront.` }
              : { n: '3', t: 'Pay by audience size', d: 'Your fee scales with how many users live in your chosen pincodes. Bigger reach, higher premium.' },
          ].map(s => (
            <div key={s.n} style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: 'clamp(20px,5vw,26px)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: BIZ.green, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>{s.n}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: BIZ.ink, marginBottom: 8 }}>{s.t}</div>
              <div style={{ fontSize: 14, color: BIZ.muted, lineHeight: 1.55 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* verticals — this is what /partners used to be. That page was a second
          six-card grid of the same categories, one click further from signing
          up; these cards were the same six but inert. Merged: the cards carry
          the line that said what each vertical gets, and link to the page
          written for it. */}
      <div id="partners" className="mx-auto pb-10" style={{ maxWidth: PAGE.maxWidth, paddingLeft: PAGE.padX, paddingRight: PAGE.padX, scrollMarginTop: 90 }}>
        <h2 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>Who can list</h2>
        <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 0 28px' }}>
          Six kinds of business, and what each one gets out of being listed.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VERTICALS.map(v => (
            <div key={v.key}
              style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 16, padding: 20 }}>
              <span style={{ color: v.color, display: 'inline-flex' }}><VerticalIcon vertical={v.key} /></span>
              <div style={{ fontSize: 16, fontWeight: 800, color: BIZ.ink, marginTop: 10 }}>{VERTICAL_TITLES[v.key]}</div>
              <div style={{ fontSize: 14, color: BIZ.muted, marginTop: 6, lineHeight: 1.5 }}>{VERTICAL_BLURBS[v.key]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* pricing — two models: per-pincode monthly, or commission on billing */}
      <div id="pricing" className="mx-auto pb-14" style={{ maxWidth: PAGE.maxWidth, paddingLeft: PAGE.padX, paddingRight: PAGE.padX }}>
        <h2 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>
          {flatPlan ? plan.label : 'Pay for reach, not clicks'}
        </h2>
        <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 0 36px' }}>
          {plan.description
            ?? 'Every pincode has a monthly price set by its population tier. Your total is the sum of the pincodes you pick.'}
        </p>

        {flatPlan ? (
          /* ── Flat plan: one price card, not a tier grid ── */
          <>
            <div style={{ maxWidth: 560, margin: '0 auto' }}>
              <div style={{
                background: BIZ.green, borderRadius: 22, padding: 'clamp(26px,6vw,36px)',
                textAlign: 'center', boxShadow: '0 30px 60px -30px rgba(14,159,110,.6)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#d6f2e6' }}>
                  {plan.mode === 'flat_all_pincodes' ? 'All pincodes included' : 'Per pincode'}
                </div>
                <div style={{ fontSize: 'clamp(40px,11vw,60px)', fontWeight: 800, color: '#fff', letterSpacing: '-.03em', marginTop: 10, lineHeight: 1 }}>
                  ₹{flatPrice.toLocaleString('en-IN')}
                  <span style={{ fontSize: 'clamp(15px,4vw,18px)', fontWeight: 600, color: '#d6f2e6' }}>/month</span>
                  {gstNote && (
                    <span style={{ fontSize: 'clamp(13px,3.4vw,15px)', fontWeight: 600, color: '#d6f2e6' }}> {gstNote}</span>
                  )}
                </div>
                {plan.mode === 'flat_all_pincodes' && (
                  <div style={{ fontSize: 15, color: '#eafaf3', marginTop: 14, lineHeight: 1.6 }}>
                    Pick one pincode or twenty — the price is the same. Your fee does not go up as your reach does.
                  </div>
                )}
                {/* The term is the business's choice, so advertise the choice —
                    not a multi-month total they never agreed to. */}
                {plan.max_months > plan.min_months && (
                  <div style={{ display: 'inline-block', marginTop: 18, background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 14, fontWeight: 700, padding: '8px 14px', borderRadius: 999 }}>
                    Pay for as few as {plan.min_months} month{plan.min_months === 1 ? '' : 's'} — you choose the term
                  </div>
                )}
              </div>
            </div>
            <p style={{ fontSize: 13.5, color: BIZ.mutedWarm, textAlign: 'center', marginTop: 22, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
              Your rate is held for the months you pay for, so it will not change mid-term even when this offer ends.
              Choose any term from {plan.min_months} to {plan.max_months} months at checkout — you see the total before you pay.
              {gstNote && !plan.price_includes_gst && ` GST at ${tax.rate}% is added on top and a tax invoice is issued with every payment.`}
              {monthlyVerticals.length === VERTICALS.length && ' This applies to every category — doctors, hospitals, pharmacies, labs, insurance and ambulance services.'}
            </p>
          </>
        ) : (
          /* ── Tier plan: the population grid ── */
          <>
            <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {tiers.map(tier => {
                const hot = tier.mostPicked
                return (
                  <div key={tier.tier_number} style={{
                    background: hot ? BIZ.green : '#fff',
                    border: hot ? 'none' : `1px solid ${BIZ.border}`,
                    borderRadius: 18, padding: 'clamp(22px,5vw,28px)', position: 'relative',
                    boxShadow: hot ? '0 30px 60px -30px rgba(14,159,110,.6)' : 'none',
                  }}>
                    {hot && <div style={{ position: 'absolute', top: -11, left: 28, background: BIZ.ink, color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 999 }}>MOST PICKED</div>}
                    <div style={{ fontSize: 15, fontWeight: 800, color: hot ? '#fff' : BIZ.green, marginBottom: 6 }}>{tier.tier_name} pincode</div>
                    <div style={{ fontSize: 13, color: hot ? '#d6f2e6' : BIZ.mutedWarm, marginBottom: 16 }}>{tier.popLabel}</div>
                    <div style={{ fontSize: 'clamp(28px,7vw,34px)', fontWeight: 800, color: hot ? '#fff' : BIZ.ink, letterSpacing: '-.02em' }}>₹{tier.monthly_price.toLocaleString('en-IN')}<span style={{ fontSize: 15, fontWeight: 600, color: hot ? '#d6f2e6' : BIZ.mutedWarm }}>/mo</span></div>
                    {tier.blurb && (
                      <div style={{ fontSize: 13, color: hot ? '#eafaf3' : BIZ.muted, marginTop: 16, lineHeight: 1.6 }}>{tier.blurb}</div>
                    )}
                  </div>
                )
              })}
            </div>
            <p style={{ fontSize: 13.5, color: BIZ.mutedWarm, textAlign: 'center', marginTop: 22 }}>
              Your total is the sum of every pincode you pick{gstNote ? `, ${gstNote}` : ''}, for the term you choose at checkout.
              {' '}<strong style={{ color: BIZ.ink }}>Premium placement slots</strong> (top of your category in a pincode) are an optional weekly add-on.
            </p>
          </>
        )}

        {/* Commission block — only for verticals actually being charged one, so a
            flat plan that suspends commission doesn't leave stale terms on the page. */}
        {commissionRows.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#4f7a68', textAlign: 'center', margin: '48px 0 8px' }}>
              {commissionRows.map(x => verticalNoun(x.v.key)).join(' · ')}
              {commissionRows.every(x => !monthlyAppliesTo(plan, verticals.find(r => r.vertical === x.v.key))) && ' — no monthly fee'}
            </div>
            <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 0 24px' }}>
              You pay only when Sehatsandhi brings you business.
            </p>
            <div className="grid gap-5 grid-cols-1 md:grid-cols-3">
              {commissionRows.map(({ v, c }) => {
                const alsoMonthly = monthlyAppliesTo(plan, verticals.find(r => r.vertical === v.key))
                return (
                  <div key={v.key} style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: 'clamp(22px,5vw,28px)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span style={{ color: v.color, display: 'inline-flex' }}><VerticalIcon vertical={v.key} /></span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink }}>{verticalNoun(v.key)}</span>
                    </div>
                    <div style={{ fontSize: 34, fontWeight: 800, color: BIZ.green, letterSpacing: '-.02em' }}>
                      {c.percent}%<span style={{ fontSize: 15, fontWeight: 600, color: BIZ.mutedWarm }}> of {c.basis}</span>
                    </div>
                    <div style={{ fontSize: 13, color: BIZ.chipText, fontWeight: 800, background: BIZ.chipBg, display: 'inline-block', padding: '4px 10px', borderRadius: 999, marginTop: 12 }}>
                      {alsoMonthly
                        ? (flatPlan ? `Plus ₹${flatPrice.toLocaleString('en-IN')}/mo listing` : 'Plus your monthly listing fee')
                        : '₹0 monthly listing fee'}
                    </div>
                    <div style={{ fontSize: 13.5, color: BIZ.muted, marginTop: 14, lineHeight: 1.6 }}>{v.commissionNote}</div>
                  </div>
                )
              })}
            </div>
          </>
        )}
        {/* Worked example only while insurance actually pays a commission. */}
        {commissionRows.some(x => x.v.key === 'insurance') && (
          <p style={{ fontSize: 13.5, color: BIZ.mutedWarm, textAlign: 'center', marginTop: 22, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            <strong style={{ color: BIZ.ink }}>Insurance example:</strong> at{' '}
            {commissionRows.find(x => x.v.key === 'insurance')!.c.percent}%, a policy with a ₹1,200 IRDA
            commission means ₹{Math.round(1200 * (commissionRows.find(x => x.v.key === 'insurance')!.c.percent / 100)).toLocaleString('en-IN')} to
            Sehatsandhi and ₹{(1200 - Math.round(1200 * (commissionRows.find(x => x.v.key === 'insurance')!.c.percent / 100))).toLocaleString('en-IN')} to you.
          </p>
        )}
      </div>

      {/* WhatsApp booking demo (design 3a) */}
      <div className="mx-auto pb-6" style={{ maxWidth: PAGE.maxWidth, paddingLeft: PAGE.padX, paddingRight: PAGE.padX }}>
        <div style={{ display: 'grid', gap: 40, alignItems: 'center' }} className="lg:grid-cols-[1fr_auto]">
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#4f7a68' }}>Patient booking flow</div>
            <h2 style={{ fontSize: 'clamp(24px,6vw,30px)', fontWeight: 800, color: BIZ.ink, margin: '10px 0 12px', letterSpacing: '-.02em' }}>Booking happens inside WhatsApp</h2>
            <p style={{ fontSize: 16, color: BIZ.muted, lineHeight: 1.6, maxWidth: 520 }}>Patients tap a service and land in this AISensy-powered thread. Try it — tap the reply chips to walk a full doctor booking, from category to confirmed slot. Every reply maps to your schema: chosen doctor, slot &amp; fee become an appointment, and the reminder goes out over SMS + WhatsApp.</p>
          </div>
          <div className="flex justify-center min-w-0"><WhatsAppBotMock /></div>
        </div>
      </div>

      {/* cta band */}
      <div className="mx-auto pb-16" style={{ maxWidth: PAGE.maxWidth, paddingLeft: PAGE.padX, paddingRight: PAGE.padX }}>
        <div style={{ background: 'linear-gradient(120deg,#14201c,#1f3a30)', borderRadius: 22, padding: 'clamp(28px,7vw,44px) clamp(20px,5vw,44px)', textAlign: 'center' }}>
          <h3 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: '#fff', margin: '0 0 10px', letterSpacing: '-.02em' }}>Ready to reach patients near you?</h3>
          <p style={{ fontSize: 16, color: '#b9c9c1', margin: '0 0 24px' }}>Set up your listing in under 5 minutes. No upfront cost to register.</p>
          <Link to="/business/register" className="max-sm:block" style={{ display: 'inline-block', background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 16, padding: '15px 30px', borderRadius: 14 }}>Start onboarding</Link>
        </div>
      </div>
    </div>
  )
}
