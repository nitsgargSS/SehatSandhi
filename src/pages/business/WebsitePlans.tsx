import { Globe, Check, Sparkles, ExternalLink, MessageCircle } from 'lucide-react'
import { PAGE } from '../../components/SiteHeader'
import { BIZ } from './shared'
import { money } from '../../lib/format'
import type { PlanCatalogue } from '../../hooks/usePlanCatalogue'

// 0282/0283: every business gets a website. 0309 (2 Nov 2026): marketing on
// its own — WhatsApp Pro on the clinic's own number and/or Social media &
// website — for clinics with or without the software, which they can add later.
// The website price is plan_addons 'social' (from the catalogue); WhatsApp Pro
// is vertical_term_prices' (₹1,000 a month for a clinic).
export const OWN_NAME_PRICE = 1000
const WHATSAPP_PRO_PRICE = 1000

const FREE = [
  'Your page at sehatsandhi.com/s/your-name',
  'Logo, photo and a short introduction',
  'Doctors, fees and hours — updated by themselves from your dashboard',
  'Ratings, health camps, and booking on WhatsApp',
]
const WHATSAPP = [
  'Your clinic’s own number on WhatsApp, in your clinic’s name',
  'Camps, notices and health tips to your patients, across your district',
  'Prescriptions, bills, reminders and follow-ups sent by themselves',
  'Patients find you in the Sehatsandhi app and WhatsApp bot, and book',
  'Your patient list: from bookings and QR scans, or upload an Excel sheet',
]
const OWN = [
  'Your full website, made and hosted for you',
  'On your own domain — www.yourclinic.com — or on Sehatsandhi',
  'Services, doctor profiles, equipment, cashless (TPA) panel, articles, in Hindi and English',
  'Your Facebook page and Instagram on your website',
  'Booking on WhatsApp straight from your site',
]

export default function WebsitePlans({ catalogue }: { catalogue?: PlanCatalogue | null }) {
  const socialPrice = catalogue?.addons.find(a => a.code === 'social')?.monthly_price ?? OWN_NAME_PRICE
  const card = { borderRadius: 20, padding: 'clamp(20px,5vw,28px)', display: 'flex', flexDirection: 'column' as const, gap: 12 }
  const item = (t: string, light = false) => (
    <li key={t} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 14.5, lineHeight: 1.5, color: light ? '#fff' : BIZ.ink }}>
      <Check className="w-4 h-4" style={{ flex: '0 0 auto', marginTop: 3, color: light ? '#bff0d9' : BIZ.green }} />{t}
    </li>
  )
  const price = (n: number, light = false) => (
    <div style={{ marginTop: 'auto', fontSize: 28, fontWeight: 800, color: light ? '#fff' : BIZ.ink }}>
      {money(n)}<span style={{ fontSize: 15, fontWeight: 600, color: light ? '#d6f2e6' : BIZ.muted }}>/month</span>
    </div>
  )
  return (
    <div id="website" className="mx-auto pb-14" style={{ maxWidth: PAGE.maxWidth, paddingLeft: PAGE.padX, paddingRight: PAGE.padX, scrollMarginTop: 90 }}>
      <h2 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>
        Marketing — with or without the software
      </h2>
      <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 auto 30px', maxWidth: 680, lineHeight: 1.6 }}>
        Every listing gets a free page. Take WhatsApp Pro, your own website, or both — on their own, or with the clinic
        software. Add the software, IPD or lab any time from your dashboard.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div style={{ ...card, background: '#fff', border: `1px solid ${BIZ.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: BIZ.green }}><Globe className="w-5 h-5" />
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>Free with every listing</span></div>
          <div style={{ fontSize: 22, fontWeight: 800, color: BIZ.ink }}>Your page on Sehatsandhi</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{FREE.map(t => item(t))}</ul>
          <div style={{ marginTop: 'auto', fontSize: 28, fontWeight: 800, color: BIZ.ink }}>₹0</div>
        </div>
        <div style={{ ...card, background: '#fff', border: `2px solid ${BIZ.green}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: BIZ.green }}><MessageCircle className="w-5 h-5" />
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>WhatsApp Pro</span></div>
          <div style={{ fontSize: 22, fontWeight: 800, color: BIZ.ink }}>Reach patients on WhatsApp</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{WHATSAPP.map(t => item(t))}</ul>
          <p style={{ fontSize: 12.5, color: BIZ.mutedWarm, margin: 0 }}>Messages are billed by Meta to your own card.</p>
          {price(WHATSAPP_PRO_PRICE)}
        </div>
        <div style={{ ...card, background: BIZ.green, boxShadow: '0 30px 60px -30px rgba(14,159,110,.6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#d6f2e6' }}><Sparkles className="w-5 h-5" />
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>Social media & website</span></div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Your own website</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{OWN.map(t => item(t, true))}</ul>
          {price(socialPrice, true)}
        </div>
      </div>
      <p style={{ textAlign: 'center', marginTop: 18, fontSize: 14.5 }}>
        <a href="https://www.sneyeshospital.com" target="_blank" rel="noreferrer" style={{ color: BIZ.green, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          See one: SN Eye Hospital <ExternalLink className="w-4 h-4" />
        </a>
        <span style={{ color: BIZ.mutedWarm }}> · Prices + GST.</span>
      </p>
    </div>
  )
}
