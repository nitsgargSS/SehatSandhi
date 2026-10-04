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
    updated: 'Last updated: 4 October 2026',
    intro: 'These terms govern your use of Sehatsandhi, operated by NG Technologies. By using our WhatsApp service or website, you agree to these terms.',
    sections: [
      {
        h: '1. What Sehatsandhi Is',
        p: 'Sehatsandhi does two things. For patients, it helps you find and book independent, verified doctors, clinics and healthcare partners in the pincodes we currently serve. On WhatsApp it also passes your medicine order to pharmacies that deliver to your area, your ambulance request to ambulance services nearby, and your health-insurance question to licensed advisors near you. For clinics, hospitals and partners, it provides software to run their work — appointments, OPD and IPD records, prescriptions, billing, an in-house pharmacy, medicine orders, ambulance trips, insurance leads and reports. We are a technology provider, not a healthcare provider, pharmacy, ambulance operator or insurer: we do not employ doctors, give medical advice, sell medicines, run ambulances, sell insurance or make treatment decisions.',
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
        p: 'Doctors and partners agree to maintain valid, current licences and registrations, keep their listed information accurate, serve only the areas they say they serve, and use a patient\'s details only to serve that patient. Pharmacies must hold a valid drug licence, check that every prescription-only (Schedule H/H1) medicine is backed by a valid prescription before pricing an order, never supply Schedule X medicines through Sehatsandhi, and deliver at the price the patient approved. Ambulance services must hold the registrations and permits their vehicles need and accept a request only if they can reach the patient. Insurance advisors must hold a valid IRDAI licence or POSP code, shown to the person, and must explain plans honestly; Sehatsandhi is not an insurer or insurance intermediary and takes no part of any commission or premium.',
      },
      {
        h: '5. Clinic Software and Patient Records',
        p: 'Clinics and hospitals that use our OPD, IPD, pharmacy or billing systems keep their patients\' records on Sehatsandhi. Those records belong to the clinic, which is responsible for what it records, for having the patient\'s consent where the law requires it, for the bills and tax invoices it issues to its own patients (including GST where it applies), and for its own licences, including a drug licence where it dispenses medicines. We store and protect the records on the clinic\'s behalf, show them only to the staff roles the clinic allows, and do not use them for any other purpose.',
      },
      {
        h: '6. Fees and Payment',
        p: 'Clinics, hospitals, labs, pharmacies and ambulance services pay a listing fee for the term they choose, shown in full before they pay; the OPD and IPD systems are currently included for clinics and hospitals at no extra charge. Insurance advisors list free and pay a flat fee, shown before they accept, for each lead they choose to accept, taken from a prepaid wallet. Sehatsandhi charges no commission on any consultation, medicine order, ambulance trip or insurance policy. Optional add-ons, such as WhatsApp messaging, are priced at checkout. Fees are non-refundable except as described in our Refund & Cancellation Policy. We do not guarantee any specific volume of patients, orders, trips or leads.',
        link: { to: '/refund', label: 'Read the Refund & Cancellation Policy →' },
      },
      {
        h: '7. Medicine Orders, Ambulances and Insurance',
        p: 'Medicine orders: the pharmacy that accepts your order sets the price of the medicines and any delivery fee, and nothing is delivered until you approve that total on your order link. You pay the pharmacy directly; it is responsible for the medicines, any substitute it suggests, and any return or refund. Ambulances: in an emergency always call 108, the free government ambulance — we show it first and you never need to wait for us; a private ambulance service that accepts your request is responsible for the trip and its fare, which you pay to it directly. Insurance: the advice, the plan and the policy are between you and the advisor and their insurer. Sehatsandhi only passes your request on and is not responsible for a pharmacy\'s, ambulance service\'s or advisor\'s service — but tell us if something goes wrong (Contact page) and we will act on it, up to removing the partner.',
      },
      {
        h: '8. Ratings Are Earned, Not Purchased',
        p: 'A rating can only be given by a patient who booked a real appointment, order, trip or request through Sehatsandhi, after it, from the phone number or link it was made with. No payment, including for premium/featured positioning, can influence a doctor\'s rating or "Top Rated" status.',
      },
      {
        h: '9. Limitation of Liability',
        p: 'Sehatsandhi is not liable for the actions, advice, treatment, medicines, transport or insurance provided by any doctor or partner listed on our platform. Any dispute regarding medical treatment is between you and the treating doctor, and about an order, trip or policy between you and that partner. We are not liable for indirect or consequential damages arising from use of our service.',
      },
      {
        h: '10. Prohibited Use',
        p: 'You may not use Sehatsandhi to impersonate another person, provide false medical credentials, harass other users, or attempt to circumvent our verification processes.',
      },
      {
        h: '11. Termination',
        p: 'We may suspend or terminate a doctor, partner, or patient\'s access to Sehatsandhi for violating these terms, providing false information, or engaging in conduct harmful to other users.',
      },
      {
        h: '12. Governing Law',
        p: 'These terms are governed by the laws of India, with courts in Yamuna Nagar, Haryana having jurisdiction over any disputes.',
      },
      {
        h: '13. Changes to These Terms',
        p: 'We may update these terms from time to time. Continued use of Sehatsandhi after changes constitutes acceptance of the updated terms.',
      },
      {
        h: '14. Contact Us',
        p: 'For questions about these terms, use the form on our Contact page, email contact@sehatsandhi.com, or message us on WhatsApp.',
      },
    ],
  },
  hi: {
    title: 'सेवा की शर्तें',
    updated: 'आखिरी अपडेट: 4 अक्टूबर 2026',
    intro: 'ये शर्तें Sehatsandhi के इस्तेमाल को गवर्न करती हैं, जो NG Technologies द्वारा संचालित है। हमारी WhatsApp सर्विस या वेबसाइट इस्तेमाल करके, आप इन शर्तों से सहमत होते हैं।',
    sections: [
      {
        h: '1. Sehatsandhi क्या है',
        p: 'Sehatsandhi दो काम करता है। मरीज़ों के लिए — जिन पिनकोड्स में हम उपलब्ध हैं, वहां इंडिपेंडेंट, वेरिफाइड डॉक्टर, क्लिनिक और हेल्थकेयर पार्टनर (फार्मेसी, लैब, एम्बुलेंस, इंश्योरेंस सलाहकार) ढूंढने और बुक करने में मदद। WhatsApp पर यह आपका दवाई का ऑर्डर आपके इलाके में डिलीवरी करने वाली फार्मेसी तक, एम्बुलेंस का अनुरोध पास की एम्बुलेंस सेवाओं तक, और स्वास्थ्य बीमा का सवाल पास के लाइसेंस वाले सलाहकारों तक पहुँचाता है। क्लिनिक, हॉस्पिटल और पार्टनर्स के लिए — अपना काम चलाने का सॉफ्टवेयर: अपॉइंटमेंट, OPD और IPD रिकॉर्ड, प्रिस्क्रिप्शन, बिलिंग, इन-हाउस फार्मेसी, दवाई के ऑर्डर, एम्बुलेंस यात्राएँ, बीमा लीड्स और रिपोर्ट्स। हम टेक्नोलॉजी प्रोवाइडर हैं — हेल्थकेयर प्रोवाइडर, फार्मेसी, एम्बुलेंस ऑपरेटर या बीमा कंपनी नहीं: हम डॉक्टरों को एम्प्लॉय नहीं करते, मेडिकल एडवाइस नहीं देते, दवाइयाँ नहीं बेचते, एम्बुलेंस नहीं चलाते, बीमा नहीं बेचते, या ट्रीटमेंट डिसीज़न नहीं लेते।',
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
        p: 'डॉक्टर और पार्टनर वैलिड, करंट लाइसेंस और रजिस्ट्रेशन रखने, अपनी लिस्टेड जानकारी सही रखने, सिर्फ उन्हीं इलाकों में सेवा देने जो उन्होंने चुने हैं, और मरीज़ की जानकारी सिर्फ उसकी सेवा के लिए इस्तेमाल करने के लिए सहमत होते हैं। फार्मेसी के पास वैलिड ड्रग लाइसेंस होना चाहिए; ऑर्डर की कीमत बताने से पहले उसे जाँचना होगा कि हर प्रिस्क्रिप्शन वाली (Schedule H/H1) दवाई के लिए वैलिड पर्ची है; Schedule X दवाइयाँ Sehatsandhi के ज़रिए कभी नहीं देनी; और मरीज़ ने जो कीमत मानी, उसी पर डिलीवरी करनी होगी। एम्बुलेंस सेवा के पास अपनी गाड़ियों के ज़रूरी रजिस्ट्रेशन और परमिट होने चाहिए, और वह अनुरोध तभी स्वीकार करे जब मरीज़ तक पहुँच सके। बीमा सलाहकार के पास वैलिड IRDAI लाइसेंस या POSP कोड होना चाहिए, जो व्यक्ति को दिखाया जाता है, और उसे प्लान ईमानदारी से समझाने होंगे; Sehatsandhi न बीमा कंपनी है न बीमा इंटरमीडियरी, और किसी कमीशन या प्रीमियम का कोई हिस्सा नहीं लेता।',
      },
      {
        h: '5. क्लिनिक सॉफ्टवेयर और मरीज़ों के रिकॉर्ड',
        p: 'जो क्लिनिक और हॉस्पिटल हमारे OPD, IPD, फार्मेसी या बिलिंग सिस्टम इस्तेमाल करते हैं, वे अपने मरीज़ों के रिकॉर्ड Sehatsandhi पर रखते हैं। ये रिकॉर्ड क्लिनिक के हैं — जो कुछ रिकॉर्ड किया जाता है, जहां कानून ज़रूरी बनाता है वहां मरीज़ की सहमति, अपने मरीज़ों को दिए गए बिल और टैक्स इनवॉइस (जहां लागू हो वहां GST सहित), और अपने लाइसेंस (दवाइयां देने पर ड्रग लाइसेंस सहित) की ज़िम्मेदारी क्लिनिक की है। हम ये रिकॉर्ड क्लिनिक की ओर से सुरक्षित रखते हैं, सिर्फ उन्हीं स्टाफ रोल्स को दिखाते हैं जिन्हें क्लिनिक अनुमति देता है, और किसी और काम में इस्तेमाल नहीं करते।',
      },
      {
        h: '6. फीस और पेमेंट',
        p: 'क्लिनिक, हॉस्पिटल, लैब, फार्मेसी और एम्बुलेंस सेवाएँ अपनी चुनी हुई अवधि के लिए लिस्टिंग फीस देते हैं, जो पेमेंट से पहले पूरी दिखाई जाती है; क्लिनिक और हॉस्पिटल के लिए OPD और IPD सिस्टम फ़िलहाल बिना अतिरिक्त चार्ज के शामिल हैं। बीमा सलाहकार मुफ़्त लिस्ट होते हैं और जो लीड वे स्वीकार करना चुनें, हर लीड के लिए एक तय फीस देते हैं — जो स्वीकार करने से पहले दिखती है और प्रीपेड वॉलेट से कटती है। Sehatsandhi किसी कंसल्टेशन, दवाई के ऑर्डर, एम्बुलेंस यात्रा या बीमा पॉलिसी पर कोई कमीशन नहीं लेता। WhatsApp मैसेजिंग जैसे ऑप्शनल ऐड-ऑन की कीमत चेकआउट पर दिखती है। फीस नॉन-रिफंडेबल है सिवाय हमारी रिफंड और कैंसिलेशन पॉलिसी में बताए गए मामलों के। हम किसी तय संख्या में मरीज़, ऑर्डर, यात्राएँ या लीड्स की गारंटी नहीं देते।',
        link: { to: '/refund', label: 'रिफंड और कैंसिलेशन पॉलिसी पढ़ें →' },
      },
      {
        h: '7. दवाई के ऑर्डर, एम्बुलेंस और बीमा',
        p: 'दवाई के ऑर्डर: जो फार्मेसी आपका ऑर्डर स्वीकार करती है, वही दवाइयों की कीमत और डिलीवरी फीस (अगर हो) तय करती है, और जब तक आप अपने ऑर्डर लिंक पर कुल कीमत को हाँ न कहें, कुछ डिलीवर नहीं होता। पेमेंट आप सीधे फार्मेसी को करते हैं; दवाइयों, उसकी सुझाई किसी दूसरी ब्रांड, और किसी वापसी या रिफंड की ज़िम्मेदारी फार्मेसी की है। एम्बुलेंस: इमरजेंसी में हमेशा 108 पर कॉल करें — यह मुफ़्त सरकारी एम्बुलेंस है; हम इसे सबसे पहले दिखाते हैं और आपको हमारा इंतज़ार कभी नहीं करना पड़ता। जो प्राइवेट एम्बुलेंस सेवा आपका अनुरोध स्वीकार करती है, यात्रा और उसका किराया उसकी ज़िम्मेदारी है, जो आप सीधे उसे देते हैं। बीमा: सलाह, प्लान और पॉलिसी आपके और सलाहकार व उसकी बीमा कंपनी के बीच है। Sehatsandhi सिर्फ आपका अनुरोध आगे पहुँचाता है और किसी फार्मेसी, एम्बुलेंस सेवा या सलाहकार की सेवा के लिए ज़िम्मेदार नहीं है — पर कुछ गलत हो तो हमें बताइए (संपर्क पेज), हम कार्रवाई करेंगे, पार्टनर को हटाने तक।',
      },
      {
        h: '8. रेटिंग्स कमाई जाती हैं, खरीदी नहीं जातीं',
        p: 'रेटिंग सिर्फ वही मरीज़ दे सकता है जिसने Sehatsandhi से असली अपॉइंटमेंट बुक की हो — विज़िट के बाद, उसी फ़ोन नंबर से जिस पर बुकिंग हुई थी। कोई भी पेमेंट, प्रीमियम/फीचर्ड पोज़ीशनिंग सहित, डॉक्टर की रेटिंग या "Top Rated" स्टेटस को प्रभावित नहीं कर सकती।',
      },
      {
        h: '9. लायबिलिटी की सीमा',
        p: 'Sehatsandhi हमारे प्लेटफॉर्म पर लिस्टेड किसी भी डॉक्टर या पार्टनर द्वारा दी गई एक्शन्स, एडवाइस, ट्रीटमेंट, दवाइयों, ट्रांसपोर्ट या बीमा के लिए लायबल नहीं है। मेडिकल ट्रीटमेंट से जुड़ा कोई भी विवाद आपके और ट्रीटिंग डॉक्टर के बीच है, और किसी ऑर्डर, यात्रा या पॉलिसी का विवाद आपके और उस पार्टनर के बीच। हम अपनी सर्विस के इस्तेमाल से होने वाले इनडायरेक्ट या कंसीक्वेंशियल डैमेजेज़ के लिए लायबल नहीं हैं।',
      },
      {
        h: '10. प्रतिबंधित इस्तेमाल',
        p: 'आप Sehatsandhi का इस्तेमाल किसी और व्यक्ति की नकल करने, गलत मेडिकल क्रेडेंशियल्स देने, दूसरे यूज़र्स को हैरास करने, या हमारे वेरिफिकेशन प्रोसेस को बायपास करने की कोशिश करने के लिए नहीं कर सकते।',
      },
      {
        h: '11. टर्मिनेशन',
        p: 'हम इन शर्तों का उल्लंघन करने, गलत जानकारी देने, या दूसरे यूज़र्स को नुकसान पहुंचाने वाले व्यवहार में शामिल होने पर किसी डॉक्टर, पार्टनर, या मरीज़ की Sehatsandhi तक एक्सेस सस्पेंड या टर्मिनेट कर सकते हैं।',
      },
      {
        h: '12. गवर्निंग लॉ',
        p: 'ये शर्तें भारत के कानूनों द्वारा गवर्न होती हैं, यमुना नगर, हरियाणा की अदालतों के पास किसी भी विवाद पर जूरिसडिक्शन है।',
      },
      {
        h: '13. इन शर्तों में बदलाव',
        p: 'हम समय-समय पर इन शर्तों को अपडेट कर सकते हैं। बदलाव के बाद Sehatsandhi का लगातार इस्तेमाल अपडेटेड शर्तों को स्वीकार करना माना जाएगा।',
      },
      {
        h: '14. हमसे संपर्क करें',
        p: 'इन शर्तों के बारे में सवालों के लिए, हमारे संपर्क पेज का फ़ॉर्म भरें, contact@sehatsandhi.com पर ईमेल करें, या WhatsApp पर मैसेज करें।',
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
