import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { clinicWaLink, qrDataUrl } from '../../lib/qr'

// The A4 poster for reception (0141): the clinic's banner, a large QR code and
// what to do, in Hindi and English. Printed from Clinic → Patient QR code.

export default function QrPosterPage() {
  const { id } = useParams()
  const [biz, setBiz] = useState<{ name: string; address: string | null; phone: string | null; qr_code: string | null; letterhead_url: string | null } | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const { data, error } = await supabase.from('businesses').select('name, address, phone, qr_code, letterhead_url').eq('id', id).maybeSingle()
      if (error || !data) { setErr('Sign in as this clinic’s staff to print its poster.'); return }
      setBiz(data)
      const { data: wa } = await supabase.rpc('sehat_business_wa_number', { p_business: id })
      if (data.qr_code) setImg(await qrDataUrl(clinicWaLink((wa as string) ?? '917015399355', data.qr_code, data.name), 900))
    })()
  }, [id])

  if (err) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>{err}</div>
  if (!biz) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>Loading…</div>

  return (
    <div style={{ background: '#fff', minHeight: '100vh', fontFamily: "'Noto Sans Devanagari', system-ui, Arial, sans-serif", color: '#0b3d2c' }}>
      <style>{`@media print { .no-print { display: none !important } @page { size: A4; margin: 10mm } }`}</style>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 18px', textAlign: 'center' }}>
        <div className="no-print" style={{ textAlign: 'right', marginBottom: 10 }}>
          <button onClick={() => window.print()} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0f6b4a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Print poster</button>
        </div>
        {biz.letterhead_url
          ? <img src={biz.letterhead_url} alt={biz.name} style={{ width: '100%', maxHeight: 150, objectFit: 'contain' }} />
          : <div style={{ fontSize: 30, fontWeight: 800 }}>{biz.name}</div>}
        <div style={{ fontSize: 34, fontWeight: 800, marginTop: 22, lineHeight: 1.25 }}>
          WhatsApp पर अपॉइंटमेंट बुक करें
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: '#2f5a4a' }}>Scan to book an appointment on WhatsApp</div>
        {img && <img src={img} alt="QR code" style={{ width: 380, height: 380, margin: '26px auto 10px', display: 'block' }} />}
        <div style={{ fontSize: 18, marginTop: 6 }}>
          1. कैमरा से QR स्कैन करें &nbsp;·&nbsp; 2. WhatsApp में <b>Send</b> दबाएँ &nbsp;·&nbsp; 3. डॉक्टर और समय चुनें
        </div>
        <div style={{ fontSize: 15, marginTop: 4, color: '#2f5a4a' }}>
          Scan with your camera · Press Send in WhatsApp · Pick your doctor and time
        </div>
        <div style={{ fontSize: 16, marginTop: 22, fontFamily: 'monospace', letterSpacing: 2 }}>{biz.qr_code}</div>
        <div style={{ fontSize: 13, marginTop: 18, color: '#557' }}>{[biz.address, biz.phone].filter(Boolean).join(' · ')}</div>
        <div style={{ fontSize: 12, marginTop: 8, color: '#889' }}>Powered by Sehatsandhi</div>
      </div>
    </div>
  )
}
