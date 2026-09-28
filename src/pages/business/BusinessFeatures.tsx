import { Link } from 'react-router-dom'
import {
  CalendarDays, UserRound, CalendarClock, Pill, IndianRupee, BarChart3,
  ShieldCheck, Megaphone, Sparkles,
} from 'lucide-react'
import { PAGE } from '../../components/SiteHeader'
import { BIZ } from './shared'

// "Everything your practice runs on" — the full feature list, after the OPD/IPD
// section (CareSystems) has made the core argument.
//
// Same rule as CareSystems: every line is something the product does in
// production today (checked 28 Sep 2026 against the live migrations 0072–0165).
// A clinic that signs up for a bullet and cannot find the screen is a refund.
// Things built but switched off (voice notes, WhatsApp number verification) are
// not listed until they are on.

interface Group {
  icon: JSX.Element
  tint: string
  title: string
  lead: string
  points: string[]
  isNew?: boolean
}

const GROUPS: Group[] = [
  {
    icon: <CalendarDays className="w-5 h-5" />, tint: '#2563EB',
    title: 'Doctors who work at more than one place',
    lead: 'One doctor, several clinics and hospitals — one calendar.',
    points: [
      'A doctor is never booked in two places at the same time',
      'Leave for one clinic or for all of them, and nobody is booked into it',
      'The whole week across every clinic, on one screen',
      'Join a second clinic by invitation, with the same login',
    ],
    isNew: true,
  },
  {
    icon: <UserRound className="w-5 h-5" />, tint: '#0E9F6E',
    title: 'Your own practice, in one place',
    lead: 'A personal workspace for every doctor — your patients, not just the clinic\'s.',
    points: [
      'Your patients, today\'s appointments and your OPD fee',
      'What you earned — consultations and charges on patients admitted under you',
      'Free and discounted consultations, each with the reason',
      'Your nurses, your week and your leave',
    ],
  },
  {
    icon: <CalendarClock className="w-5 h-5" />, tint: '#7C3AED',
    title: 'Appointments and the front desk',
    lead: 'Bookings arrive on their own; the desk handles the rest.',
    points: [
      'Patients book on WhatsApp, in Hindi or English, any time of day',
      'Reception books walk-ins and phone calls at the desk',
      'A QR poster for your clinic — scan it to book with you',
      'Patients who book on WhatsApp are asked to rate the visit, so good care is seen',
    ],
  },
  {
    icon: <Pill className="w-5 h-5" />, tint: '#DB2777',
    title: 'In-house pharmacy',
    lead: 'For clinics that hand medicines over at their own counter.',
    points: [
      'Stock by batch and expiry — the oldest is sold first, expired never',
      'Dispense straight from the doctor\'s prescription, or to a walk-in',
      'GST bills if your pharmacy is registered, plain bills if it is not',
      'Part payments, patient dues, returns and a full stock history',
    ],
    isNew: true,
  },
  {
    icon: <IndianRupee className="w-5 h-5" />, tint: '#D97706',
    title: 'Billing that tallies',
    lead: 'Every rupee accounted for, and by whom.',
    points: [
      'OPD and IPD bills, with discounts that need a reason',
      'Cash, UPI, credit card and debit card — with the name of who took it',
      'Refund a fee in one step, and take it off the patient\'s account',
      'Collections by person and by method, to match the cash drawer',
    ],
    isNew: true,
  },
  {
    icon: <BarChart3 className="w-5 h-5" />, tint: '#0891B2',
    title: 'Reports to grow on',
    lead: 'Know who comes, from where, and who has stopped coming.',
    points: [
      'Total, new and returning patients — by day, week, month or year',
      'Where patients come from, by PIN code and town; age, gender and source',
      'Revenue by period, discounts given, and the pharmacy\'s GST summary',
      'Follow-ups due, and a list of patients to invite back',
    ],
    isNew: true,
  },
  {
    icon: <ShieldCheck className="w-5 h-5" />, tint: '#475569',
    title: 'Your team, under control',
    lead: 'Everyone sees their share of the work — and nothing else.',
    points: [
      'Owner, manager, doctor, nurse and reception each get their own screens',
      'Adding or removing staff is confirmed by a code emailed to you',
      'One mobile number, one person — no shared or borrowed logins',
      'Every search of patient records is logged',
    ],
  },
  {
    icon: <Megaphone className="w-5 h-5" />, tint: '#DC2626',
    title: 'Reach new patients',
    lead: 'Be found by families nearby, where they already are.',
    points: [
      'Listed for the pincodes around you, on WhatsApp and the web',
      'WhatsApp messages to your own patients — health camps, reminders, offers (add-on)',
      'Prescriptions, bills and discharge summaries sent as a link to any phone',
      'Nothing to install — it runs in the browser your staff already use',
    ],
  },
]

export default function BusinessFeatures() {
  return (
    <div id="features" style={{ scrollMarginTop: 90 }}>
      <div className="mx-auto" style={{ maxWidth: PAGE.maxWidth, padding: 'clamp(30px,7vw,60px) ' + PAGE.padX }}>
        <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto clamp(26px,5vw,40px)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: BIZ.chipBg, color: BIZ.chipText, fontSize: 13, fontWeight: 800, padding: '6px 12px', borderRadius: 999, marginBottom: 14 }}>
            <Sparkles className="w-4 h-4" /> Everything in one place
          </div>
          <h2 style={{ fontSize: 'clamp(25px,6vw,36px)', fontWeight: 800, color: BIZ.ink, margin: '0 0 12px', letterSpacing: '-.025em', lineHeight: 1.15 }}>
            The whole practice runs on Sehatsandhi
          </h2>
          <p style={{ fontSize: 'clamp(15px,4vw,17px)', color: BIZ.muted, lineHeight: 1.6, margin: 0 }}>
            From the first WhatsApp message to the last rupee at closing — appointments across clinics, the doctor's own
            practice, the pharmacy counter, billing and the reports that show you where to grow.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map(g => (
            <div key={g.title} style={{
              background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 18,
              padding: 'clamp(20px,4vw,24px)', position: 'relative', display: 'flex', flexDirection: 'column',
            }}>
              {g.isNew && (
                <span style={{ position: 'absolute', top: 16, right: 16, background: BIZ.ink, color: '#fff', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 999 }}>
                  NEW
                </span>
              )}
              <div style={{ width: 42, height: 42, borderRadius: 12, background: `${g.tint}14`, color: g.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                {g.icon}
              </div>
              <div style={{ fontSize: 16.5, fontWeight: 800, color: BIZ.ink, lineHeight: 1.3, paddingRight: g.isNew ? 44 : 0 }}>{g.title}</div>
              <div style={{ fontSize: 13.5, color: BIZ.mutedWarm, margin: '6px 0 12px', lineHeight: 1.5 }}>{g.lead}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                {g.points.map(pt => (
                  <li key={pt} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: '#3f4a44', lineHeight: 1.5 }}>
                    <span style={{ color: g.tint, fontWeight: 800, flex: '0 0 auto' }}>✓</span><span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 'clamp(24px,5vw,36px)', background: BIZ.green, borderRadius: 20,
          padding: 'clamp(22px,5vw,30px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 18, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 'clamp(18px,4.5vw,22px)', fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>
              One login. Every clinic. The whole day.
            </div>
            <div style={{ fontSize: 14.5, color: '#d6f2e6', marginTop: 6 }}>
              The OPD and IPD systems are included — register once and switch on what you need.
            </div>
          </div>
          <Link to="/business/register" className="max-sm:w-full max-sm:justify-center max-sm:flex"
            style={{ background: '#fff', color: BIZ.green, fontWeight: 800, fontSize: 15.5, padding: '14px 24px', borderRadius: 14, textAlign: 'center' }}>
            Register your clinic →
          </Link>
        </div>
      </div>
    </div>
  )
}
