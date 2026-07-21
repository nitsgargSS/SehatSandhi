import { Link } from 'react-router-dom'
import { MessageSquare, CheckCircle2, Star } from 'lucide-react'
import FAQSection from '../components/FAQSection'
import { WA_NUMBER } from '../types'

const SERVICES = [
  { icon: '🏥', title: 'Doctor', hindi: 'डॉक्टर', desc: 'Appointment book karein — verified doctors, WhatsApp par', msg: 'Mujhe doctor se appointment chahiye' },
  { icon: '💊', title: 'Pharmacy', hindi: 'दवाई', desc: 'Ghar par medicines mangayein — nearest verified pharmacy se', msg: 'Mujhe medicines mangwani hain' },
  { icon: '🔬', title: 'Lab / Blood Test', hindi: 'जांच', desc: 'Ghar par blood test karwayein — verified diagnostic labs', msg: 'Mujhe blood test karwana hai' },
  { icon: '🚑', title: 'Ambulance', hindi: 'एम्बुलेंस', desc: 'Emergency mein turant help — verified ambulance service', msg: 'Mujhe ambulance chahiye' },
  { icon: '🛡️', title: 'Health Insurance', hindi: 'बीमा', desc: 'Ghar par agent se milein — verified insurance agents', msg: 'Mujhe health insurance ki jaankari chahiye' },
  { icon: '🏨', title: 'Hospital', hindi: 'अस्पताल', desc: 'Direct OPD booking — multi-speciality hospitals', msg: 'Mujhe hospital mein appointment chahiye' },
]

const faqs = [
  { question: 'Kya Sehatsandhi patients ke liye free hai?', answer: 'Haan, bilkul free hai. Patients ko doctor, pharmacy, lab, ambulance ya insurance dhundhne ke liye koi charge nahi lagta. Sirf WhatsApp par message karein.' },
  { question: 'Kya mujhe koi app download karni hogi?', answer: 'Nahi. Sehatsandhi WhatsApp par kaam karta hai — jo already aapke phone mein hai. Koi nayi app install karne ki zaroorat nahi.' },
  { question: 'Sehatsandhi ka WhatsApp number kya hai?', answer: 'Humein WhatsApp par message karein aur hum aapko turant guide karenge. Number website ke har page par WhatsApp button mein milega.' },
  { question: 'Kya sab doctors aur partners verified hote hain?', answer: 'Haan. Har doctor ka MCI/NMC registration verify kiya jaata hai. Har partner (pharmacy, lab, ambulance, insurance) ka license bhi check hota hai, tabhi unki listing activate hoti hai.' },
  { question: 'Mera data safe hai kya?', answer: 'Haan. Aapka phone number kisi ke saath share nahi kiya jaata. Hum DPDP Act 2023 ke rules follow karte hain — aapki permission ke bina koi message nahi bheja jaata.' },
  { question: 'Agar mujhe messages band karne hon toh?', answer: 'Kabhi bhi "STOP" likh kar bhejein — turant sabhi messages band ho jayenge. Dobara shuru karne ke liye "HI" likhein.' },
]

export default function HowItWorks() {
  return (
    <div className="pt-16">

      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">
            Sehatsandhi Kya Hai?
          </h1>
          <p className="text-xl text-teal-600 font-medium mb-6">
            Yamuna Nagar ka apna health platform — WhatsApp par
          </p>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Doctors, medicines, blood tests, ambulance aur health insurance —
            sab kuch ek hi WhatsApp number par. Koi app nahi, koi form nahi,
            bilkul free.
          </p>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Mujhe%20Sehatsandhi%20ke%20baare%20mein%20jaanna%20hai.`}
             target="_blank" rel="noreferrer"
             className="btn-teal mt-8 px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            📱 WhatsApp par Shuru Karein
          </a>
        </div>
      </section>

      {/* How it works — 3 steps */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">Yeh Kaise Kaam Karta Hai?</h2>
          <p className="section-sub">Sirf 3 steps mein koi bhi service milegi</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: <MessageSquare className="w-8 h-8 text-teal-600" />, step: '01', title: 'WhatsApp par message karein', desc: 'Hamara number save karein aur apni zaroorat batayein — doctor, medicine, test, ambulance ya insurance.' },
              { icon: <CheckCircle2 className="w-8 h-8 text-teal-600" />, step: '02', title: 'Apni zaroorat batayein', desc: 'Bot aapse poochega kya chahiye — speciality, area, ya service type. Bas reply karte jayein.' },
              { icon: <Star className="w-8 h-8 text-teal-600" />, step: '03', title: 'Verified service milegi', desc: 'Aapke area ke verified doctor, pharmacy, lab ya partner se turant connect ho jayenge.' },
            ].map(s => (
              <div key={s.step} className="card text-center hover:shadow-md transition-shadow">
                <div className="w-14 h-14 rounded-2xl bg-teal-50 flex items-center justify-center mx-auto mb-4">{s.icon}</div>
                <span className="text-xs font-bold text-teal-400 tracking-widest">STEP {s.step}</span>
                <h3 className="text-lg font-bold text-navy-700 mt-1 mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's available */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">Kya Kya Milta Hai?</h2>
          <p className="section-sub">Ek hi platform par aapki har health zaroorat</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SERVICES.map(s => (
              <a key={s.title}
                 href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(s.msg)}`}
                 target="_blank" rel="noreferrer"
                 className="card hover:border-teal-300 hover:shadow-md transition-all border border-transparent group">
                <span className="text-4xl">{s.icon}</span>
                <h3 className="font-bold text-navy-700 mt-3 group-hover:text-teal-600 transition">{s.title}</h3>
                <p className="text-teal-600 text-sm">{s.hindi}</p>
                <p className="text-gray-500 text-sm mt-2 leading-relaxed">{s.desc}</p>
                <p className="text-teal-600 text-xs font-medium mt-3">WhatsApp par poochein →</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Why Sehatsandhi */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">Kyun Sehatsandhi?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            {[
              '✅ Sab verified hain — doctors, labs, pharmacies, sab check kiye jaate hain',
              '✅ Sirf aapke area ke service providers — dur ke nahi',
              '✅ WhatsApp par — koi app install nahi karni',
              '✅ Bilkul free patients ke liye — kabhi charge nahi',
              '✅ Door service commitment — delivery, home collection, emergency response',
              '✅ Sehat Points — book karo, points kamao, rewards pao',
            ].map(b => (
              <div key={b} className="flex items-start gap-2 text-gray-600 text-sm">
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sehat Points teaser */}
      <section className="py-16 bg-gradient-to-r from-teal-600 to-navy-700">
        <div className="max-w-3xl mx-auto px-4 text-center text-white">
          <h2 className="text-3xl font-bold mb-3">🌟 Sehat Points — Earn While You Heal</h2>
          <p className="text-white/80 mb-6">
            Har appointment, har referral par points kamayein — aur discounts,
            free tests ke liye redeem karein.
          </p>
          <Link to="/points" className="bg-white text-teal-700 font-bold px-8 py-3 rounded-full hover:bg-gray-50 transition inline-block">
            Sehat Points Dekhein →
          </Link>
        </div>
      </section>

      <FAQSection items={faqs} subtitle="Patients ke liye common sawaal" />

      {/* Final CTA */}
      <section className="py-16 bg-white text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-navy-700 mb-4">Abhi shuru karein</h2>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!`} target="_blank" rel="noreferrer"
             className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            📱 WhatsApp par Message Karein
          </a>
        </div>
      </section>

    </div>
  )
}
