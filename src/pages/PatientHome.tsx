import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { WA_NUMBER } from '../types'

// Design 1a / Turn-4 — patient homepage, "Warm Care".
//
// TWO real layouts that share the SAME content, data, state, and piece-
// components — only the composition/grid changes per breakpoint:
//   • Mobile (< lg): single full-width stacked app column. The page IS the
//     screen (no phone bezel).
//   • Desktop (≥ lg): contained 1120px landing — slim header, two-column hero
//     (copy+CTA+trust | ambulance + how-it-works cards), 6-across category row,
//     full-width doctor teaser.
// Both render from one component tree; Tailwind `lg:` visibility swaps them, so
// the language toggle and area <select> drive both simultaneously.

const font = "'Manrope','Noto Sans Devanagari',system-ui,sans-serif"

interface Strings {
  brand: string; area_label: string; tagline: string; subtag: string; book: string
  emergency_title: string; emergency_sub: string; emergency_btn: string; need: string
  doctors: string; hospitals: string; pharmacy: string; labs: string; insurance: string; ambulance: string
  doc_teaser_title: string; doc_teaser_sub: string; how: string; step1: string; step2: string; step3: string
  trust_verified: string; trust_free: string; trust_wa: string
}

const DICT: Record<'en' | 'hi', Strings> = {
  en: {
    brand: 'Sehatsandhi', area_label: 'Your area',
    tagline: 'Family health help, on WhatsApp',
    subtag: 'Doctors, medicines, lab tests, ambulance & more — near you, free to use.',
    book: 'Book on WhatsApp',
    emergency_title: 'Need an ambulance?', emergency_sub: 'One tap — help reaches you fast',
    emergency_btn: 'Ambulance now',
    need: 'What do you need?',
    doctors: 'Doctors', hospitals: 'Hospitals', pharmacy: 'Medicines',
    labs: 'Lab Tests', insurance: 'Insurance', ambulance: 'Ambulance',
    doc_teaser_title: 'Find the right doctor', doc_teaser_sub: 'Eye, ENT, Skin, Heart & 16 more',
    how: 'How it works', step1: 'Pick a service', step2: 'Chat on WhatsApp', step3: 'Booking confirmed',
    trust_verified: 'Verified providers', trust_free: 'Free for you', trust_wa: 'All on WhatsApp',
  },
  hi: {
    brand: 'सेहतसंधि', area_label: 'आपका इलाका',
    tagline: 'परिवार की सेहत, अब व्हाट्सएप पर',
    subtag: 'डॉक्टर, दवाई, लैब टेस्ट, एम्बुलेंस और भी बहुत कुछ — आपके पास, बिल्कुल मुफ़्त।',
    book: 'व्हाट्सएप पर बुक करें',
    emergency_title: 'एम्बुलेंस चाहिए?', emergency_sub: 'एक टैप — मदद जल्दी पहुँचेगी',
    emergency_btn: 'एम्बुलेंस अभी',
    need: 'आपको क्या चाहिए?',
    doctors: 'डॉक्टर', hospitals: 'अस्पताल', pharmacy: 'दवाई',
    labs: 'लैब टेस्ट', insurance: 'बीमा', ambulance: 'एम्बुलेंस',
    doc_teaser_title: 'सही डॉक्टर चुनें', doc_teaser_sub: 'आँख, नाक-कान-गला, त्वचा, हृदय और 16 अन्य',
    how: 'यह कैसे काम करता है', step1: 'सेवा चुनें', step2: 'व्हाट्सएप पर बात करें', step3: 'बुकिंग पक्की',
    trust_verified: 'सत्यापित प्रोवाइडर', trust_free: 'आपके लिए मुफ़्त', trust_wa: 'सब कुछ व्हाट्सएप पर',
  },
}

const AREAS = ['Yamunanagar', 'Jagadhri', 'Radaur', 'Bilaspur', 'Chhachhrauli']

const iconProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const Icons = {
  doctors: (s: number) => <svg {...iconProps} style={{ width: s, height: s }}><path d="M6 3v5a4 4 0 0 0 8 0V3" /><path d="M10 15a5 5 0 0 0 5 5 4 4 0 0 0 4-4v-2" /><circle cx="19" cy="10" r="2" /></svg>,
  hospitals: (s: number) => <svg {...iconProps} style={{ width: s, height: s }}><path d="M4 21V7l8-4 8 4v14" /><path d="M9 21v-4h6v4" /><path d="M12 8v4M10 10h4" /></svg>,
  pharmacy: (s: number) => <svg {...iconProps} style={{ width: s, height: s }}><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z" /><path d="m8 8 8 8" /></svg>,
  labs: (s: number) => <svg {...iconProps} style={{ width: s, height: s }}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /><path d="M7.5 14h9" /></svg>,
  insurance: (s: number) => <svg {...iconProps} style={{ width: s, height: s }}><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="M12 8v6M9 11h6" /></svg>,
  ambulance: (s: number) => <svg {...iconProps} style={{ width: s, height: s }}><path d="M3 8h10v7H3z" /><path d="M13 11h4l3 3v1h-7z" /><circle cx="7" cy="17" r="1.8" /><circle cx="17" cy="17" r="1.8" /><path d="M6.5 10v2M5 11h3" /></svg>,
}

type CatKey = keyof typeof Icons
interface Cat { key: CatKey; label: string; tint: string; color: string; link: string }

const WaGlyph = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size, height: size }}><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.6 14.2c-.2.6-1.4 1.2-2 1.3-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-1.9.9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.5.7 1.8.8 1.9.1.1.1.3 0 .5l-.5.6-.4.4c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.2 1.3 1 2.3 1.4 2.6 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.7.9c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z" /></svg>
)

// ── shared piece-components (used by BOTH layouts) ──

function Brand({ size = 18 }: { size?: number }) {
  // Horizontal lockup: heart symbol + wordmark, matched heights, plain centering.
  const h = size * 2.7
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.5, flex: '0 0 auto' }}>
      <img src="/logo-only-symbol.png" alt="" aria-hidden style={{ height: h, width: 'auto', objectFit: 'contain' }} />
      <img src="/logo-title.png" alt="Sehatsandhi" style={{ height: h, width: 'auto', objectFit: 'contain' }} />
    </div>
  )
}

function LangButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} style={{ border: '1.5px solid #0E9F6E', background: '#fff', color: '#0E9F6E', fontWeight: 700, fontSize: 13, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
}

function AreaSelect({ t, area, setArea, compact }: { t: Strings; area: string; setArea: (a: string) => void; compact?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e7e0d4', borderRadius: 14, padding: compact ? '8px 12px' : '9px 14px' }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="#0E9F6E" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flex: '0 0 auto' }}><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
      <div style={{ flex: 1 }}>
        {!compact && <div style={{ fontSize: 11, color: '#8a8172', fontWeight: 600 }}>{t.area_label}</div>}
        <select value={area} onChange={e => setArea(e.target.value)} style={{ border: 'none', background: 'transparent', fontSize: 15, fontWeight: 700, color: '#14201c', outline: 'none', width: '100%', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          {AREAS.map(a => <option key={a}>{a}</option>)}
        </select>
      </div>
    </label>
  )
}

function BookCta({ t, link, fullWidth }: { t: Strings; link: string; fullWidth?: boolean }) {
  return (
    <a href={link} target="_blank" rel="noreferrer" style={{
      display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : 'auto',
      alignItems: 'center', justifyContent: 'center', gap: 10, background: '#25D366', color: '#fff',
      fontWeight: 800, fontSize: 16, padding: fullWidth ? 15 : '15px 28px', borderRadius: 16,
      boxShadow: '0 10px 20px -6px rgba(37,211,102,.6)',
    }}>
      <WaGlyph /> {t.book}
    </a>
  )
}

function AmbulanceCard({ t, link }: { t: Strings; link: string }) {
  return (
    <div style={{ background: '#fff2f0', border: '1px solid #ffd9d3', borderRadius: 16, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: '#DC2626', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{Icons.ambulance(23)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#991b1b' }}>{t.emergency_title}</div>
        <div style={{ fontSize: 12, color: '#b45c52' }}>{t.emergency_sub}</div>
      </div>
      <a href={link} target="_blank" rel="noreferrer" style={{ background: '#DC2626', color: '#fff', fontWeight: 800, fontSize: 13, padding: '9px 12px', borderRadius: 11, whiteSpace: 'nowrap' }}>{t.emergency_btn}</a>
    </div>
  )
}

function CategoryTile({ c, big }: { c: Cat; big?: boolean }) {
  const box = big ? 56 : 48
  return (
    <a href={c.link} target="_blank" rel="noreferrer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: big ? '18px 8px' : '14px 6px', background: '#fff', border: '1px solid #eee6d8', borderRadius: 16 }}>
      <span style={{ width: box, height: box, borderRadius: 14, background: c.tint, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icons[c.key](big ? 28 : 24)}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#14201c', textAlign: 'center' }}>{c.label}</span>
    </a>
  )
}

function DoctorTeaser({ t }: { t: Strings }) {
  return (
    <div style={{ background: 'linear-gradient(120deg,#0E9F6E,#0b7d57)', borderRadius: 18, padding: '16px 18px', color: '#fff', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{t.doc_teaser_title}</div>
        <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 2 }}>{t.doc_teaser_sub}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" style={{ width: 22, height: 22, opacity: 0.9 }}><path d="m9 6 6 6-6 6" /></svg>
    </div>
  )
}

function HowItWorksCard({ t, dark }: { t: Strings; dark?: boolean }) {
  const bg = dark ? 'linear-gradient(140deg,#0E9F6E,#0b7d57)' : 'transparent'
  const titleColor = dark ? '#fff' : '#14201c'
  const stepColor = dark ? 'rgba(255,255,255,.92)' : '#3f4a44'
  const badge = dark ? 'rgba(255,255,255,.22)' : '#0E9F6E'
  return (
    <div style={{ background: bg, borderRadius: 18, padding: dark ? '20px 22px' : '0' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: titleColor, marginBottom: 12 }}>{t.how}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[t.step1, t.step2, t.step3].map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: badge, color: '#fff', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{i + 1}</span>
            <span style={{ fontSize: 14, color: stepColor, fontWeight: 600 }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrustRow({ t, row }: { t: Strings; row?: boolean }) {
  const items = [t.trust_verified, t.trust_free, t.trust_wa]
  return (
    <div style={{ display: 'flex', gap: row ? 22 : 0, justifyContent: row ? 'flex-start' : 'space-between', flexWrap: 'wrap', ...(row ? {} : { background: '#f2ede2', padding: '16px 20px 26px' }) }}>
      {items.map((label, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: row ? 'row' : 'column', alignItems: 'center', gap: row ? 7 : 4, flex: row ? '0 0 auto' : 1 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#0E9F6E" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
          <span style={{ fontSize: row ? 13 : 11, fontWeight: 700, color: '#3f4a44', textAlign: 'center' }}>{label}</span>
        </div>
      ))}
    </div>
  )
}

export default function PatientHome() {
  const { lang, setLang } = useLanguage()
  const [area, setArea] = useState('Yamunanagar')
  const t = DICT[lang]

  const num = WA_NUMBER.replace(/[^0-9]/g, '') || '919999999999'
  const mk = (msg: string) => `https://wa.me/${num}?text=${encodeURIComponent(`${msg} (${area})`)}`
  const waLink = mk('Hi Sehatsandhi, I need help')
  const ambLink = mk('EMERGENCY: I need an ambulance')
  const langBtn = lang === 'en' ? 'हिंदी' : 'ENGLISH'
  const toggleLang = () => setLang(lang === 'en' ? 'hi' : 'en')

  const CATS: Cat[] = [
    { key: 'doctors', label: t.doctors, tint: 'rgba(14,159,110,.12)', color: '#0E9F6E', link: waLink },
    { key: 'hospitals', label: t.hospitals, tint: 'rgba(37,99,235,.12)', color: '#2563EB', link: waLink },
    { key: 'pharmacy', label: t.pharmacy, tint: 'rgba(219,39,119,.12)', color: '#DB2777', link: waLink },
    { key: 'labs', label: t.labs, tint: 'rgba(124,58,237,.12)', color: '#7C3AED', link: waLink },
    { key: 'insurance', label: t.insurance, tint: 'rgba(8,145,178,.12)', color: '#0891B2', link: waLink },
    { key: 'ambulance', label: t.ambulance, tint: 'rgba(220,38,38,.12)', color: '#DC2626', link: ambLink },
  ]

  return (
    <div style={{ fontFamily: font, background: '#FBF7F0', minHeight: '100vh' }}>
      {/* ══════════ MOBILE / TABLET (< lg): stacked app column ══════════ */}
      <div className="flex lg:hidden" style={{ background: '#e7eaef', minHeight: '100vh', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 520, minHeight: '100vh', background: '#FBF7F0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 4px' }}>
            <Brand />
            <LangButton label={langBtn} onClick={toggleLang} />
          </div>
          <div style={{ padding: '8px 20px 4px' }}><AreaSelect t={t} area={area} setArea={setArea} /></div>
          <div style={{ padding: '16px 22px 6px' }}>
            <h1 style={{ fontSize: 26, lineHeight: 1.2, fontWeight: 800, color: '#14201c', margin: '0 0 8px', letterSpacing: '-.02em' }}>{t.tagline}</h1>
            <p style={{ fontSize: 14, color: '#5f6b64', margin: '0 0 14px', lineHeight: 1.5 }}>{t.subtag}</p>
            <BookCta t={t} link={waLink} fullWidth />
          </div>
          <div style={{ padding: '14px 20px 4px' }}><AmbulanceCard t={t} link={ambLink} /></div>
          <div style={{ padding: '18px 20px 4px' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#14201c', marginBottom: 12 }}>{t.need}</div>
            {/* mobile 2-col, tablet 3-col */}
            <div className="grid grid-cols-2 sm:grid-cols-3" style={{ gap: 10 }}>
              {CATS.map(c => <CategoryTile key={c.key} c={c} />)}
            </div>
          </div>
          <div style={{ padding: '16px 20px 4px' }}><DoctorTeaser t={t} /></div>
          <div style={{ padding: '18px 22px 8px' }}><HowItWorksCard t={t} /></div>
          <div style={{ marginTop: 'auto' }}><TrustRow t={t} /></div>
        </div>
      </div>

      {/* ══════════ DESKTOP (≥ lg): contained landing ══════════ */}
      <div className="hidden lg:block" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 48px 64px' }}>
        {/* slim header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 8px' }}>
          <Brand size={22} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 240 }}><AreaSelect t={t} area={area} setArea={setArea} compact /></div>
            <LangButton label={langBtn} onClick={toggleLang} />
          </div>
        </div>

        {/* two-column hero */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 44, alignItems: 'center', padding: '40px 0 8px' }}>
          <div>
            <h1 style={{ fontSize: 46, lineHeight: 1.08, fontWeight: 800, color: '#14201c', margin: '0 0 18px', letterSpacing: '-.03em' }}>{t.tagline}</h1>
            <p style={{ fontSize: 18, color: '#5f6b64', lineHeight: 1.55, margin: '0 0 28px', maxWidth: 500 }}>{t.subtag}</p>
            <BookCta t={t} link={waLink} />
            <div style={{ marginTop: 28 }}><TrustRow t={t} row /></div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AmbulanceCard t={t} link={ambLink} />
            <HowItWorksCard t={t} dark />
          </div>
        </div>

        {/* 6-across category row */}
        <div style={{ padding: '36px 0 8px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#14201c', marginBottom: 16 }}>{t.need}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
            {CATS.map(c => <CategoryTile key={c.key} c={c} big />)}
          </div>
        </div>

        {/* full-width doctor teaser band */}
        <div style={{ padding: '20px 0 0' }}><DoctorTeaser t={t} /></div>
      </div>
    </div>
  )
}
