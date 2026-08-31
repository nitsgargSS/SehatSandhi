import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ListOrdered, FileText, Mic, ShieldAlert, Search, BedDouble,
  Pill, ClipboardCheck, ReceiptText, Users, CalendarClock, Lock,
} from 'lucide-react'
import { PAGE } from '../../components/SiteHeader'
import { BIZ } from './shared'
import { listCareModules, CareModule } from '../../lib/businessApi'
import { money } from '../../lib/format'

// The OPD and IPD systems, sold as part of the listing rather than alongside it.
//
// Its own file because BusinessLanding was already long and this is a whole
// argument rather than another band of copy: a clinic is not choosing a
// directory here, it is choosing what it runs the day on.
//
// ── THE PRICE IS READ, NEVER ASSERTED ───────────────────────────────────────
// Migration 0082 sets both modules to ₹0 and it is deliberately not on
// production yet — it is held behind an edge-function redeploy. If this section
// simply announced "free", the site would promise something the checkout still
// charges ₹5,000 and ₹10,000 for, which is the worst possible mismatch to ship.
//
// So the headline is derived from care_modules.monthly_price, the same row
// compute-price bills from. Free while it is ₹0, priced while it is not, and it
// flips on its own the moment 0082 reaches production — no deploy, no edit here.
//
// Everything claimed below is something the product actually does today. The
// temptation on a page like this is to describe the roadmap; a doctor who signs
// up on the strength of a bullet and cannot find the screen is a refund and a
// bad review, so the list is deliberately shorter than it could be.

interface Feature { icon: JSX.Element; text: string }

const OPD: Feature[] = [
  { icon: <ListOrdered className="w-4 h-4" />, text: 'Token queue — call the next patient, no crowd at the desk' },
  { icon: <FileText className="w-4 h-4" />,    text: 'Patient records: visits, vitals, allergies, ongoing medicines' },
  { icon: <Pill className="w-4 h-4" />,        text: 'Prescriptions in seconds, sent straight to the patient on WhatsApp' },
  { icon: <Mic className="w-4 h-4" />,         text: 'Speak your notes — they are typed up for you, and the audio is never kept' },
  { icon: <ShieldAlert className="w-4 h-4" />, text: 'Allergy warnings before you prescribe, not after' },
  { icon: <Search className="w-4 h-4" />,      text: 'Find every past patient by diagnosis or procedure, for follow-ups' },
]

const IPD: Feature[] = [
  { icon: <BedDouble className="w-4 h-4" />,      text: 'Admissions and a live bed board, ward by ward' },
  { icon: <ClipboardCheck className="w-4 h-4" />, text: 'Drug chart — what is ordered, what is due, what was actually given' },
  { icon: <Users className="w-4 h-4" />,          text: 'Nurses chart the dose they gave; only doctors can prescribe it' },
  { icon: <FileText className="w-4 h-4" />,       text: 'Discharge summaries written, issued and sent to the family' },
  { icon: <ReceiptText className="w-4 h-4" />,    text: 'Inpatient billing with bed charges posted for you' },
]

// The wider argument: a clinic is not buying two modules, it is putting the
// whole day in one place. Kept to six so it reads as a summary and not a
// feature dump.
const WHOLE = [
  { icon: <Users className="w-5 h-5" />,        t: 'Patients find you',        d: 'Families nearby see you in their WhatsApp options when they need your speciality.' },
  { icon: <CalendarClock className="w-5 h-5" />,t: 'They book without calling', d: 'Appointments arrive over WhatsApp, into one calendar that follows each doctor across your branches.' },
  { icon: <ListOrdered className="w-5 h-5" />,  t: 'The day runs itself',       d: 'Queue in the morning, records during the consult, beds and the drug chart upstairs.' },
  { icon: <FileText className="w-5 h-5" />,     t: 'Paper leaves as a link',    d: 'Prescriptions, bills and discharge summaries go out on WhatsApp and email, and open on any phone.' },
  { icon: <Lock className="w-5 h-5" />,         t: 'Everyone sees their share', d: 'Owner, doctor, nurse, reception and manager each get exactly the screens their job needs — and no more.' },
  { icon: <ReceiptText className="w-5 h-5" />,  t: 'The books stay clean',      d: 'GST invoices for what you pay us, and records kept then deleted on a retention policy you set.' },
]

export default function CareSystems() {
  const [modules, setModules] = useState<CareModule[] | null>(null)
  useEffect(() => { listCareModules().then(setModules).catch(() => setModules([])) }, [])

  const priceOf = (code: string) => modules?.find(m => m.code === code)?.monthly_price ?? null
  const opdPrice = priceOf('opd')
  const ipdPrice = priceOf('ipd')
  // Only claim "free" once both are actually ₹0 in the table that bills them.
  // While modules is still null we say nothing rather than flash a wrong price.
  const bothFree = modules !== null && opdPrice === 0 && ipdPrice === 0

  const priceLabel = (p: number | null) =>
    p === null ? '' : p === 0 ? 'Free' : `${money(p)}/month`

  return (
    <div id="systems" style={{ background: '#fff', borderTop: `1px solid ${BIZ.border}`, borderBottom: `1px solid ${BIZ.border}` }}>
      <div className="mx-auto" style={{ maxWidth: PAGE.maxWidth, padding: 'clamp(30px,7vw,60px) ' + PAGE.padX }}>

        {bothFree && (
          <div style={{ display: 'inline-block', background: BIZ.chipBg, color: BIZ.chipText, fontSize: 13, fontWeight: 800, padding: '6px 12px', borderRadius: 999, marginBottom: 14 }}>
            Included free with your listing
          </div>
        )}

        <h2 style={{ fontSize: 'clamp(25px,6vw,34px)', fontWeight: 800, color: BIZ.ink, margin: '0 0 12px', letterSpacing: '-.025em', maxWidth: 760, lineHeight: 1.15 }}>
          {bothFree
            ? 'Join Sehatsandhi and run your OPD and IPD on us — free.'
            : 'Run your OPD and IPD on Sehatsandhi.'}
        </h2>
        <p style={{ fontSize: 'clamp(15px,4vw,17px)', color: BIZ.muted, lineHeight: 1.6, margin: '0 0 34px', maxWidth: 680 }}>
          Most clinics buy a listing from one company and hospital software from another. Here they are the
          same thing: the patient who finds you on WhatsApp walks into a queue, a record, a prescription and —
          if they are admitted — a bed, a drug chart and a discharge summary.
          {bothFree && ' Both systems are included at no extra charge.'}
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <SystemCard title="OPD system" subtitle="Your outpatient day, end to end"
            price={priceLabel(opdPrice)} features={OPD} />
          <SystemCard title="IPD system" subtitle="Wards, beds and inpatient care"
            price={priceLabel(ipdPrice)} features={IPD} />
        </div>

        <p style={{ fontSize: 13, color: BIZ.mutedWarm, margin: '16px 0 0', lineHeight: 1.6 }}>
          Take one or both — it is a tick box when you register, and you can change your mind later.
          Nothing is installed: it runs in the browser your staff already use.
        </p>

        {/* ── the whole picture ─────────────────────────────────────────── */}
        <div style={{ marginTop: 'clamp(34px,7vw,56px)' }}>
          <h3 style={{ fontSize: 'clamp(21px,5vw,26px)', fontWeight: 800, color: BIZ.ink, margin: '0 0 8px', letterSpacing: '-.02em' }}>
            What you actually get
          </h3>
          <p style={{ fontSize: 15, color: BIZ.muted, margin: '0 0 26px', maxWidth: 620 }}>
            From the patient searching for you to the invoice at the end of the month.
          </p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {WHOLE.map(w => (
              <div key={w.t} style={{ background: BIZ.cream, border: `1px solid ${BIZ.border}`, borderRadius: 16, padding: 'clamp(18px,4vw,22px)' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: BIZ.chipBg, color: BIZ.chipText, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 13 }}>
                  {w.icon}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: BIZ.ink, marginBottom: 6 }}>{w.t}</div>
                <div style={{ fontSize: 13.5, color: BIZ.muted, lineHeight: 1.6 }}>{w.d}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 'clamp(28px,6vw,40px)', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link to="/business/register" className="max-sm:w-full max-sm:justify-center max-sm:flex"
            style={{ background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 16, padding: '15px 26px', borderRadius: 14, textAlign: 'center' }}>
            {bothFree ? 'Get it free — register your clinic' : 'Register your clinic'}
          </Link>
          <a href="#pricing" style={{ fontSize: 14, fontWeight: 700, color: BIZ.green }}>What the listing costs →</a>
        </div>
      </div>
    </div>
  )
}

function SystemCard({ title, subtitle, price, features }: {
  title: string; subtitle: string; price: string; features: Feature[]
}) {
  const free = price === 'Free'
  return (
    <div style={{
      background: BIZ.cream, border: `1px solid ${free ? '#cfe8dc' : BIZ.border}`,
      borderRadius: 20, padding: 'clamp(22px,5vw,28px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontSize: 19, fontWeight: 800, color: BIZ.ink }}>{title}</span>
        {price && (
          <span style={{
            fontSize: free ? 14 : 15, fontWeight: 800, whiteSpace: 'nowrap',
            color: free ? BIZ.chipText : BIZ.ink,
            background: free ? BIZ.chipBg : 'transparent',
            padding: free ? '4px 11px' : 0, borderRadius: 999,
          }}>{price}</span>
        )}
      </div>
      <div style={{ fontSize: 13.5, color: BIZ.mutedWarm, marginBottom: 18 }}>{subtitle}</div>
      <ul style={{ display: 'grid', gap: 11, margin: 0, padding: 0, listStyle: 'none' }}>
        {features.map(f => (
          <li key={f.text} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <span style={{ color: BIZ.green, flex: '0 0 auto', marginTop: 1 }}>{f.icon}</span>
            <span style={{ fontSize: 14, color: '#3f4a44', lineHeight: 1.55 }}>{f.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
