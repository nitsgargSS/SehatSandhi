import { SOCIALS } from './SiteFooter'

// "Follow Sehatsandhi" under the documents patients open from a link
// (prescription, bill, report, discharge summary, tracking pages): the pages
// most people see, so the Facebook and Instagram accounts get found. Screen
// only — never on the printed paper, which belongs to the clinic.
export default function FollowUs() {
  return (
    <div className="no-print print:hidden" style={{
      marginTop: 18, display: 'flex', flexWrap: 'wrap', alignItems: 'center',
      justifyContent: 'center', gap: '6px 14px', fontSize: 13, color: '#8a8172',
    }}>
      <span>Follow Sehatsandhi / सेहतसंधि को फ़ॉलो करें</span>
      {SOCIALS.map(({ href, label, Icon }) => (
        <a key={label} href={href} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#0f6b4a', fontWeight: 700 }}>
          <Icon size={16} strokeWidth={2} aria-hidden /> {label}
        </a>
      ))}
    </div>
  )
}
