import { MapPin, ShieldCheck, Star, MessageCircle } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { WA_NUMBER } from '../types'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// The copy names no town on purpose. Coverage is expected to grow, and a page
// that says "Yamuna Nagar and Jagadhri" becomes wrong the week a new district
// opens — so it describes the mechanism instead: you give a PIN code, we show
// who is near you. That stays true at any size.
//
// The one exception is legalLine, which carries the registered address and has
// to match the GST certificate character for character. Do not generalise it.
const content = {
  en: {
    title: 'About Sehatsandhi',
    subtitle: "Health's New Partnership",
    p1: 'Sehatsandhi (सेहतसंधि) connects patients with verified doctors and healthcare partners in their own area — you tell us your PIN code, we show you who is available nearby. Right on WhatsApp, with no app to download and no forms to fill.',
    p2: 'We built Sehatsandhi because finding a trustworthy doctor in a smaller town shouldn\'t mean relying on word of mouth alone, or navigating platforms built for metro cities that don\'t understand local needs.',
    legalLine: 'Sehatsandhi is operated by NG Technologies, registered at 1743 Vishnu Garden, Jagadhri – 135003, Haryana, India.',
    valuesTitle: 'What We Stand For',
    values: [
      { icon: 'shield', title: 'Real Verification', desc: 'Every doctor is checked against official medical council registration before being listed — not a self-reported checkbox.' },
      { icon: 'star', title: 'Ratings You Can Trust', desc: 'Only patients with a completed, verified appointment can leave a rating. Paid placement never influences a doctor\'s rating or "Top Rated" status.' },
      { icon: 'map', title: 'Built for Your Area', desc: 'Population-based pricing, local language, and coverage designed around the towns we actually serve — not a generic template built for metro cities.' },
      { icon: 'message', title: 'No App Needed', desc: 'Everything happens on WhatsApp, the platform people already use every day — completely free for patients.' },
    ],
    contactTitle: 'Get in Touch',
    contactDesc: 'Have a question, or want to register your clinic or business? Message us directly on WhatsApp.',
  },
  hi: {
    title: 'Sehatsandhi के बारे में',
    subtitle: 'स्वास्थ्य की नई साझेदारी',
    p1: 'Sehatsandhi (सेहतसंधि) मरीज़ों को उनके अपने इलाके के वेरिफाइड डॉक्टरों और हेल्थकेयर पार्टनर्स से जोड़ता है — आप अपना PIN कोड बताइए, हम आपको पास में उपलब्ध डॉक्टर दिखाते हैं। सीधे WhatsApp पर, कोई ऐप डाउनलोड नहीं, कोई फॉर्म नहीं।',
    p2: 'हमने Sehatsandhi इसलिए बनाया क्योंकि एक छोटे शहर में भरोसेमंद डॉक्टर ढूंढने का मतलब सिर्फ वर्ड ऑफ माउथ पर निर्भर रहना, या मेट्रो शहरों के लिए बने प्लेटफॉर्म इस्तेमाल करना नहीं होना चाहिए जो लोकल ज़रूरतें नहीं समझते।',
    legalLine: 'Sehatsandhi NG Technologies द्वारा संचालित है, रजिस्टर्ड पता: 1743 Vishnu Garden, Jagadhri – 135003, Haryana, India।',
    valuesTitle: 'हम किस बात के लिए खड़े हैं',
    values: [
      { icon: 'shield', title: 'रियल वेरिफिकेशन', desc: 'हर डॉक्टर को लिस्ट करने से पहले ऑफिशियल मेडिकल काउंसिल रजिस्ट्रेशन के खिलाफ चेक किया जाता है — सिर्फ एक सेल्फ-रिपोर्टेड चेकबॉक्स नहीं।' },
      { icon: 'star', title: 'रेटिंग्स जिन पर आप भरोसा कर सकते हैं', desc: 'सिर्फ वो मरीज़ जिन्होंने एक कम्प्लीटेड, वेरिफाइड अपॉइंटमेंट की है, रेटिंग दे सकते हैं। पेड प्लेसमेंट कभी भी डॉक्टर की रेटिंग या "Top Rated" स्टेटस को प्रभावित नहीं करता।' },
      { icon: 'map', title: 'आपके इलाके के लिए बना', desc: 'पॉपुलेशन-बेस्ड प्राइसिंग, लोकल भाषा, और कवरेज उन कस्बों के हिसाब से डिज़ाइन किया गया जहां हम असल में काम करते हैं — मेट्रो शहरों के लिए बना कोई जेनरिक टेम्पलेट नहीं।' },
      { icon: 'message', title: 'कोई ऐप ज़रूरी नहीं', desc: 'सब कुछ WhatsApp पर होता है, वो प्लेटफॉर्म जो लोग पहले से हर दिन इस्तेमाल करते हैं — मरीज़ों के लिए बिल्कुल फ्री।' },
    ],
    contactTitle: 'संपर्क करें',
    contactDesc: 'कोई सवाल है, या अपनी क्लिनिक या बिज़नेस रजिस्टर करना चाहते हैं? हमें सीधे WhatsApp पर मैसेज करें।',
  },
}

const icons: Record<string, any> = { shield: ShieldCheck, star: Star, map: MapPin, message: MessageCircle }

export default function About() {
  const { lang } = useLanguage()
  const c = content[lang]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SiteHeader />

      <div className="w-full max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold text-navy-700 mb-1">{c.title}</h1>
        <p className="text-teal-600 font-medium mb-8">{c.subtitle}</p>

        <p className="text-gray-600 leading-relaxed mb-4">{c.p1}</p>
        <p className="text-gray-600 leading-relaxed mb-6">{c.p2}</p>

        {/* Legal entity clarity — specifically required by Meta when
            brand name and legal entity name differ */}
        <p className="text-gray-400 text-sm mb-10 bg-gray-100 rounded-lg p-3">{c.legalLine}</p>

        <h2 className="text-xl font-bold text-navy-700 mb-4">{c.valuesTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {c.values.map(v => {
            const Icon = icons[v.icon]
            return (
              <div key={v.title} className="card">
                <Icon className="w-6 h-6 text-teal-500 mb-2" />
                <p className="font-bold text-navy-700 text-sm mb-1">{v.title}</p>
                <p className="text-gray-500 text-xs leading-relaxed">{v.desc}</p>
              </div>
            )
          })}
        </div>

        {/* The copy above says "message us on WhatsApp", so the button does
            that. It used to go to the homepage. */}
        <div className="bg-navy-700 rounded-2xl p-6 text-white text-center">
          <h3 className="font-bold mb-2">{c.contactTitle}</h3>
          <p className="text-white/70 text-sm mb-4">{c.contactDesc}</p>
          <a href={`https://wa.me/${WA_NUMBER}`} target="_blank" rel="noreferrer"
             className="bg-white text-navy-700 font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-gray-50 transition inline-block">
            {lang === 'hi' ? 'WhatsApp पर मैसेज करें' : 'Message us on WhatsApp'}
          </a>
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}
