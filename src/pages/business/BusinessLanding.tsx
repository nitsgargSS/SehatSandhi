import { Link } from 'react-router-dom'
import { BIZ, VERTICALS, PRICING_TIERS } from './shared'
import VerticalIcon from './VerticalIcon'
import WhatsAppBotMock from './WhatsAppBotMock'
import ReachSnapshot from './ReachSnapshot'

// Design 2a — "List your business" marketing landing, desktop-first, Warm Care look.
// Colors are the exact design values (kept off the site's teal/navy theme on purpose).

const font = "'Manrope','Noto Sans Devanagari',system-ui,sans-serif"

export default function BusinessLanding() {
  return (
    <div style={{ background: BIZ.cream, fontFamily: font }}>
      {/* nav — logos shrink and the link row wraps under them on narrow phones */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'clamp(12px,3vw,16px) clamp(16px,4vw,40px)', borderBottom: `1px solid ${BIZ.border}`, gap: 12 }} className="max-w-7xl mx-auto flex-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo-only-symbol.png" alt="" aria-hidden style={{ height: 'clamp(36px,9vw,50px)', width: 'auto', objectFit: 'contain' }} />
          <img src="/logo-title.png" alt="Sehatsandhi" style={{ height: 'clamp(36px,9vw,50px)', width: 'auto', objectFit: 'contain' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(14px,3.5vw,28px)' }} className="flex-wrap">
          <a href="#how" className="max-sm:hidden" style={{ fontSize: 14, fontWeight: 600, color: BIZ.muted }}>How it works</a>
          <a href="#pricing" style={{ fontSize: 14, fontWeight: 600, color: BIZ.muted }}>Pricing</a>
          <Link to="/doctor/login" style={{ fontSize: 14, fontWeight: 600, color: BIZ.muted }}>Log in</Link>
          <Link to="/business/register" style={{ background: BIZ.green, color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 20px', borderRadius: 12 }}>List your business</Link>
        </div>
      </div>

      {/* hero */}
      <div className="max-w-7xl mx-auto grid gap-10 items-center lg:grid-cols-[1.15fr_.85fr]" style={{ padding: 'clamp(28px,7vw,56px) clamp(16px,4vw,40px)' }}>
        <div>
          <div style={{ display: 'inline-block', background: BIZ.chipBg, color: BIZ.chipText, fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, marginBottom: 18 }}>Now live in Yamunanagar · rolling out across India</div>
          <h1 style={{ fontSize: 'clamp(30px,7.5vw,46px)', lineHeight: 1.1, fontWeight: 800, color: BIZ.ink, margin: '0 0 18px', letterSpacing: '-.03em' }}>Reach every patient in your pincodes.</h1>
          <p style={{ fontSize: 'clamp(16px,4vw,18px)', color: BIZ.muted, lineHeight: 1.55, margin: '0 0 28px', maxWidth: 520 }}>Doctors, hospitals, pharmacies, labs, insurers and ambulance services get discovered by families nearby — over WhatsApp &amp; SMS. Choose your pincodes, pay only for the audience you reach.</p>
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
        {['6 service categories', 'Pay by audience, not per click', 'WhatsApp & SMS delivery', 'Villages to tier-1 cities'].map(s => (
          <span key={s} style={{ fontSize: 14, fontWeight: 700, color: '#3f4a44' }}>{s}</span>
        ))}
      </div>

      {/* how it works */}
      <div id="how" className="max-w-7xl mx-auto" style={{ padding: 'clamp(28px,7vw,56px) clamp(16px,4vw,40px)' }}>
        <h2 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>How zipcode reach works</h2>
        <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 0 36px' }}>Three steps to start appearing for patients around you.</p>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { n: '1', t: 'Pick your pincodes', d: 'Select any number of pincodes — villages, towns or full cities — where you want patients to find you.' },
            { n: '2', t: 'We show you to those users', d: 'When a patient in your pincodes needs your category, you appear in their WhatsApp options.' },
            { n: '3', t: 'Pay by audience size', d: 'Your fee scales with how many users live in your chosen pincodes. Bigger reach, higher premium.' },
          ].map(s => (
            <div key={s.n} style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18, padding: 'clamp(20px,5vw,26px)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: BIZ.green, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>{s.n}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: BIZ.ink, marginBottom: 8 }}>{s.t}</div>
              <div style={{ fontSize: 14, color: BIZ.muted, lineHeight: 1.55 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* verticals */}
      <div className="max-w-7xl mx-auto pb-10" style={{ paddingLeft: 'clamp(16px,4vw,40px)', paddingRight: 'clamp(16px,4vw,40px)' }}>
        <h3 style={{ fontSize: 'clamp(19px,4.5vw,22px)', fontWeight: 800, color: BIZ.ink, margin: '0 0 20px' }}>Who can list</h3>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {VERTICALS.map(v => (
            <div key={v.key} style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16, textAlign: 'center' }}>
              <span style={{ color: v.color, display: 'inline-flex' }}><VerticalIcon vertical={v.key} /></span>
              <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.ink, marginTop: 8 }}>{v.key === 'doctors' ? 'Doctors' : v.key === 'hospital' ? 'Hospitals' : v.key === 'pharmacy' ? 'Pharmacies' : v.key === 'lab' ? 'Labs' : v.key === 'insurance' ? 'Insurance' : 'Ambulance'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* pricing — four population tiers */}
      <div id="pricing" className="max-w-7xl mx-auto pb-14" style={{ paddingLeft: 'clamp(16px,4vw,40px)', paddingRight: 'clamp(16px,4vw,40px)' }}>
        <h2 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>Pay for reach, not clicks</h2>
        <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 0 36px' }}>Every pincode has a monthly price set by its population tier. Your total is the sum of the pincodes you pick.</p>
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_TIERS.map(tier => {
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
                <div style={{ fontSize: 13, color: hot ? '#eafaf3' : BIZ.muted, marginTop: 16, lineHeight: 1.6 }}>{tier.blurb}</div>
              </div>
            )
          })}
        </div>
        <p style={{ fontSize: 13.5, color: BIZ.mutedWarm, textAlign: 'center', marginTop: 22 }}>
          Your total is the sum of every pincode you pick. <strong style={{ color: BIZ.ink }}>Premium placement slots</strong> (top of your category in a pincode) are an optional weekly add-on.
        </p>
      </div>

      {/* WhatsApp booking demo (design 3a) */}
      <div className="max-w-7xl mx-auto pb-6" style={{ paddingLeft: 'clamp(16px,4vw,40px)', paddingRight: 'clamp(16px,4vw,40px)' }}>
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
      <div className="max-w-7xl mx-auto pb-16" style={{ paddingLeft: 'clamp(16px,4vw,40px)', paddingRight: 'clamp(16px,4vw,40px)' }}>
        <div style={{ background: 'linear-gradient(120deg,#14201c,#1f3a30)', borderRadius: 22, padding: 'clamp(28px,7vw,44px) clamp(20px,5vw,44px)', textAlign: 'center' }}>
          <h3 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: '#fff', margin: '0 0 10px', letterSpacing: '-.02em' }}>Ready to reach patients near you?</h3>
          <p style={{ fontSize: 16, color: '#b9c9c1', margin: '0 0 24px' }}>Set up your listing in under 5 minutes. No upfront cost to register.</p>
          <Link to="/business/register" className="max-sm:block" style={{ display: 'inline-block', background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 16, padding: '15px 30px', borderRadius: 14 }}>Start onboarding</Link>
        </div>
      </div>
    </div>
  )
}
