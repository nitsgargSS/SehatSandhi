import { Link } from 'react-router-dom'
import FAQSection from '../components/FAQSection'
import { WA_NUMBER } from '../types'

const PARTNER_TYPES = [
  { icon: '🏥', title: 'Doctors & Clinics', hindi: 'डॉक्टर एवं क्लिनिक', desc: 'Apni clinic ki reach badhayein — patients WhatsApp par dhundhenge', to: '/doctor', cta: 'Doctor Register Karein' },
  { icon: '💊', title: 'Pharmacies', hindi: 'दवाई की दुकान', desc: 'Prescriptions seedhi aapke paas — ghar delivery karein', to: '/partner', cta: 'Pharmacy Partner Banein' },
  { icon: '🔬', title: 'Diagnostic Labs', hindi: 'जांच केंद्र', desc: 'Test bookings seedhe aapke paas — home collection karein', to: '/partner', cta: 'Lab Partner Banein' },
  { icon: '🚑', title: 'Ambulance Services', hindi: 'एम्बुलेंस सेवा', desc: 'Emergency response — apne area mein trusted banein', to: '/partner', cta: 'Ambulance Partner Banein' },
  { icon: '🛡️', title: 'Insurance Agents', hindi: 'बीमा एजेंट', desc: 'Warm leads, cold calling nahi — patients ghar bulayein', to: '/partner', cta: 'Insurance Partner Banein' },
  { icon: '🏨', title: 'Hospitals', hindi: 'अस्पताल', desc: 'Multi-doctor, multi-speciality — ek unified listing', to: null, cta: 'WhatsApp par Baat Karein', wa: true },
]

const faqs = [
  { question: 'Partner banne ke liye kya zaroori hai?', answer: 'Aapke paas valid license/registration hona chahiye (drug license for pharmacy, NABL/lab registration for labs, ambulance permit, ya IRDA license for insurance). Doctors ke liye MCI/NMC registration zaroori hai.' },
  { question: 'Sirf woh PIN codes kyun choose karein jahan service de sakein?', answer: 'Jab aap ek PIN code choose karte hain, toh patients ko commitment milta hai ki aap us area mein service denge — chahe woh delivery ho, home collection ho, ya emergency response. Yeh commitment hi Sehatsandhi ki credibility hai. Sirf woh areas chunein jahan aap genuinely capable hain.' },
  { question: 'Payment kab aur kaise hota hai?', answer: 'Monthly listing fee + per-transaction commission ka structure hai, jo partner type par depend karta hai. Poori details registration ke time dikhayi jaati hain.' },
  { question: 'Kya main baad mein apne PIN codes badal sakta hoon?', answer: 'Haan, apni dashboard se ya humein WhatsApp/call karke PIN codes add ya remove kar sakte hain.' },
  { question: 'Verification mein kitna time lagta hai?', answer: '24-48 ghante mein hamari team aapki details verify kar leti hai aur WhatsApp par confirm kar deti hai.' },
]

export default function Partners() {
  return (
    <div className="pt-16">

      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">
            Sehatsandhi Partner Network
          </h1>
          <p className="text-xl text-teal-600 font-medium mb-4">
            Yamuna Nagar ka apna health ecosystem
          </p>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
            Sirf verified partners. Sirf door service providers.
            Sirf aapke area ke experts.
          </p>
        </div>
      </section>

      {/* Partner type grid */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {PARTNER_TYPES.map(p => (
              <div key={p.title} className="card border border-gray-100 hover:border-teal-300 hover:shadow-md transition-all flex flex-col">
                <span className="text-4xl mb-3">{p.icon}</span>
                <h3 className="font-bold text-navy-700 text-lg">{p.title}</h3>
                <p className="text-teal-600 text-sm mb-2">{p.hindi}</p>
                <p className="text-gray-500 text-sm leading-relaxed flex-1 mb-4">{p.desc}</p>
                {p.wa ? (
                  <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Hamara%20hospital%20Sehatsandhi%20se%20juna%20chahta%20hai.`}
                     target="_blank" rel="noreferrer"
                     className="btn-navy text-sm justify-center">
                    {p.cta}
                  </a>
                ) : (
                  <Link to={p.to!} className="btn-teal text-sm justify-center">
                    {p.cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Partner Promise */}
      <section className="py-16 bg-navy-700 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            The Sehatsandhi Partner Promise
          </h2>
          <p className="text-white/70 leading-relaxed">
            Har partner ne ek commitment ki hai. Jab woh koi PIN code choose
            karte hain, toh us area ke patients ko <strong className="text-white">door service</strong> guarantee
            ki jaati hai. Yeh sirf listing nahi — yeh service ka wada hai.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6 text-sm">
            <span className="bg-white/10 px-4 py-2 rounded-full">💊 Medicine Delivery</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">🔬 Home Sample Collection</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">🚑 Emergency Response</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">🛡️ Home Insurance Visits</span>
          </div>
        </div>
      </section>

      <FAQSection items={faqs} subtitle="Partner banne se pehle jaan lein" />

      {/* CTA */}
      <section className="py-16 bg-gray-50 text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-navy-700 mb-4">
            Sehatsandhi se jud'ein aaj hi
          </h2>
          <p className="text-gray-500 mb-6">Koi sawaal hai? Humein seedha WhatsApp karein</p>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Main%20Sehatsandhi%20partner%20banna%20chahta%20hoon.`}
             target="_blank" rel="noreferrer"
             className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            📱 WhatsApp par Baat Karein
          </a>
        </div>
      </section>

    </div>
  )
}
