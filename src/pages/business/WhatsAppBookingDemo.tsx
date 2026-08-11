import { useState } from 'react'
import WhatsAppBotMock, { AREAS } from './WhatsAppBotMock'

// Standalone presentation view of the WhatsApp booking journey, for showing
// stakeholders what the AISensy thread will do before the integration lands.
//
// Everything here is a local fixture — no Supabase, no network, nothing to set
// up before a demo. The area picker below is this page's own state on purpose:
// it drives the pincode in the bot's copy and the clinic ranking, and is
// deliberately unrelated to the pincodes a business buys elsewhere in the app.
//
// Desktop presentation view: the two phones sit side by side and wrap on
// narrower screens, but this is not tuned for a handset.

const font = "'Manrope','Noto Sans Devanagari',system-ui,sans-serif"
const INK = '#14201c'

// Context only — the real home screen is PatientHome. Dimmed and inert so it
// reads as background rather than something to click during a demo.
const TILES = [
  { label: 'Doctors', tint: 'rgba(14,159,110,.12)' },
  { label: 'Hospitals', tint: 'rgba(37,99,235,.12)' },
  { label: 'Medicines', tint: 'rgba(219,39,119,.12)' },
]

export default function WhatsAppBookingDemo() {
  const [area, setArea] = useState<string>(AREAS[0])
  // Bumped on every "Book on WhatsApp" tap so the thread starts fresh.
  const [restartKey, setRestartKey] = useState(0)
  const [open, setOpen] = useState(true)

  const openChat = () => { setOpen(true); setRestartKey(k => k + 1) }

  return (
    <div style={{ fontFamily: font, padding: '56px 48px 96px', background: 'radial-gradient(120% 100% at 50% 0%,#e9f3ee 0%,#d5e6dd 100%)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1360, margin: '0 auto 40px' }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, color: INK, margin: '10px 0 8px', letterSpacing: '-.02em' }}>
          Book an appointment — full flow
        </h1>
        <p style={{ fontSize: 16, color: '#4a5b52', margin: 0, maxWidth: 860, lineHeight: 1.55 }}>
          A working stand-in for the real WhatsApp bot, for demos while the integration is built.
          Tap <strong>Book on WhatsApp</strong> on the left phone, then walk the whole journey:{' '}
          <em>Find Clinic → clinic type → speciality → nearby clinics in your pincode → slot → confirm</em>.{' '}
          <strong>← Back</strong> and <strong>↺ Restart</strong> are available at every step.
        </p>

        {/* Which area the patient is in — changes the pincode in the bot's copy
            and which clinics rank first. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#4f7a68' }}>Patient area</span>
          {AREAS.map(a => (
            <button key={a} onClick={() => setArea(a)}
              style={{
                background: a === area ? '#0E9F6E' : '#fff',
                border: `1px solid ${a === area ? '#0E9F6E' : '#c9e3d6'}`,
                color: a === area ? '#fff' : '#075E54',
                fontWeight: a === area ? 800 : 700, fontSize: 13, padding: '7px 14px',
                borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
              }}>{a}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 52, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'center' }}>

        {/* ── entry phone ──────────────────────────────────────────────────── */}
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: INK }}>Step 1 · Patient taps the button</span>
          <div style={{ width: 340, background: '#0b0f14', borderRadius: 44, padding: 12, boxShadow: '0 40px 90px -30px rgba(2,6,23,.6)' }}>
            <div style={{ position: 'relative', background: '#FBF7F0', borderRadius: 34, overflow: 'hidden', minHeight: 560 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px 6px', fontSize: 12.5, fontWeight: 700, color: INK }}>
                <span>9:41</span>
                <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 10, width: 100, height: 24, background: '#0b0f14', borderRadius: '0 0 14px 14px' }} />
                <span style={{ letterSpacing: 2 }}>●●●● ▮</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 20px 6px' }}>
                <img src="/logo-only-symbol.png" alt="" aria-hidden style={{ width: 34, height: 34, objectFit: 'contain', display: 'block', flex: '0 0 auto' }} />
                <span style={{ fontSize: 18, fontWeight: 800, color: INK }}>Sehatsandhi</span>
              </div>

              <div style={{ padding: '6px 20px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e7e0d4', borderRadius: 14, padding: '9px 13px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0E9F6E" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 17, height: 17, flex: '0 0 auto' }}>
                    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" />
                  </svg>
                  <div>
                    <div style={{ fontSize: 10.5, color: '#8a8172', fontWeight: 600 }}>Your area</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{area}</div>
                  </div>
                </div>
              </div>

              <div style={{ padding: '18px 20px 4px' }}>
                <h2 style={{ fontSize: 24, lineHeight: 1.2, fontWeight: 800, color: INK, margin: '0 0 8px', letterSpacing: '-.02em' }}>
                  Family health help, on WhatsApp
                </h2>
                <p style={{ fontSize: 13.5, color: '#5f6b64', margin: '0 0 16px', lineHeight: 1.5 }}>
                  Doctors, medicines, lab tests, ambulance &amp; more — near you, free to use.
                </p>
                <button onClick={openChat} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#25D366', color: '#fff', fontWeight: 800, fontSize: 16, padding: 15, borderRadius: 16, border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 10px 20px -6px rgba(37,211,102,.6)' }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 22, height: 22 }}>
                    <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.6 14.2c-.2.6-1.4 1.2-2 1.3-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-1.9.9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.5.7 1.8.8 1.9.1.1.1.3 0 .5l-.5.6-.4.4c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.2 1.3 1 2.3 1.4 2.6 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.7.9c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z" />
                  </svg>
                  Book on WhatsApp
                </button>
              </div>

              <div style={{ padding: '22px 20px 26px' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 11 }}>What do you need?</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, opacity: .55 }}>
                  {TILES.map(t => (
                    <div key={t.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '13px 5px', background: '#fff', border: '1px solid #eee6d8', borderRadius: 15 }}>
                      <span style={{ width: 40, height: 40, borderRadius: 12, background: t.tint, display: 'block' }} />
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: INK }}>{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── whatsapp phone ───────────────────────────────────────────────── */}
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: INK }}>Step 2 · WhatsApp opens</span>
          {open ? (
            <WhatsAppBotMock area={area} restartKey={restartKey} onClose={() => setOpen(false)} />
          ) : (
            // Only reachable via the chat header's back chevron.
            <div style={{ width: 390, background: '#0b0f14', borderRadius: 48, padding: 13, boxShadow: '0 40px 90px -30px rgba(2,6,23,.6)' }}>
              <div style={{ background: '#ECE4DC', borderRadius: 38, minHeight: 640, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 34px', textAlign: 'center' }}>
                <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(37,211,102,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#25D366' }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 34, height: 34 }}>
                    <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.6 14.2c-.2.6-1.4 1.2-2 1.3-.5.1-1.1.1-1.8-.1-.4-.1-.9-.3-1.6-.6-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-1.9.9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.5.7 1.8.8 1.9.1.1.1.3 0 .5l-.5.6-.4.4c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.2 1.3 1 2.3 1.4 2.6 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.7.9c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z" />
                  </svg>
                </span>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#3f4a44' }}>WhatsApp will open here</div>
                <div style={{ fontSize: 14, color: '#6b7a72', lineHeight: 1.5 }}>
                  Tap <strong>Book on WhatsApp</strong> on the phone to the left to start the conversation.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
