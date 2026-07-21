import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { SPECIALITIES, WA_NUMBER } from '../types'

const SPEC_ICONS: Record<string, string> = {
  GEN:'🏥', SKIN:'🌿', DENT:'🦷', EYE:'👁️', PAED:'👶',
  GYN:'🌸', IVF:'🍀', ORTH:'🦴', CARD:'❤️', ENT:'👂',
  GAST:'🫁', NEUR:'🧠', URO:'🫘', ONC:'🎗️', PSY:'🧘',
  DIAB:'💉', PHYS:'💪', ALT:'🌱', LAB:'🔬', PHRM:'💊'
}

const faqs = [
  { q: 'Kya patient ke liye free hai?', a: 'Haan, bilkul free. Patients ko koi charge nahi lagta. WhatsApp par message karein aur appointment book karein.' },
  { q: 'Doctors kaise listed hote hain?', a: 'Doctors registration karte hain, apni speciality aur area batate hain — hamari team verify karke listing activate karti hai.' },
  { q: 'Appointment kaise book hoti hai?', a: 'WhatsApp par message karein → speciality choose karein → doctor select karein → slot confirm karein. Sirf 2-3 minute lagte hain.' },
  { q: 'Kya app download karni padegi?', a: 'Nahi! Sirf WhatsApp chahiye jo aapke phone mein pehle se hai. Koi nayi app install karne ki zaroorat nahi.' },
  { q: "Doctor ki verification hoti hai?", a: "Haan, hamare team har doctor ka MCI/NMC registration number verify karti hai. Tab hi listing activate hoti hai." },
]

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100 py-4">
      <button onClick={() => setOpen(!open)} className="w-full flex justify-between items-center text-left gap-4">
        <span className="font-medium text-gray-800 text-sm sm:text-base">{q}</span>
        {open ? <ChevronUp className="text-teal-600 shrink-0 w-5 h-5" /> : <ChevronDown className="text-gray-400 shrink-0 w-5 h-5" />}
      </button>
      {open && <p className="mt-3 text-gray-500 text-sm leading-relaxed">{a}</p>}
    </div>
  )
}

export default function Landing() {
  return (
    <div className="pt-16">

      {/* ── HERO ── */}
      <section className="min-h-[90vh] flex items-center bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          <div>
            <span className="inline-flex items-center gap-2 bg-teal-50 text-teal-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 border border-teal-100">
              📍 Yamuna Nagar & Jagadhri
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-navy-700 leading-tight mb-4">
              सही डॉक्टर,<br />अभी मिलें
            </h1>
            <p className="text-xl text-teal-600 font-medium mb-4">Find the Right Doctor, Right Now</p>
            <p className="text-gray-500 text-base sm:text-lg mb-8 leading-relaxed max-w-lg">
              Yamuna Nagar ke verified doctors se <strong>WhatsApp par</strong> appointment book karein —
              bilkul free, koi app nahi
            </p>
            <div className="flex flex-wrap gap-4">
              <a href={`https://wa.me/${WA_NUMBER}?text=Namaste%20Sehatsandhi!%20Main%20doctor%20dhundh%20raha%20hoon.`}
                 target="_blank" rel="noreferrer" className="btn-teal text-base px-8 py-4 shadow-lg shadow-teal-100">
                📱 WhatsApp par Book Karein
              </a>
              <Link to="/doctor" className="btn-navy text-base px-8 py-4">
                🏥 Doctor? Register Karein
              </Link>
            </div>
            <p className="text-gray-400 text-xs mt-5">✓ No registration needed for patients &nbsp;✓ Free forever &nbsp;✓ Verified doctors only</p>
          </div>
          <div className="hidden lg:flex justify-center">
            <div className="w-72 bg-white rounded-3xl shadow-2xl border border-gray-100 p-5 space-y-3">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <img src="/logo.png" alt="Sehatsandhi" className="w-10 h-10 rounded-full object-cover" />
                <div>
                  <p className="font-semibold text-sm text-gray-800">Sehatsandhi</p>
                  <p className="text-xs text-teal-500">● Online</p>
                </div>
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-700 max-w-[85%]">
                Namaste! 🙏 Main Sehatsandhi hoon. Aapko kaunsi speciality chahiye?
              </div>
              <div className="flex justify-end">
                <div className="bg-teal-500 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white max-w-[85%]">
                  Skin specialist chahiye
                </div>
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-700">
                <p className="font-medium mb-1">Yamuna Nagar mein:</p>
                <p>1. Dr. Priya Sharma</p>
                <p>2. Dr. Rahul Verma</p>
                <p className="text-teal-600 mt-1 text-xs">Reply number to book →</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section className="bg-teal-600 py-4">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap justify-center gap-6 sm:gap-12">
          {[['20', 'PIN Codes Covered'], ['20', 'Specialities'], ['Yamuna Nagar', '& Jagadhri'], ['No App', 'Needed']].map(([n, l]) => (
            <div key={l} className="text-center text-white">
              <div className="font-bold text-xl">{n}</div>
              <div className="text-white/80 text-xs">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="section-title">Kaise kaam karta hai?</h2>
          <p className="section-sub">Sirf 3 steps mein doctor book karein</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'WhatsApp par message karein', desc: 'Hamara WhatsApp number save karein aur "Hi" message bhejein — koi form nahi, koi wait nahi.' },
              { step: '02', title: 'Speciality choose karein', desc: 'Skin, dental, eye, ortho, child specialist — apni zaroorat ke anusaar speciality select karein.' },
              { step: '03', title: 'Doctor book karein', desc: 'Nearby verified doctors ki list dekhein, doctor select karein, aur appointment confirm karein.' },
            ].map(s => (
              <div key={s.step} className="card text-center hover:shadow-md transition-shadow group">
                <span className="text-xs font-bold text-teal-400 tracking-widest">STEP {s.step}</span>
                <h3 className="text-lg font-bold text-navy-700 mt-1 mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!`} target="_blank" rel="noreferrer" className="btn-teal px-10 py-4 text-lg shadow-lg shadow-teal-100">
              📱 Abhi Start Karein
            </a>
          </div>
        </div>
      </section>

      {/* ── SPECIALITIES ── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="section-title">Sabhi Specialities</h2>
          <p className="section-sub">20 se zyaada specialities — sab Yamuna Nagar mein available</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {SPECIALITIES.map(s => (
              <a key={s.id}
                 href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Mujhe%20${encodeURIComponent(s.en)}%20chahiye.`}
                 target="_blank" rel="noreferrer"
                 className="card text-center py-5 hover:border-teal-300 hover:shadow-md transition-all group cursor-pointer border border-transparent">
                <span className="text-3xl">{SPEC_ICONS[s.id]}</span>
                <p className="font-semibold text-navy-700 text-xs mt-2 group-hover:text-teal-600 transition">{s.hi}</p>
                <p className="text-gray-400 text-xs mt-0.5">{s.en}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOR DOCTORS ── (pricing table removed — model is being redesigned) */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <span className="text-teal-600 font-semibold text-sm tracking-wide uppercase">For Doctors & Clinics</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-navy-700 mt-2 mb-6">Apni clinic ki reach badhayein</h2>
              <ul className="space-y-4">
                {[
                  'Yamuna Nagar ke patients tak pahunchein — apne PIN codes choose karein',
                  'Affordable listing — apni area ke hisaab se pricing',
                  'Premium top position bhi available',
                  'MCI/NMC verified badge aapke listing par',
                  'Appointment dashboard — dekho kaunse patients aaye',
                  'Registration free — pricing details team confirm karegi',
                ].map(b => (
                  <li key={b} className="flex items-start gap-3">
                    <CheckCircle2 className="text-teal-500 w-5 h-5 shrink-0 mt-0.5" />
                    <span className="text-gray-600 text-sm">{b}</span>
                  </li>
                ))}
              </ul>
              <Link to="/doctor" className="btn-teal mt-8 px-10 py-4 text-base shadow-lg shadow-teal-100">
                Abhi Register Karein →
              </Link>
            </div>
            {/* Value card — no pricing numbers shown */}
            <div className="card border border-gray-200 overflow-hidden shadow-lg">
              <div className="bg-navy-700 text-white px-6 py-6">
                <h3 className="font-bold text-lg mb-2">Pricing Apke Area Ke Hisaab Se</h3>
                <p className="text-white/70 text-sm leading-relaxed">
                  Har area ki apni zaroorat hai — isliye pricing fixed nahi hai.
                  Registration submit karne ke baad hamari team aapke area,
                  selected PIN codes, aur speciality ke hisaab se
                  <strong className="text-white"> personalised pricing</strong> WhatsApp
                  par bhejegi.
                </p>
              </div>
              <div className="p-6 space-y-3">
                {[
                  'Apni details aur PIN codes register karein',
                  'Team 24-48 ghante mein verify karegi',
                  'Personalised pricing WhatsApp par milegi',
                  'Confirm karein aur listing activate ho jayegi',
                ].map((s, i) => (
                  <div key={s} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="text-gray-600 text-sm">{s}</span>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 bg-amber-50 border-t border-amber-100">
                <p className="text-xs text-amber-700">💡 No lock-in — cancel anytime, koi hidden charges nahi</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">Aksar pooche jane wale sawaal</h2>
          <p className="section-sub">Frequently Asked Questions</p>
          <div className="card shadow-sm">
            {faqs.map(f => <FAQItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-20 bg-gradient-to-r from-teal-600 to-navy-700 text-white text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Aaj hi shuru karein</h2>
          <p className="text-white/80 mb-8 text-lg">Yamuna Nagar ke best doctors se milein — WhatsApp par, abhi</p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!`} target="_blank" rel="noreferrer"
               className="bg-white text-teal-700 font-bold px-10 py-4 rounded-full hover:bg-gray-50 transition shadow-lg">
              📱 Book Appointment
            </a>
            <Link to="/doctor" className="border-2 border-white text-white px-10 py-4 rounded-full font-semibold hover:bg-white/10 transition">
              Register as Doctor
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
