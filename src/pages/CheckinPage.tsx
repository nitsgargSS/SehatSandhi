import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { checkinInfo, submitCheckin } from '../lib/checkinApi'

// 0251: the form a clinic's reception QR opens on the patient's own phone.
// Name, age and WhatsApp number; address and PIN code if they wish. It only
// tells the reception they are here — the receptionist confirms and gives the token.
export default function CheckinPage() {
  const { code = '' } = useParams()
  const [clinic, setClinic] = useState<{ ok: boolean; name?: string; city?: string | null } | null>(null)
  const [f, setF] = useState({ name: '', age: '', phone: '', address: '', pin: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { checkinInfo(code).then(setClinic).catch(() => setClinic({ ok: false })) }, [code])

  const phone = f.phone.replace(/\D/g, '').slice(-10)
  const ready = f.name.trim().length >= 2 && f.age !== '' && Number(f.age) >= 0 && Number(f.age) <= 120 && /^[6-9]\d{9}$/.test(phone)
  const send = async () => {
    setBusy(true); setErr('')
    try {
      const r = await submitCheckin(code, { name: f.name.trim(), age: Number(f.age), phone, address: f.address.trim(), pin: f.pin })
      if (r.ok) setDone(true); else setErr(r.text ?? 'Please give your details at the reception desk.')
    } catch { setErr('The network is slow. Please try again, or tell the reception.') } finally { setBusy(false) }
  }
  const field = 'w-full border border-gray-300 rounded-xl px-4 py-3 text-base mt-1 focus:outline-none focus:border-teal-600'
  const label = 'block text-sm font-semibold text-gray-700'

  return (
    <div className="min-h-screen bg-[#f6f8f7] px-4 py-6">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm p-5 space-y-4">
        {clinic === null ? <p className="text-gray-500 text-center py-8">Loading…</p>
          : !clinic.ok ? <p className="text-center py-8 text-gray-700">This QR code is not active.<br />कृपया रिसेप्शन पर बताएं।</p>
          : done ? (
            <div className="text-center py-6 space-y-3">
              <div className="text-5xl">✅</div>
              <h1 className="text-xl font-bold text-navy-700">धन्यवाद, {f.name.trim()}!</h1>
              <p className="text-gray-700">आपकी जानकारी <b>{clinic.name}</b> के रिसेप्शन पर पहुँच गई है।<br />कृपया रिसेप्शन पर जाकर अपना नाम बताएं और टोकन लें।</p>
              <p className="text-sm text-gray-500">Your details have reached the reception. Please go to the desk, say your name and collect your token.</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-teal-700 font-semibold">रजिस्ट्रेशन · Registration</p>
                <h1 className="text-xl font-bold text-navy-700">{clinic.name}</h1>
                {clinic.city && <p className="text-sm text-gray-500">{clinic.city}</p>}
              </div>
              <label className={label}>मरीज़ का नाम · Patient's name *
                <input className={field} value={f.name} maxLength={80} autoComplete="name" onChange={e => setF({ ...f, name: e.target.value })} />
              </label>
              <label className={label}>उम्र (साल) · Age in years *
                <input className={field} value={f.age} inputMode="numeric" maxLength={3} onChange={e => setF({ ...f, age: e.target.value.replace(/\D/g, '') })} />
              </label>
              <label className={label}>WhatsApp नंबर · WhatsApp number *
                <input className={field} value={f.phone} inputMode="numeric" maxLength={10} autoComplete="tel-national" placeholder="10 अंक / 10 digits"
                  onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} />
              </label>
              <label className={label}>पता · Address <span className="font-normal text-gray-400">(optional)</span>
                <input className={field} value={f.address} maxLength={200} autoComplete="street-address" onChange={e => setF({ ...f, address: e.target.value })} />
              </label>
              <label className={label}>PIN कोड · PIN code <span className="font-normal text-gray-400">(optional)</span>
                <input className={field} value={f.pin} inputMode="numeric" maxLength={6} autoComplete="postal-code" onChange={e => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
              </label>
              {err && <p className="text-sm text-red-600">{err}</p>}
              <button onClick={send} disabled={!ready || busy}
                className="w-full bg-teal-700 text-white font-bold rounded-xl py-3.5 text-base disabled:opacity-50">
                {busy ? 'भेज रहे हैं…' : 'रजिस्टर करें · Register'}
              </button>
              <p className="text-xs text-gray-500">आपकी जानकारी सिर्फ़ इस क्लिनिक के रिसेप्शन को दिखेगी। क्लिनिक आपको इस नंबर पर WhatsApp संदेश भेज सकता है; रोकने के लिए कभी भी STOP भेजें।<br />
                Your details go only to this clinic's reception. The clinic may message you on WhatsApp at this number; send STOP any time to stop.</p>
            </>
          )}
      </div>
      <p className="text-center text-xs text-gray-400 mt-4">Sehatsandhi</p>
    </div>
  )
}
