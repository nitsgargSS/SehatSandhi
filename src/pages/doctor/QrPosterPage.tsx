import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { clinicWaLink, reviewWaLink, qrDataUrl } from '../../lib/qr'
import { checkinLink } from '../../lib/checkinApi'

// The A4 poster for reception (0141): the clinic's banner, a large QR code and
// what to do, in Hindi and English. Printed from Clinic → Patient QR code.

export default function QrPosterPage() {
  const { id } = useParams()
  // Which poster: booking (default), 'review' (0254) or 'reception' (0251). Each says what to do with it,
  // so nobody writes on the paper instead of scanning.
  const kind = useSearchParams()[0].get('kind') ?? 'book'
  const words = kind === 'review' ? {
    hi: 'अपना अनुभव बताएं ⭐', en: 'Rate your visit — scan with your phone',
    steps: '1. फ़ोन के कैमरा से QR स्कैन करें  ·  2. WhatsApp में Send दबाएँ  ·  3. स्टार चुनें और अपने शब्द लिखें',
    stepsEn: 'Scan with your phone camera · Press Send in WhatsApp · Choose stars and write a line',
    note: 'कृपया इस काग़ज़ पर न लिखें — फ़ोन से स्कैन करें। स्कैन नहीं हो रहा? रिसेप्शन पर बताएं।  /  Please do not write on this paper. Cannot scan? Tell the reception.',
  } : kind === 'reception' ? {
    hi: 'अपना रजिस्ट्रेशन खुद करें', en: 'Register yourself — scan with your phone',
    steps: '1. फ़ोन के कैमरा से QR स्कैन करें  ·  2. नाम, उम्र और WhatsApp नंबर भरें  ·  3. रिसेप्शन से टोकन लें',
    stepsEn: 'Scan with your phone camera · Fill in name, age and WhatsApp number · Collect your token at the desk',
    note: 'फ़ोन नहीं है? रिसेप्शन पर बताएं।  /  No phone? Tell the reception.',
  } : null
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
      const num = (wa as string) ?? '917015399355'
      if (data.qr_code) setImg(await qrDataUrl(
        kind === 'review' ? reviewWaLink(num, data.qr_code, data.name) : kind === 'reception' ? checkinLink(data.qr_code) : clinicWaLink(num, data.qr_code, data.name), 900))
    })()
  }, [id, kind])

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
          {words ? words.hi : 'WhatsApp पर अपॉइंटमेंट बुक करें'}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: '#2f5a4a' }}>{words ? words.en : 'Scan to book an appointment on WhatsApp'}</div>
        {img && <img src={img} alt="QR code" style={{ width: 380, height: 380, margin: '26px auto 10px', display: 'block' }} />}
        <div style={{ fontSize: 18, marginTop: 6 }}>
          {words ? words.steps : <>1. कैमरा से QR स्कैन करें &nbsp;·&nbsp; 2. WhatsApp में <b>Send</b> दबाएँ &nbsp;·&nbsp; 3. डॉक्टर और समय चुनें</>}
        </div>
        <div style={{ fontSize: 15, marginTop: 4, color: '#2f5a4a' }}>
          {words ? words.stepsEn : 'Scan with your camera · Press Send in WhatsApp · Pick your doctor and time'}
        </div>
        {words && <div style={{ fontSize: 15, marginTop: 16, padding: '10px 14px', border: '2px dashed #0f6b4a', borderRadius: 10, fontWeight: 700 }}>{words.note}</div>}
        <div style={{ fontSize: 16, marginTop: 22, fontFamily: 'monospace', letterSpacing: 2 }}>{biz.qr_code}</div>
        <div style={{ fontSize: 13, marginTop: 18, color: '#557' }}>{[biz.address, biz.phone].filter(Boolean).join(' · ')}</div>
        <div style={{ fontSize: 12, marginTop: 8, color: '#889' }}>Powered by Sehatsandhi</div>
      </div>
    </div>
  )
}
