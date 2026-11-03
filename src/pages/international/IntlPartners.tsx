import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plane, FileCheck, BedDouble, Car, Languages, Ambulance, Smartphone, Briefcase, CheckCircle2, Handshake } from 'lucide-react'
import IntlLayout, { C, Wrap, PageHead, Card, useTitle } from './IntlLayout'
import { supabase } from '../../lib/supabase'

// 0318: businesses that want to work with Sehatsandhi International — travel,
// visa help, hotels, transport and more — send an enquiry. Later each type
// gets its own pages; for now the team follows up from the admin panel.

export const PARTNER_TYPES: { key: string; name: string; what: string; icon: typeof Plane }[] = [
  { key: 'travel_agent', name: 'Travel agents', what: 'Flights and complete travel plans for patients and their families', icon: Plane },
  { key: 'visa', name: 'Visa assistance', what: 'Help with e-Medical and attendant visa applications and documents', icon: FileCheck },
  { key: 'hotel', name: 'Hotels and guest houses', what: 'Clean, safe stays near hospitals, for patients and companions', icon: BedDouble },
  { key: 'transport', name: 'Airport transfers and cabs', what: 'Pickup and drop, hospital visits and local travel with trained drivers', icon: Car },
  { key: 'interpreter', name: 'Interpreters', what: 'Arabic, Nepali, Bengali, Swahili, Russian, French and other languages', icon: Languages },
  { key: 'ambulance', name: 'Ambulance services', what: 'Airport-to-hospital and emergency transfers', icon: Ambulance },
  { key: 'forex_sim', name: 'Currency exchange and SIM cards', what: 'Licensed money changers and mobile connections for visitors', icon: Smartphone },
  { key: 'other', name: 'Other services', what: 'Food, pharmacy delivery, physiotherapy at the hotel, sightseeing and more', icon: Briefcase },
]

const field = 'mt-1 w-full rounded-xl border px-4 py-3 bg-white'

export default function IntlPartners() {
  useTitle('Partner with us')
  const [f, setF] = useState({
    business_name: '', city: '', state: '', serves: '', contact_name: '', phone: '', email: '', website: '',
    registration: '', languages: '', offer: '', prices: '', website_hp: '',
  })
  const [types, setTypes] = useState<string[]>([])
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(v => ({ ...v, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!types.length) { setErr('Please choose what your business offers.'); return }
    if (!consent) { setErr('Please tick the box at the end of the form.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('sehat_intl_partner_enquire', {
      p: { ...f, types, consent, page: typeof window !== 'undefined' ? window.location.pathname : null },
    })
    setBusy(false)
    const r = data as { ok: boolean; error?: string } | null
    if (error || !r?.ok) { setErr(r?.error || error?.message || 'Something went wrong. Please try again.'); return }
    setDone(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }

  if (done) return (
    <IntlLayout>
      <Wrap narrow className="py-14">
        <Card className="text-center">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: C.green }} />
          <h1 className="text-2xl sm:text-3xl font-bold">Thank you, {f.contact_name.split(' ')[0]}.</h1>
          <p className="mt-3 text-lg" style={{ color: C.muted }}>We have your enquiry for {f.business_name}. Our team will call or message you within a few working days.</p>
          <Link to="/international" className="inline-block mt-6 font-semibold" style={{ color: C.green }}>Back to Sehatsandhi International →</Link>
        </Card>
      </Wrap>
    </IntlLayout>
  )

  return (
    <IntlLayout>
      <PageHead kicker="Partner with us" title="Help patients from abroad feel at home"
        lead="Patients coming to India for treatment need more than a hospital: visas, flights, a clean place to stay, a safe ride from the airport and someone who speaks their language. If your business offers this, in any city, partner with us." />
      <Wrap className="py-10">
        <h2 className="text-2xl font-bold mb-5">Who we are looking for</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-12">
          {PARTNER_TYPES.map(t => (
            <Card key={t.key}>
              <t.icon className="w-7 h-7 mb-2" style={{ color: C.green }} />
              <p className="font-semibold">{t.name}</p>
              <p className="text-[15px] mt-1" style={{ color: C.muted }}>{t.what}</p>
            </Card>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          <div className="flex flex-col gap-4">
            <Card>
              <p className="font-semibold text-lg mb-2 flex items-center gap-2"><Handshake className="w-5 h-5" style={{ color: C.green }} /> How it works</p>
              <ol className="list-decimal pl-5 flex flex-col gap-1.5 leading-relaxed" style={{ color: C.muted }}>
                <li>Send the form. It is free and takes three minutes.</li>
                <li>Our team calls you, checks your registration and licences, and agrees fair, written prices with you.</li>
                <li>When patients need what you offer in your city, we send them to you.</li>
                <li>Soon, partners will have their own page on our portal.</li>
              </ol>
            </Card>
            <Card>
              <p className="font-semibold text-lg mb-2">What we look for</p>
              <ul className="flex flex-col gap-1.5" style={{ color: C.muted }}>
                {['A registered business, with GST where it applies', 'The licences your work needs (for example travel agent recognition, a commercial vehicle permit, an FSSAI licence for food)', 'Clear prices in writing, the same for every patient', 'Safe, clean and polite service; patient details kept private', 'A person who answers on WhatsApp'].map(x => (
                  <li key={x} className="flex gap-2"><CheckCircle2 className="w-4 h-4 mt-1 shrink-0" style={{ color: C.green }} />{x}</li>
                ))}
              </ul>
            </Card>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-5">
            <Card>
              <p className="font-semibold text-lg mb-3">Your business</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">Business name<input required value={f.business_name} onChange={set('business_name')} className={field} style={{ borderColor: C.border }} /></label>
                <div className="sm:col-span-2">
                  <p>What do you offer? <span className="text-sm" style={{ color: C.muted }}>(choose all that apply)</span></p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PARTNER_TYPES.map(t => {
                      const on = types.includes(t.key)
                      return (
                        <button type="button" key={t.key} onClick={() => setTypes(v => on ? v.filter(x => x !== t.key) : [...v, t.key])}
                          className="rounded-full px-3 py-1.5 text-sm" style={{ border: `1px solid ${on ? C.green : C.border}`, background: on ? C.soft : '#fff', color: on ? C.greenDark : C.ink, fontWeight: on ? 600 : 400 }}>
                          {on ? '✓ ' : ''}{t.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <label>City<input value={f.city} onChange={set('city')} className={field} style={{ borderColor: C.border }} /></label>
                <label>State<input value={f.state} onChange={set('state')} className={field} style={{ borderColor: C.border }} /></label>
                <label className="sm:col-span-2">Cities or areas you serve<input value={f.serves} onChange={set('serves')} placeholder="e.g. Yamunanagar, Ambala, Chandigarh airport" className={field} style={{ borderColor: C.border }} /></label>
                <label className="sm:col-span-2">Website or social page (optional)<input value={f.website} onChange={set('website')} className={field} style={{ borderColor: C.border }} /></label>
                <label className="sm:col-span-2">Registration, GST and licence numbers (optional)<input value={f.registration} onChange={set('registration')} placeholder="e.g. GSTIN, Ministry of Tourism approval, vehicle permits" className={field} style={{ borderColor: C.border }} /></label>
              </div>
            </Card>
            <Card>
              <p className="font-semibold text-lg mb-3">What you offer</p>
              <label className="block">Describe your services<textarea value={f.offer} onChange={set('offer')} rows={4} className={field} style={{ borderColor: C.border }}
                placeholder="e.g. 12 AC rooms 1 km from the hospital, vegetarian and halal food, airport pickup in an Innova" /></label>
              <label className="block mt-4">Typical prices (optional)<textarea value={f.prices} onChange={set('prices')} rows={2} className={field} style={{ borderColor: C.border }}
                placeholder="e.g. Delhi airport to Yamunanagar ₹4,500 one way; room ₹2,200 a night with breakfast" /></label>
              <label className="block mt-4">Languages you speak<input value={f.languages} onChange={set('languages')} placeholder="e.g. English, Hindi, Punjabi, Arabic" className={field} style={{ borderColor: C.border }} /></label>
            </Card>
            <Card>
              <p className="font-semibold text-lg mb-3">Who should we talk to?</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">Name<input required value={f.contact_name} onChange={set('contact_name')} className={field} style={{ borderColor: C.border }} autoComplete="name" /></label>
                <label>WhatsApp number<input value={f.phone} onChange={set('phone')} placeholder="+91 98765 43210" className={field} style={{ borderColor: C.border }} inputMode="tel" autoComplete="tel" /></label>
                <label>Email (optional)<input type="email" value={f.email} onChange={set('email')} className={field} style={{ borderColor: C.border }} autoComplete="email" /></label>
              </div>
              <input tabIndex={-1} autoComplete="off" value={f.website_hp} onChange={set('website_hp')} aria-hidden className="hidden" />
              <label className="mt-4 flex gap-3 items-start"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1.5 w-5 h-5" />
                <span>I agree that Sehatsandhi may contact me about a partnership. See our <Link to="/privacy" className="underline">privacy policy</Link>.</span></label>
            </Card>
            {err && <p className="rounded-xl bg-red-50 text-red-800 px-4 py-3">{err}</p>}
            <button disabled={busy} className="rounded-full px-6 py-4 text-lg font-semibold text-white disabled:opacity-60" style={{ background: C.green }}>
              {busy ? 'Sending…' : 'Send partnership enquiry'}
            </button>
          </form>
        </div>
      </Wrap>
    </IntlLayout>
  )
}
