import { Globe, Check, Sparkles, ExternalLink } from 'lucide-react'
import { PAGE } from '../../components/SiteHeader'
import { BIZ } from './shared'
import { money } from '../../lib/format'

// 0282/0283: every business gets a website; the own name plan makes the
// website — and the software — the business's own. The price is the product
// plan's (₹1,000 a month) until it is a priced add-on in plan_addons.
export const OWN_NAME_PRICE = 1000

const FREE = [
  'Your page at sehatsandhi.com/s/your-name',
  'Logo, photo and a short introduction',
  'Doctors, fees and hours — updated by themselves from your dashboard',
  'Ratings, health camps, and booking on WhatsApp',
]
const OWN = [
  'Your own domain — www.yourhospital.com — set up by our team',
  'The full website: services, doctor profiles, equipment, insurance, articles, Hindi',
  'Your colours and font style, with only a small "Powered by Sehatsandhi"',
  'The software in your name — patients see your records on your site; staff log in on your domain',
  'Your Facebook and Instagram posts shown on your website',
]

export default function WebsitePlans() {
  const card = { borderRadius: 20, padding: 'clamp(20px,5vw,28px)', display: 'flex', flexDirection: 'column' as const, gap: 12 }
  const item = (t: string, light = false) => (
    <li key={t} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 14.5, lineHeight: 1.5, color: light ? '#fff' : BIZ.ink }}>
      <Check className="w-4 h-4" style={{ flex: '0 0 auto', marginTop: 3, color: light ? '#bff0d9' : BIZ.green }} />{t}
    </li>
  )
  return (
    <div id="website" className="mx-auto pb-14" style={{ maxWidth: PAGE.maxWidth, paddingLeft: PAGE.padX, paddingRight: PAGE.padX, scrollMarginTop: 90 }}>
      <h2 style={{ fontSize: 'clamp(23px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, textAlign: 'center', margin: '0 0 8px', letterSpacing: '-.02em' }}>
        A website for every business
      </h2>
      <p style={{ fontSize: 15, color: BIZ.muted, textAlign: 'center', margin: '0 auto 30px', maxWidth: 640, lineHeight: 1.6 }}>
        Register and your website is ready — free. Want it to be yours alone? The own name plan puts your website and your
        software on your own domain, in your name.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div style={{ ...card, background: '#fff', border: `1px solid ${BIZ.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: BIZ.green }}><Globe className="w-5 h-5" />
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>Free with every listing</span></div>
          <div style={{ fontSize: 22, fontWeight: 800, color: BIZ.ink }}>Your page on Sehatsandhi</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{FREE.map(t => item(t))}</ul>
          <div style={{ marginTop: 'auto', fontSize: 28, fontWeight: 800, color: BIZ.ink }}>₹0</div>
        </div>
        <div style={{ ...card, background: BIZ.green, boxShadow: '0 30px 60px -30px rgba(14,159,110,.6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#d6f2e6' }}><Sparkles className="w-5 h-5" />
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>Own name plan</span></div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>Your website and software, in your name</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{OWN.map(t => item(t, true))}</ul>
          <div style={{ marginTop: 'auto', fontSize: 28, fontWeight: 800, color: '#fff' }}>
            {money(OWN_NAME_PRICE)}<span style={{ fontSize: 15, fontWeight: 600, color: '#d6f2e6' }}>/month, on top of your plan</span>
          </div>
        </div>
      </div>
      <p style={{ textAlign: 'center', marginTop: 18, fontSize: 14.5 }}>
        <a href="/s/sneyehospital" target="_blank" rel="noreferrer" style={{ color: BIZ.green, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          See one: SN Eye Hospital <ExternalLink className="w-4 h-4" />
        </a>
        <span style={{ color: BIZ.mutedWarm }}> · Posts made for you and SEO are available as extras.</span>
      </p>
    </div>
  )
}
