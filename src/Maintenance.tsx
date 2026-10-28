import { BIZ } from './pages/business/shared'

// What every page shows while VITE_MAINTENANCE is "true" (main.tsx) — the
// switch night of the move to Mumbai (docs/2026-10-mumbai-migration.md), or any
// other short window when the database must not take writes.
//
// Nothing here touches Supabase: the point is that nobody can book, bill or
// sign in while the data is being copied.

export default function Maintenance() {
  return (
    <div style={{ minHeight: '100vh', background: BIZ.cream, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 520, width: '100%', background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 20, padding: 'clamp(24px,6vw,40px)', textAlign: 'center' }}>
        <img src="/logo.png" alt="Sehatsandhi" style={{ height: 64, margin: '0 auto 20px' }} />
        <h1 style={{ fontSize: 'clamp(22px,5.5vw,28px)', fontWeight: 800, color: BIZ.ink, margin: '0 0 10px' }}>
          We’ll be back in a few minutes
        </h1>
        <p style={{ fontSize: 15.5, color: BIZ.muted, lineHeight: 1.6, margin: '0 0 18px' }}>
          Sehatsandhi is being moved to faster servers in India. Bookings, records and logins are paused
          until it is done — nothing you have saved is lost.
        </p>
        <h2 style={{ fontSize: 'clamp(19px,5vw,23px)', fontWeight: 800, color: BIZ.ink, margin: '0 0 8px' }}>
          कुछ ही मिनटों में वापस
        </h2>
        <p style={{ fontSize: 15.5, color: BIZ.muted, lineHeight: 1.7, margin: '0 0 22px' }}>
          Sehatsandhi को भारत में तेज़ सर्वरों पर ले जाया जा रहा है। तब तक बुकिंग, रिकॉर्ड और लॉगिन रुके हैं —
          आपका सहेजा हुआ कुछ भी नहीं खोएगा।
        </p>
        <div style={{ fontSize: 14, color: BIZ.mutedWarm, lineHeight: 1.6 }}>
          Urgent? Call us · ज़रूरी हो तो कॉल करें<br />
          <a href="tel:+918570889188" style={{ color: BIZ.green, fontWeight: 800, fontSize: 17 }}>+91 85708 89188</a>
        </div>
        <p style={{ fontSize: 13, color: BIZ.mutedWarm, margin: '20px 0 0' }}>
          In an emergency call 108 · आपातकाल में 108 पर कॉल करें
        </p>
      </div>
    </div>
  )
}
