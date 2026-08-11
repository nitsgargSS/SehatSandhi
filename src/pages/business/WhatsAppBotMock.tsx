import { useState } from 'react'

// Interactive stand-in for the real AISensy WhatsApp booking thread, used for
// demos while the integration is built. Tap the reply chips to walk the whole
// journey: Find Clinic → clinic type → speciality → clinics near your pincode →
// slot → confirm. This is a visual demo — it is NOT wired to the booking backend.
//
// State is one array of the choices made so far (`path`), not a step counter.
// That is what makes "← Back" a single pop and "↺ Restart" an empty array, and
// it means the transcript below can be derived from scratch on every render
// instead of being appended to — so going back genuinely un-says a message
// rather than leaving an orphaned bubble behind.

export interface Clinic {
  name: string
  doc: string
  /** locality shown on the card, e.g. "Model Town" */
  spot: string
  pin: string
  dist: string
  fee: number
  rating: string
}

// Illustrative only — none of these clinics exist. The localities are the
// generic ones found in almost every Indian town (Model Town, Civil Lines,
// Main Market) rather than real towns of ours, so the demo reads the same to a
// business in any district we open in.
//
// The pincodes are deliberately not real either. Nothing in the demo depends on
// their value — only on which clinics share one with the patient, which is what
// drives the ranking below.
const PIN_A = '100001'
const PIN_B = '100002'
const PIN_C = '100003'

const CATS = ['Eye', 'Dental', 'Skin', 'Heart', 'ENT', 'Child'] as const

const SPECS: Record<string, string[]> = {
  Eye: ['Cataract', 'Vision / Glasses', 'Retina', 'Glaucoma'],
  Dental: ['Root Canal', 'Braces', 'Cleaning', 'Tooth Pain'],
  Skin: ['Acne', 'Hair Fall', 'Allergy', 'Skin Check'],
  Heart: ['Chest Pain', 'BP Check', 'ECG / Echo', 'Follow-up'],
  ENT: ['Ear Pain', 'Sinus', 'Throat', 'Hearing Test'],
  Child: ['Vaccination', 'Fever', 'Growth Check', 'Newborn Care'],
}

// Demo data only. Real listings come from the businesses/doctors tables,
// filtered by the pincodes a clinic has actually bought.
const CLINICS: Record<string, Clinic[]> = {
  Eye: [
    { name: 'Aggarwal Eye Care', doc: 'Dr. Meena Aggarwal', spot: 'Model Town', pin: PIN_A, dist: '1.2 km', fee: 300, rating: '4.6' },
    { name: 'Jain Netralaya', doc: 'Dr. Vivek Jain', spot: 'Civil Lines', pin: PIN_B, dist: '3.4 km', fee: 350, rating: '4.4' },
    { name: 'City Vision Centre', doc: 'Dr. S. Nagpal', spot: 'Station Road', pin: PIN_C, dist: '2.1 km', fee: 250, rating: '4.2' },
  ],
  Dental: [
    { name: 'Sethi Dental Care', doc: 'Dr. Rakesh Sethi', spot: 'Model Town', pin: PIN_A, dist: '0.9 km', fee: 250, rating: '4.7' },
    { name: 'Smile Dental Studio', doc: 'Dr. Anita Rao', spot: 'Main Market', pin: PIN_B, dist: '2.6 km', fee: 400, rating: '4.5' },
  ],
  Skin: [
    { name: 'SkinGlow Clinic', doc: 'Dr. Priya Bansal', spot: 'Ram Nagar', pin: PIN_B, dist: '1.8 km', fee: 400, rating: '4.8' },
    { name: 'DermaCare', doc: 'Dr. Karan Mehta', spot: 'Model Town', pin: PIN_A, dist: '2.4 km', fee: 350, rating: '4.3' },
  ],
  Heart: [
    { name: 'Gupta Heart Centre', doc: 'Dr. S. K. Gupta', spot: 'Civil Lines', pin: PIN_A, dist: '2.2 km', fee: 600, rating: '4.9' },
    { name: 'LifeLine Heart', doc: 'Dr. Neha Verma', spot: 'Sector 17', pin: PIN_C, dist: '4.1 km', fee: 550, rating: '4.6' },
  ],
  ENT: [
    { name: 'Sethi ENT Clinic', doc: 'Dr. Rakesh Sethi', spot: 'Main Market', pin: PIN_B, dist: '3.1 km', fee: 250, rating: '4.5' },
    { name: 'City ENT', doc: 'Dr. Anita Rao', spot: 'Station Road', pin: PIN_A, dist: '1.6 km', fee: 300, rating: '4.4' },
  ],
  Child: [
    { name: 'Little Steps Child Care', doc: 'Dr. Ritu Saini', spot: 'Model Town', pin: PIN_A, dist: '1.1 km', fee: 300, rating: '4.8' },
    { name: 'Bal Arogya Clinic', doc: 'Dr. P. Chauhan', spot: 'Ram Nagar', pin: PIN_C, dist: '5.2 km', fee: 200, rating: '4.3' },
  ],
}

const SLOTS = ['Today 5:00 PM', 'Today 6:30 PM', 'Tomorrow 11:00 AM', 'Tomorrow 4:00 PM']

// The localities a demo can be run from, and the pincode each maps to. Generic
// for the same reason the clinics are: a business in any district we open in
// should see its own town in this, not ours.
const AREA_PIN: Record<string, string> = {
  'Model Town': PIN_A,
  'Civil Lines': PIN_B,
  'Station Road': PIN_C,
}

/** Areas the demo can be run from. First entry is the default. */
export const AREAS = Object.keys(AREA_PIN)

// The existing appointment the "Check Appointments" branch acts on.
const BOOKED = { ref: 'SS-4712', clinic: 'Aggarwal Eye Care', doc: 'Dr. Meena Aggarwal', reason: 'Cataract check', time: 'Tomorrow, 11:00 AM', fee: 300, spot: 'Model Town', pin: PIN_A }

interface Msg { text: string; time: string; mine: boolean }
interface Chip { label: string; onClick: () => void }

export interface WhatsAppBotMockProps {
  /** Patient's area. Maps to the pincode used in the bot's copy and clinic ranking. */
  area?: string
  /**
   * Conversation state, for the two-phone demo where the left phone's button
   * opens the thread and the header chevron closes it. Controlled only when
   * `onClose` is passed — on its own (as on /business) the mock is always open,
   * so the first question is visible on load without scrolling.
   */
  onClose?: () => void
  /** Bumping this resets the thread — the left phone's "Book on WhatsApp" tap. */
  restartKey?: number
}

export default function WhatsAppBotMock({ area = AREAS[0], onClose, restartKey = 0 }: WhatsAppBotMockProps) {
  const [path, setPath] = useState<string[]>([])

  // A fresh tap of "Book on WhatsApp" starts the conversation over. Keyed off a
  // counter rather than an effect so the reset happens during render, with no
  // intermediate frame showing the previous thread.
  const [seenKey, setSeenKey] = useState(restartKey)
  if (seenKey !== restartKey) {
    setSeenKey(restartKey)
    setPath([])
  }

  const push = (v: string) => setPath(p => [...p, v])
  const back = () => setPath(p => p.slice(0, -1))
  const restart = () => setPath([])

  const areaPin = AREA_PIN[area] || PIN_A
  const [menu, cat, spec, clinicName, slot, done] = path

  // Clinics for the chosen category, ranked so the patient's own pincode comes
  // first and the rest follow by distance.
  //
  // Deliberately a ranking and not an exact-pincode filter. With this handful of
  // fixtures a strict match empties several area/category pairs — pick the wrong
  // pair and the demo dead-ends on an empty list mid-flow. Ranking keeps local
  // clinics at the top, which is the point being demonstrated, while every path
  // stays walkable. The real listing query filters hard on purchased pincodes;
  // it has a whole district to draw on.
  const list = [...(CLINICS[cat] || [])].sort((a, b) => {
    const local = Number(b.pin === areaPin) - Number(a.pin === areaPin)
    return local || parseFloat(a.dist) - parseFloat(b.dist)
  })
  const clinic = list.find(c => c.name === clinicName)

  // ── transcript ────────────────────────────────────────────────────────────
  // Rebuilt from `path` on every render. Timestamps advance every third bubble
  // so a long thread doesn't read as if it all happened in one minute.
  const msgs: Msg[] = []
  let tick = 0
  const clock = () => {
    tick++
    return '10:' + String(1 + Math.floor(tick / 3)).padStart(2, '0')
  }
  const bot = (text: string) => msgs.push({ text, time: clock(), mine: false })
  const me = (text: string) => msgs.push({ text, time: clock(), mine: true })

  bot('Namaste 🙏 Main Sehatsandhi assistant hoon. Aap kya karna chahenge?')
  if (menu) me(menu)

  if (menu === 'Check Appointments') {
    const act = path[1]
    bot('Aapki ek aane wali appointment hai:')
    if (act) me(act)
    if (act === 'Reschedule') {
      bot(`Theek hai. ${BOOKED.clinic} ke naye slots:`)
      if (path[2]) {
        me(path[2])
        bot(`Ho gaya! Appointment ${BOOKED.ref} ab ${path[2]} par hai. Nayi parchi WhatsApp par bhej di gayi hai.`)
      }
    } else if (act === 'Cancel booking') {
      bot(`Aap ${BOOKED.ref} (${BOOKED.clinic}, ${BOOKED.time}) cancel karna chahte hain?`)
      if (path[2] === 'Yes, cancel') {
        me('Yes, cancel')
        bot(`Booking ${BOOKED.ref} cancel ho gayi. Clinic ko soochit kar diya gaya hai. Nayi appointment kabhi bhi book kar sakte hain.`)
      } else if (path[2] === 'Keep it') {
        me('Keep it')
        bot(`Bilkul, aapki appointment waise hi rahegi. Milte hain ${BOOKED.time} par!`)
      }
    }
  } else if (menu === 'Find Clinic') {
    bot('Theek hai. Kis tarah ka clinic chahiye?')
    if (cat) {
      me(cat)
      bot(`${cat} mein kya problem hai? Speciality chuniye.`)
    }
    if (spec) {
      me(spec)
      bot(`${area} ke aas-paas (${areaPin}) verified ${cat.toLowerCase()} clinics:`)
    }
    if (clinic) {
      me(clinic.name)
      bot(`${clinic.name} — ${clinic.doc}. Available slots:`)
    }
    if (slot) me(slot)
    if (slot && clinic && !done) {
      bot(`Confirm kijiye: ${spec} — ${clinic.name}, ${slot}. Fee ₹${clinic.fee}.`)
    }
    if (done) {
      me('Confirm ✓')
      bot('Booked! Reference SS-4821. Aapko SMS aur WhatsApp par reminder milega. Clinic par yeh chat dikha dijiye.')
    }
  }

  // ── quick replies ─────────────────────────────────────────────────────────
  // Exactly one branch runs, so the chip row always reflects the current step.
  const chips: Chip[] = []
  const opt = (label: string): Chip => ({ label, onClick: () => push(label) })

  if (!menu) {
    chips.push(opt('Find Clinic'), opt('Check Appointments'))
  } else if (menu === 'Check Appointments') {
    const act = path[1]
    if (!act) chips.push(opt('Reschedule'), opt('Cancel booking'))
    else if (act === 'Reschedule') {
      if (!path[2]) SLOTS.forEach(s => chips.push(opt(s)))
    } else if (act === 'Cancel booking') {
      if (!path[2]) chips.push(opt('Yes, cancel'), opt('Keep it'))
    }
  } else if (!cat) CATS.forEach(c => chips.push(opt(c)))
  else if (!spec) (SPECS[cat] || []).forEach(s => chips.push(opt(s)))
  else if (!clinic) { /* the clinic cards render in the thread instead */ }
  else if (!slot) SLOTS.forEach(s => chips.push(opt(s)))
  else if (!done) chips.push(opt('Confirm ✓'))

  // Once a branch has run to its end there is nothing left to pick, so offer the
  // way out rather than an empty chip row. Both reset, but the booking flow says
  // "Book another" because that is the action a patient would actually want next.
  const terminalChip =
    done ? 'Book another'
    : menu === 'Check Appointments' && !!path[1] && !!path[2] ? '⌂ Main menu'
    : null
  if (terminalChip) chips.push({ label: terminalChip, onClick: restart })

  const showClinics = menu === 'Find Clinic' && !!spec && !clinic

  // The appointment card sticks around through the Check Appointments branch so
  // the patient can see what they are rescheduling, and disappears once cancelled.
  const cancelled = menu === 'Check Appointments' && path[1] === 'Cancel booking' && path[2] === 'Yes, cancel'
  const newTime = menu === 'Check Appointments' && path[1] === 'Reschedule' ? path[2] : undefined
  const showAppt = menu === 'Check Appointments' && !cancelled

  const stage = !menu ? 'Main menu'
    : menu === 'Check Appointments' ? (!path[1] ? 'My appointments' : path[2] ? 'Done' : path[1])
    : !cat ? 'Clinic type'
    : !spec ? 'Speciality'
    : !clinic ? 'Nearby clinics'
    : !slot ? 'Choose slot'
    : !done ? 'Confirm' : 'Booked'

  const idle = path.length === 0
  const navStyle = (on: boolean) => ({
    background: on ? '#fff' : 'transparent',
    border: `1px solid ${on ? '#c2d6cc' : '#ded7c9'}`,
    color: on ? '#3f5c50' : '#b3ab9c',
    fontWeight: 700, fontSize: 12, padding: '6px 11px', borderRadius: 999,
    fontFamily: 'inherit', flex: '0 0 auto',
    cursor: on ? 'pointer' : 'default',
  })

  // The frame caps at the 390px design width but shrinks with the viewport, so
  // it never forces the page to scroll sideways on a small handset.
  return (
    <div style={{ width: '100%', maxWidth: 390, background: '#0b0f14', borderRadius: 'clamp(34px,9vw,48px)', padding: 'clamp(9px,2.5vw,13px)', boxShadow: '0 40px 90px -30px rgba(2,6,23,.6)', fontFamily: "'Manrope','Noto Sans Devanagari',system-ui,sans-serif" }}>
      <div style={{ position: 'relative', background: '#ECE4DC', borderRadius: 'clamp(26px,7vw,38px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ background: '#075E54', paddingTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px clamp(16px,5vw,26px) 2px', fontSize: 13, fontWeight: 700, color: '#fff' }}>
            <span>9:41</span>
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 11, width: 'clamp(84px,28vw,112px)', height: 26, background: '#0b0f14', borderRadius: '0 0 16px 16px' }} />
            <span style={{ letterSpacing: 2 }}>●●●● ▮</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 12px' }}>
            {onClose
              ? <button onClick={onClose} aria-label="Close chat" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flex: '0 0 auto' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}><path d="m15 6-6 6 6 6" /></svg>
                </button>
              : <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22, flex: '0 0 auto' }}><path d="m15 6-6 6 6 6" /></svg>}
            {/* White avatar disc holding the logo mark, as WhatsApp shows a business DP. */}
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', overflow: 'hidden' }}>
              <img src="/logo-only-symbol.png" alt="" aria-hidden style={{ width: 30, height: 30, objectFit: 'contain', display: 'block' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>Sehatsandhi</div>
              <div style={{ fontSize: 12, color: '#bfe0d7' }}>online</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ width: 21, height: 21 }}><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
          </div>
        </div>

        {/* stage label + step navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', background: '#f4efe6', borderBottom: '1px solid #e2dccf' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: '#8a8172', flex: 1, minWidth: 0 }}>{stage}</span>
          <button onClick={back} disabled={idle} style={navStyle(!idle)}>← Back</button>
          <button onClick={restart} disabled={idle} style={navStyle(!idle)}>↺ Restart</button>
        </div>

        {/* chat body */}
        <div style={{ flex: 1, padding: '16px 12px 8px', background: '#ECE4DC', backgroundImage: 'radial-gradient(rgba(255,255,255,.35) 1px,transparent 1px)', backgroundSize: '22px 22px', minHeight: 430 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <span style={{ background: '#d7ecf3', color: '#3a6b7a', fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 8, boxShadow: '0 1px .5px rgba(0,0,0,.1)' }}>Today · End-to-end encrypted</span>
          </div>

          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', marginBottom: 8, justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '84%', padding: '8px 11px 7px', borderRadius: 12, fontSize: 14, lineHeight: 1.45, color: '#0b141a', boxShadow: '0 1px .5px rgba(0,0,0,.13)', background: m.mine ? '#d9fdd3' : '#fff' }}>
                {m.text}
                <span style={{ fontSize: 10, color: '#667781', marginLeft: 8, float: 'right', position: 'relative', top: 4 }}>{m.time}</span>
              </div>
            </div>
          ))}

          {/* clinic cards — the "businesses near your pincode" step */}
          {showClinics && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '2px 0 8px' }}>
              {list.map(c => (
                <div key={c.name} style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px .5px rgba(0,0,0,.13)', maxWidth: '90%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: '#0b141a' }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: '#667781', marginTop: 2 }}>{c.doc}</div>
                      <div style={{ fontSize: 11.5, color: '#8a9199', marginTop: 3 }}>{c.spot} · {c.pin} · {c.dist}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flex: '0 0 auto' }}>
                      <span style={{ background: '#e7f6ef', color: '#0b7d57', fontSize: 12, fontWeight: 800, padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>₹{c.fee}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#b8860b' }}>★ {c.rating}</span>
                    </div>
                  </div>
                  <button onClick={() => push(c.name)} style={{ width: '100%', marginTop: 11, background: '#0E9F6E', color: '#fff', fontWeight: 800, fontSize: 13.5, padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Select this clinic</button>
                </div>
              ))}
            </div>
          )}

          {/* the patient's existing booking, for the Check Appointments branch */}
          {showAppt && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 13, boxShadow: '0 1px .5px rgba(0,0,0,.13)', maxWidth: '90%', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14.5, fontWeight: 800, color: '#0b141a' }}>{BOOKED.clinic}</span>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 8, whiteSpace: 'nowrap', ...(newTime ? { background: '#fff4e0', color: '#a15c00' } : { background: '#e7f6ef', color: '#0b7d57' }) }}>
                  {newTime ? 'RESCHEDULED' : 'CONFIRMED'}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: '#667781', marginTop: 4 }}>{BOOKED.doc} · {BOOKED.reason}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0b141a', marginTop: 8 }}>{newTime || BOOKED.time} · ₹{BOOKED.fee}</div>
              <div style={{ fontSize: 11.5, color: '#8a9199', marginTop: 3 }}>{BOOKED.spot}, {BOOKED.pin} · Ref {BOOKED.ref}</div>
            </div>
          )}
        </div>

        {/* quick replies */}
        <div style={{ padding: '6px 12px', background: '#ECE4DC', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          {chips.map(q => {
            // Terminal actions are teal-filled; ordinary replies are white pills.
            const isTerminal = q.label === terminalChip
            return (
              <button key={q.label} onClick={q.onClick} style={{ background: isTerminal ? '#0E9F6E' : '#fff', border: `1px solid ${isTerminal ? '#0E9F6E' : '#c9e3d6'}`, color: isTerminal ? '#fff' : '#075E54', fontWeight: isTerminal ? 800 : 700, fontSize: 13.5, padding: '9px 15px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px .5px rgba(0,0,0,.1)' }}>{q.label}</button>
            )
          })}
        </div>

        {/* input bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 22px', background: '#ECE4DC' }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 22, padding: '11px 16px', color: '#8a9199', fontSize: 14, boxShadow: '0 1px .5px rgba(0,0,0,.1)' }}>Type a message</div>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#0E9F6E', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flex: '0 0 auto' }}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }}><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z" /></svg>
          </div>
        </div>
      </div>
    </div>
  )
}
