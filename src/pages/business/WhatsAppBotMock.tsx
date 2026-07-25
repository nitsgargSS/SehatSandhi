import { useState } from 'react'

// Interactive mockup of the AISensy-powered WhatsApp booking thread (design 3a).
// Tap the reply chips to walk the full doctor booking; "Book another" restarts.
// This is a visual demo — it is NOT wired to the real booking backend.

interface Doctor { name: string; spec: string; fee: number; clinic: string }

const DOCS: Record<string, Doctor[]> = {
  Eye: [
    { name: 'Dr. Meena Aggarwal', spec: 'Ophthalmologist', fee: 300, clinic: 'Aggarwal Eye Care, Model Town' },
    { name: 'Dr. Vivek Jain', spec: 'Eye Surgeon', fee: 350, clinic: 'Jain Netralaya, Jagadhri' },
  ],
  ENT: [
    { name: 'Dr. Rakesh Sethi', spec: 'ENT Specialist', fee: 250, clinic: 'Sethi ENT Clinic, Jagadhri' },
    { name: 'Dr. Anita Rao', spec: 'ENT Surgeon', fee: 300, clinic: 'City ENT, Yamunanagar' },
  ],
  Skin: [
    { name: 'Dr. Priya Bansal', spec: 'Dermatologist', fee: 400, clinic: 'SkinGlow Clinic, Yamunanagar' },
    { name: 'Dr. Karan Mehta', spec: 'Skin & Hair', fee: 350, clinic: 'DermaCare, Model Town' },
  ],
  Heart: [
    { name: 'Dr. S. K. Gupta', spec: 'Cardiologist', fee: 600, clinic: 'Gupta Heart Centre, Yamunanagar' },
    { name: 'Dr. Neha Verma', spec: 'Cardiologist', fee: 550, clinic: 'LifeLine Heart, Jagadhri' },
  ],
  Cancer: [
    { name: 'Dr. A. Khanna', spec: 'Oncologist', fee: 700, clinic: 'City Cancer Care, Jagadhri' },
    { name: 'Dr. R. Iyer', spec: 'Medical Oncologist', fee: 750, clinic: 'Hope Onco Centre, Yamunanagar' },
  ],
}

interface Msg { text: string; time: string; mine: boolean }
interface Chip { label: string; onClick: () => void }

export default function WhatsAppBotMock({ area = 'Yamunanagar' }: { area?: string }) {
  const [step, setStep] = useState(0)
  const [cat, setCat] = useState<string | null>(null)
  const [spec, setSpec] = useState<string | null>(null)
  const [doc, setDoc] = useState<Doctor | null>(null)
  const [slot, setSlot] = useState<string | null>(null)

  const reset = () => { setStep(0); setCat(null); setSpec(null); setDoc(null); setSlot(null) }

  // Build the transcript from current state (ported from the design's renderVals)
  const msgs: Msg[] = []
  const bot = (text: string, time = '10:02') => msgs.push({ text, time, mine: false })
  const me = (text: string, time = '10:02') => msgs.push({ text, time, mine: true })

  bot('Namaste! I am the Sehatsandhi assistant. What do you need help with today?', '10:01')
  if (cat) me(cat, '10:01')
  if (step === 99) bot(`Got it. Our team will WhatsApp you about ${cat} in ${area} shortly.`, '10:01')
  if (step >= 1 && step !== 99) {
    bot('Sure. Which kind of doctor do you need? We have 20 specialities.', '10:01')
    if (spec) me(spec, '10:02')
    if (step >= 2) bot(`Here are verified ${spec} doctors near ${area}:`, '10:02')
    if (doc) me(`Book ${doc.name}`, '10:02')
    if (step >= 3 && doc) bot(`${doc.name} is available at these times. Pick one:`, '10:02')
    if (slot) me(slot, '10:03')
    if (step >= 4 && doc) bot(`Please confirm: ${spec} appointment with ${doc.name} — ${slot}. Consultation fee Rs ${doc.fee} at ${doc.clinic}.`, '10:03')
    if (step >= 5) {
      me('Confirm', '10:03')
      bot('Booked! Your appointment is confirmed. You will get an SMS and WhatsApp reminder before your visit. Please show this chat at the clinic.', '10:03')
    }
  }

  const showDocs = step === 2
  const docList = DOCS[spec || 'Eye'] || DOCS.Eye

  let chips: Chip[] = []
  if (step === 0) {
    chips = [
      { label: 'Doctor', onClick: () => { setCat('Doctor'); setStep(1) } },
      { label: 'Medicine', onClick: () => { setCat('Medicine'); setStep(99) } },
      { label: 'Lab Test', onClick: () => { setCat('Lab Test'); setStep(99) } },
      { label: 'Ambulance', onClick: () => { setCat('Ambulance'); setStep(99) } },
    ]
  } else if (step === 1) {
    chips = ['Eye', 'ENT', 'Skin', 'Heart', 'Cancer'].map(s => ({ label: s, onClick: () => { setSpec(s); setStep(2) } }))
  } else if (step === 3) {
    chips = ['Today 5:00 PM', 'Today 6:30 PM', 'Tomorrow 11:00 AM', 'Tomorrow 4:00 PM'].map(s => ({ label: s, onClick: () => { setSlot(s); setStep(4) } }))
  } else if (step === 4) {
    chips = [
      { label: 'Confirm ✓', onClick: () => setStep(5) },
      { label: 'Change time', onClick: () => { setStep(3); setSlot(null) } },
    ]
  } else if (step === 5 || step === 99) {
    chips = [{ label: 'Book another', onClick: reset }]
  }

  return (
    <div style={{ width: 390, background: '#0b0f14', borderRadius: 48, padding: 13, boxShadow: '0 40px 90px -30px rgba(2,6,23,.6)', fontFamily: "'Manrope','Noto Sans Devanagari',system-ui,sans-serif" }}>
      <div style={{ position: 'relative', background: '#ECE4DC', borderRadius: 38, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ background: '#075E54', paddingTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 26px 2px', fontSize: 13, fontWeight: 700, color: '#fff' }}>
            <span>9:41</span>
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 11, width: 112, height: 26, background: '#0b0f14', borderRadius: '0 0 16px 16px' }} />
            <span style={{ letterSpacing: 2 }}>●●●● ▮</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 14px 12px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22, flex: '0 0 auto' }}><path d="m15 6-6 6 6 6" /></svg>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#0E9F6E', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flex: '0 0 auto' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" style={{ width: 22, height: 22 }}><path d="M12 5v14M5 12h14" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>Sehatsandhi</div>
              <div style={{ fontSize: 12, color: '#bfe0d7' }}>online</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ width: 21, height: 21 }}><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
          </div>
        </div>

        {/* chat body */}
        <div style={{ flex: 1, padding: '16px 12px 8px', background: '#ECE4DC', backgroundImage: 'radial-gradient(rgba(255,255,255,.35) 1px,transparent 1px)', backgroundSize: '22px 22px', minHeight: 430 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <span style={{ background: '#d7ecf3', color: '#3a6b7a', fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 8, boxShadow: '0 1px .5px rgba(0,0,0,.1)' }}>Today · End-to-end encrypted</span>
          </div>

          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', marginBottom: 8, justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '82%', padding: '7px 10px 6px', borderRadius: 12, fontSize: 14, lineHeight: 1.45, color: '#0b141a', boxShadow: '0 1px .5px rgba(0,0,0,.13)', background: m.mine ? '#d9fdd3' : '#fff' }}>
                {m.text}
                <span style={{ fontSize: 10, color: '#667781', marginLeft: 8, float: 'right', position: 'relative', top: 4 }}>{m.time}</span>
              </div>
            </div>
          ))}

          {showDocs && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '2px 0 8px' }}>
              {docList.map((d, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px .5px rgba(0,0,0,.13)', maxWidth: '88%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: '#0b141a' }}>{d.name}</div>
                      <div style={{ fontSize: 12, color: '#667781', marginTop: 2 }}>{d.spec} · {d.clinic}</div>
                    </div>
                    <span style={{ background: '#e7f6ef', color: '#0b7d57', fontSize: 12, fontWeight: 800, padding: '4px 9px', borderRadius: 8, whiteSpace: 'nowrap' }}>Rs {d.fee}</span>
                  </div>
                  <button onClick={() => { setDoc(d); setStep(3) }} style={{ width: '100%', marginTop: 11, background: '#0E9F6E', color: '#fff', fontWeight: 800, fontSize: 13.5, padding: 10, borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Select &amp; book</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* quick replies */}
        <div style={{ padding: '6px 12px', background: '#ECE4DC', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
          {chips.map((q, i) => (
            <button key={i} onClick={q.onClick} style={{ background: '#fff', border: '1px solid #c9e3d6', color: '#075E54', fontWeight: 700, fontSize: 13.5, padding: '9px 15px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px .5px rgba(0,0,0,.1)' }}>{q.label}</button>
          ))}
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
