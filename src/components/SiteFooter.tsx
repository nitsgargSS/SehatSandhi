import { Link } from 'react-router-dom'
import { Facebook, Instagram } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { WA_NUMBER } from '../types'
import { HEADER, PAGE } from './SiteHeader'

// One footer for every public page, and the counterpart to SiteHeader.
//
// The site had no footer at all, which meant no public page named the legal
// entity behind the brand, gave a contact, or linked to a policy. Meta's
// business verification and Razorpay's merchant checks both look for exactly
// that, and the policy pages themselves point people at "the contact details on
// our homepage" — which was not true until this existed.
//
// Unlike SiteHeader, the content belongs here rather than to the caller: every
// page wants the same links, so `<SiteFooter />` takes no props. It reads the
// language itself for the same reason.

const LINKS = [
  { to: '/about', en: 'About Us', hi: 'हमारे बारे में' },
  { to: '/contact', en: 'Contact Us', hi: 'संपर्क करें' },
  { to: '/privacy', en: 'Privacy Policy', hi: 'गोपनीयता नीति' },
  { to: '/terms', en: 'Terms', hi: 'नियम व शर्तें' },
  { to: '/refund', en: 'Refund Policy', hi: 'रिफंड नीति' },
]

// Only accounts that actually exist go here. Meta's business verification
// checks that the site and the Page point at each other, so a link to a profile
// that isn't there is worse than no link at all — it reads as a dead claim.
// Adding YouTube or X later is one more row.
const SOCIALS = [
  { href: 'https://www.facebook.com/sehatsandhi', label: 'Facebook', Icon: Facebook },
  { href: 'https://www.instagram.com/sehatsandhi/', label: 'Instagram', Icon: Instagram },
]

/** Digits to the display form: 917015399355 → +91 70153 99355. */
const prettyPhone = (digits: string) =>
  /^91\d{10}$/.test(digits)
    ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
    : `+${digits}`

export default function SiteFooter() {
  const { lang } = useLanguage()
  const hi = lang === 'hi'

  return (
    <div style={{ background: HEADER.cream, borderTop: `1px solid ${HEADER.border}`, marginTop: 'auto' }}>
      <div style={{
        maxWidth: PAGE.maxWidth, margin: '0 auto',
        paddingLeft: PAGE.padX, paddingRight: PAGE.padX,
        paddingTop: 28, paddingBottom: 32, textAlign: 'center',
      }}>
        <div className="flex-wrap" style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          gap: '10px 22px', marginBottom: 16,
        }}>
          {LINKS.map(l => (
            <Link key={l.to} to={l.to}
              style={{ fontSize: 13.5, fontWeight: 700, color: HEADER.muted, whiteSpace: 'nowrap' }}>
              {hi ? l.hi : l.en}
            </Link>
          ))}
        </div>

        {/* Legal entity, spelled out because the brand name and the registered
            name differ — Meta asks for this explicitly when they do, and matches
            the address below against the GST certificate. So this is the
            registered principal place of business, not a mailing address, and it
            stays in English in both languages because that is how it is written
            on the document. */}
        <p style={{ fontSize: 12.5, color: HEADER.muted, lineHeight: 1.7, margin: '0 0 6px' }}>
          {hi ? 'सेहतसंधि, NG Technologies द्वारा संचालित' : 'Sehatsandhi is operated by NG Technologies'}
          <br />
          1743 Vishnu Garden, Jagadhri – 135003, Haryana, India
        </p>

        <p style={{ fontSize: 12.5, color: HEADER.muted, lineHeight: 1.7, margin: '0 0 10px' }}>
          <a href="mailto:hello@sehatsandhi.com" style={{ color: HEADER.green, fontWeight: 700 }}>
            hello@sehatsandhi.com
          </a>
          <span style={{ opacity: .5 }}>{'  ·  '}</span>
          <a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noreferrer"
            style={{ color: HEADER.green, fontWeight: 700 }}>
            {prettyPhone(WA_NUMBER)}
          </a>
        </p>

        {/* The icon is 19px, so each link pads out to a ~40px tap target and the
            row uses negative margin to stay visually tight despite it. */}
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          gap: 4, margin: '0 -10px 12px',
        }}>
          {SOCIALS.map(({ href, label, Icon }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer"
              aria-label={label} title={label}
              style={{ display: 'inline-flex', padding: 10, color: HEADER.muted, lineHeight: 0 }}>
              <Icon size={19} strokeWidth={1.9} aria-hidden />
            </a>
          ))}
        </div>

        <p style={{ fontSize: 11.5, color: HEADER.muted, opacity: .75, margin: 0 }}>
          © 2026 NG Technologies. {hi ? 'सभी अधिकार सुरक्षित।' : 'All rights reserved.'}
        </p>
      </div>
    </div>
  )
}
