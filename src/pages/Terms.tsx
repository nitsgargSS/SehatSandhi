import { Link } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// `link` is optional, so the sections array needs an explicit element type —
// inferred from the literal alone, the one section that carries a link would
// widen `sections` to a union and `s.link` would not typecheck on the rest.
interface Section {
  h: string
  p: string
  link?: { to: string; label: string }
}

interface Content {
  title: string
  updated: string
  intro: string
  sections: Section[]
}

const content: Record<'en' | 'hi', Content> = {
  en: {
    title: 'Terms of Service',
    updated: 'Last updated: August 2026',
    intro: 'These terms govern your use of Sehatsandhi, operated by NG Technologies. By using our WhatsApp service or website, you agree to these terms.',
    sections: [
      {
        h: '1. What Sehatsandhi Is',
        p: 'Sehatsandhi is a platform that aggregates independent, verified doctors and clinics, and helps patients book appointments with them — in Yamuna Nagar district. We are a booking facilitator, not a healthcare provider: we do not employ doctors, provide medical advice, make treatment decisions, or maintain any patient\'s medical records.',
      },
      {
        h: '2. Verification, Not Guarantee',
        p: "We verify each doctor's registration against official medical council records before listing them. This confirms their registration is genuine — it does not constitute an endorsement of their clinical judgment, and we cannot guarantee the outcome of any consultation or treatment.",
      },
      {
        h: '3. Patient Responsibilities',
        p: 'You agree to provide accurate information when booking, to attend booked appointments or cancel with reasonable notice, and to follow your doctor\'s professional advice. Sehatsandhi is free for patients — we never charge you to book or use the service.',
      },
      {
        h: '4. Doctor and Partner Responsibilities',
        p: 'Doctors and partners agree to maintain valid, current licenses/registrations, keep their listed information accurate, and honor the service commitments described during registration (such as response times for ambulance services or delivery capability for pharmacies).',
      },
      {
        h: '5. Fees and Payment',
        p: 'Doctors and partners pay a listing fee as described during registration. Fees are non-refundable except as described in our Refund & Cancellation Policy. We do not guarantee any specific volume of patients or bookings.',
        link: { to: '/refund', label: 'Read the Refund & Cancellation Policy →' },
      },
      {
        h: '6. Ratings Are Earned, Not Purchased',
        p: 'Patient ratings can only be submitted by patients who completed a real appointment booked through Sehatsandhi. No payment, including for premium/featured positioning, can influence a doctor\'s rating or "Top Rated" status.',
      },
      {
        h: '7. Limitation of Liability',
        p: 'Sehatsandhi is not liable for the actions, advice, or treatment provided by any doctor or partner listed on our platform. Any dispute regarding medical treatment is between you and the treating doctor. We are not liable for indirect or consequential damages arising from use of our service.',
      },
      {
        h: '8. Prohibited Use',
        p: 'You may not use Sehatsandhi to impersonate another person, provide false medical credentials, harass other users, or attempt to circumvent our verification processes.',
      },
      {
        h: '9. Termination',
        p: 'We may suspend or terminate a doctor, partner, or patient\'s access to Sehatsandhi for violating these terms, providing false information, or engaging in conduct harmful to other users.',
      },
      {
        h: '10. Governing Law',
        p: 'These terms are governed by the laws of India, with courts in Yamuna Nagar, Haryana having jurisdiction over any disputes.',
      },
      {
        h: '11. Changes to These Terms',
        p: 'We may update these terms from time to time. Continued use of Sehatsandhi after changes constitutes acceptance of the updated terms.',
      },
      {
        h: '12. Contact Us',
        p: 'For questions about these terms, message us on WhatsApp or reach us via the details on our Contact page.',
      },
    ],
  },
  hi: {
    title: 'सेवा की शर्तें',
    updated: 'आखिरी अपडेट: अगस्त 2026',
    intro: 'ये शर्तें Sehatsandhi के इस्तेमाल को गवर्न करती हैं, जो NG Technologies द्वारा संचालित है। हमारी WhatsApp सर्विस या वेबसाइट इस्तेमाल करके, आप इन शर्तों से सहमत होते हैं।',
    sections: [
      {
        h: '1. Sehatsandhi क्या है',
        p: 'Sehatsandhi एक प्लेटफॉर्म है जो यमुना नगर ज़िले में मरीज़ों को इंडिपेंडेंट, वेरिफाइड डॉक्टरों और हेल्थकेयर पार्टनर्स (फार्मेसी, लैब, एम्बुलेंस सर्विस, इंश्योरेंस एजेंट) से जोड़ता है। हम एक फैसिलिटेटर हैं, हेल्थकेयर प्रोवाइडर नहीं — हम डॉक्टरों को एम्प्लॉय नहीं करते, मेडिकल एडवाइस नहीं देते, या ट्रीटमेंट डिसीज़न नहीं लेते।',
      },
      {
        h: '2. वेरिफिकेशन, गारंटी नहीं',
        p: 'हम हर डॉक्टर की रजिस्ट्रेशन ऑफिशियल मेडिकल काउंसिल रिकॉर्ड्स के खिलाफ वेरिफाई करते हैं उन्हें लिस्ट करने से पहले। यह कन्फर्म करता है कि उनकी रजिस्ट्रेशन जेन्युइन है — यह उनके क्लिनिकल जजमेंट का एंडोर्समेंट नहीं है, और हम किसी भी कंसल्टेशन या ट्रीटमेंट के आउटकम की गारंटी नहीं दे सकते।',
      },
      {
        h: '3. मरीज़ की ज़िम्मेदारियां',
        p: 'आप बुकिंग करते समय सही जानकारी देने, बुक की गई अपॉइंटमेंट अटेंड करने या रीज़नेबल नोटिस के साथ कैंसिल करने, और अपने डॉक्टर की प्रोफेशनल एडवाइस फॉलो करने के लिए सहमत होते हैं। Sehatsandhi मरीज़ों के लिए फ्री है — हम आपसे बुक करने या सर्विस इस्तेमाल करने के लिए कभी चार्ज नहीं करते।',
      },
      {
        h: '4. डॉक्टर और पार्टनर की ज़िम्मेदारियां',
        p: 'डॉक्टर और पार्टनर वैलिड, करंट लाइसेंस/रजिस्ट्रेशन मेंटेन करने, अपनी लिस्टेड जानकारी सही रखने, और रजिस्ट्रेशन के दौरान बताए गए सर्विस कमिटमेंट्स (जैसे एम्बुलेंस सर्विसेज़ के लिए रिस्पॉन्स टाइम या फार्मेसी के लिए डिलीवरी कैपेबिलिटी) निभाने के लिए सहमत होते हैं।',
      },
      {
        h: '5. फीस और पेमेंट',
        p: 'डॉक्टर और पार्टनर रजिस्ट्रेशन के दौरान बताई गई लिस्टिंग फीस पे करते हैं। फीस नॉन-रिफंडेबल है सिवाय हमारी रिफंड और कैंसिलेशन पॉलिसी में बताए गए मामलों के। हम किसी स्पेसिफिक मरीज़ों की संख्या या बुकिंग्स की गारंटी नहीं देते।',
        link: { to: '/refund', label: 'रिफंड और कैंसिलेशन पॉलिसी पढ़ें →' },
      },
      {
        h: '6. रेटिंग्स कमाई जाती हैं, खरीदी नहीं जातीं',
        p: 'मरीज़ों की रेटिंग्स सिर्फ उन मरीज़ों द्वारा सबमिट की जा सकती हैं जिन्होंने Sehatsandhi के थ्रू बुक की गई एक रियल अपॉइंटमेंट कम्प्लीट की है। कोई भी पेमेंट, प्रीमियम/फीचर्ड पोज़ीशनिंग सहित, डॉक्टर की रेटिंग या "Top Rated" स्टेटस को प्रभावित नहीं कर सकती।',
      },
      {
        h: '7. लायबिलिटी की सीमा',
        p: 'Sehatsandhi हमारे प्लेटफॉर्म पर लिस्टेड किसी भी डॉक्टर या पार्टनर द्वारा दी गई एक्शन्स, एडवाइस, या ट्रीटमेंट के लिए लायबल नहीं है। मेडिकल ट्रीटमेंट से जुड़ा कोई भी विवाद आपके और ट्रीटिंग डॉक्टर के बीच है। हम अपनी सर्विस के इस्तेमाल से होने वाले इनडायरेक्ट या कंसीक्वेंशियल डैमेजेज़ के लिए लायबल नहीं हैं।',
      },
      {
        h: '8. प्रतिबंधित इस्तेमाल',
        p: 'आप Sehatsandhi का इस्तेमाल किसी और व्यक्ति की नकल करने, गलत मेडिकल क्रेडेंशियल्स देने, दूसरे यूज़र्स को हैरास करने, या हमारे वेरिफिकेशन प्रोसेस को बायपास करने की कोशिश करने के लिए नहीं कर सकते।',
      },
      {
        h: '9. टर्मिनेशन',
        p: 'हम इन शर्तों का उल्लंघन करने, गलत जानकारी देने, या दूसरे यूज़र्स को नुकसान पहुंचाने वाले व्यवहार में शामिल होने पर किसी डॉक्टर, पार्टनर, या मरीज़ की Sehatsandhi तक एक्सेस सस्पेंड या टर्मिनेट कर सकते हैं।',
      },
      {
        h: '10. गवर्निंग लॉ',
        p: 'ये शर्तें भारत के कानूनों द्वारा गवर्न होती हैं, यमुना नगर, हरियाणा की अदालतों के पास किसी भी विवाद पर जूरिसडिक्शन है।',
      },
      {
        h: '11. इन शर्तों में बदलाव',
        p: 'हम समय-समय पर इन शर्तों को अपडेट कर सकते हैं। बदलाव के बाद Sehatsandhi का लगातार इस्तेमाल अपडेटेड शर्तों को स्वीकार करना माना जाएगा।',
      },
      {
        h: '12. हमसे संपर्क करें',
        p: 'इन शर्तों के बारे में सवालों के लिए, हमें WhatsApp पर मैसेज करें या हमारे संपर्क पेज पर दी गई डिटेल्स से संपर्क करें।',
      },
    ],
  },
}

export default function Terms() {
  const { lang } = useLanguage()
  const c = content[lang]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SiteHeader />

      <div className="w-full max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold text-navy-700 mb-1">{c.title}</h1>
        <p className="text-gray-400 text-sm mb-8">{c.updated}</p>
        <p className="text-gray-600 leading-relaxed mb-8">{c.intro}</p>

        <div className="space-y-6">
          {c.sections.map(s => (
            <div key={s.h}>
              <h2 className="font-bold text-navy-700 mb-2">{s.h}</h2>
              <p className="text-gray-600 text-sm leading-relaxed">{s.p}</p>
              {s.link && (
                <Link to={s.link.to} className="inline-block mt-2 text-sm font-medium text-teal-600 hover:text-teal-700 hover:underline">
                  {s.link.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}
