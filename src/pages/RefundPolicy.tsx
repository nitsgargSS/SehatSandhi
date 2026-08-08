import { useLanguage } from '../i18n/LanguageContext'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

const content = {
  en: {
    title: 'Refund & Cancellation Policy',
    updated: 'Last updated: August 2026',
    intro: 'This policy explains refunds and cancellations for doctors and partners who pay a listing fee on Sehatsandhi. Sehatsandhi is completely free for patients — this policy does not apply to patients, who never pay us directly.',
    sections: [
      {
        h: '1. Refund Eligibility — 3-Day Window',
        p: "If you're not satisfied with the service, you may request a refund within 3 days of your listing being activated. Refunds are evaluated as per these terms and conditions, and processed once approved.",
      },
      {
        h: '2. No Refund After Extended Use',
        p: "Once our marketing and listing services have been in active use for a period of time — for example, a full month — no refund will be provided, regardless of the outcome or your satisfaction level at that point. The 3-day window in Section 1 is the only period during which a refund based on dissatisfaction can be requested.",
      },
      {
        h: '3. Before Verification',
        p: "If your registration is rejected during our verification process (for example, if we're unable to confirm your medical registration), any fee paid will be fully refunded, as this falls outside the standard refund window described above.",
      },
      {
        h: '4. Premium/Featured Positioning',
        p: 'Premium positioning is billed for the period selected as per our current pricing terms, and is treated the same as standard listing fees for refund purposes — see Sections 1 and 2 above.',
      },
      {
        h: '5. Service Non-Delivery',
        p: "If we are unable to deliver the listing service due to a technical issue on our end for an extended period, we will either extend your listing period at no charge or provide a prorated refund for the affected time, at your choice — independent of the 3-day window above.",
      },
      {
        h: '6. How to Request a Refund',
        p: 'Message us on WhatsApp or use the contact details on our homepage, along with your registered phone number and reason for the request. We aim to respond within 2 business days.',
      },
      {
        h: '7. Processing Time',
        p: 'Approved refunds are processed within 7 business days to the original payment method.',
      },
    ],
  },
  hi: {
    title: 'रिफंड और कैंसिलेशन पॉलिसी',
    updated: 'आखिरी अपडेट: अगस्त 2026',
    intro: 'यह पॉलिसी डॉक्टरों और पार्टनर्स के लिए रिफंड और कैंसिलेशन को बताती है जो Sehatsandhi पर लिस्टिंग फीस पे करते हैं। Sehatsandhi मरीज़ों के लिए बिल्कुल फ्री है — यह पॉलिसी मरीज़ों पर लागू नहीं होती, जो हमें कभी सीधे पे नहीं करते।',
    sections: [
      {
        h: '1. रिफंड एलिजिबिलिटी — 3-दिन की विंडो',
        p: 'अगर आप सर्विस से सैटिस्फाइड नहीं हैं, तो आप अपनी लिस्टिंग एक्टिवेट होने के 3 दिन के अंदर रिफंड रिक्वेस्ट कर सकते हैं। रिफंड्स इन नियम और शर्तों के हिसाब से इवैल्यूएट किए जाते हैं, और अप्रूव होने के बाद प्रोसेस किए जाते हैं।',
      },
      {
        h: '2. एक्सटेंडेड इस्तेमाल के बाद कोई रिफंड नहीं',
        p: 'एक बार हमारी मार्केटिंग और लिस्टिंग सर्विसेज़ एक पीरियड के लिए एक्टिव इस्तेमाल में आ जाएं — उदाहरण के लिए, पूरा एक महीना — तो कोई रिफंड नहीं दिया जाएगा, चाहे उस पॉइंट पर आउटकम या आपकी सैटिस्फैक्शन लेवल कुछ भी हो। सेक्शन 1 में बताई गई 3-दिन की विंडो ही एकमात्र पीरियड है जिसमें डिसैटिस्फैक्शन के आधार पर रिफंड रिक्वेस्ट किया जा सकता है।',
      },
      {
        h: '3. वेरिफिकेशन से पहले',
        p: 'अगर आपकी रजिस्ट्रेशन हमारे वेरिफिकेशन प्रोसेस के दौरान रिजेक्ट होती है (उदाहरण के लिए, अगर हम आपकी मेडिकल रजिस्ट्रेशन कन्फर्म नहीं कर पाते), तो पे की गई कोई भी फीस पूरी तरह रिफंड कर दी जाएगी, क्योंकि यह ऊपर बताई गई स्टैंडर्ड रिफंड विंडो से बाहर आता है।',
      },
      {
        h: '4. प्रीमियम/फीचर्ड पोज़ीशनिंग',
        p: 'प्रीमियम पोज़ीशनिंग हमारी करंट प्राइसिंग शर्तों के हिसाब से सिलेक्ट किए गए पीरियड के लिए बिल की जाती है, और रिफंड के मामले में स्टैंडर्ड लिस्टिंग फीस जैसे ही ट्रीट की जाती है — ऊपर सेक्शन 1 और 2 देखें।',
      },
      {
        h: '5. सर्विस नॉन-डिलीवरी',
        p: 'अगर हम हमारी तरफ से किसी टेक्निकल इशू की वजह से एक्सटेंडेड पीरियड के लिए लिस्टिंग सर्विस देने में असमर्थ हैं, तो हम या तो आपकी लिस्टिंग पीरियड बिना किसी चार्ज के एक्सटेंड करेंगे, या प्रभावित समय के लिए प्रोरेटेड रिफंड देंगे, आपकी चॉइस के हिसाब से — यह ऊपर बताई गई 3-दिन की विंडो से इंडिपेंडेंट है।',
      },
      {
        h: '6. रिफंड कैसे रिक्वेस्ट करें',
        p: 'हमें WhatsApp पर मैसेज करें या हमारी होमपेज पर दी गई कॉन्टैक्ट डिटेल्स इस्तेमाल करें, अपने रजिस्टर्ड फ़ोन नंबर और रिक्वेस्ट के कारण के साथ। हम 2 बिज़नेस दिनों के अंदर रिस्पॉन्ड करने का लक्ष्य रखते हैं।',
      },
      {
        h: '7. प्रोसेसिंग टाइम',
        p: 'अप्रूव्ड रिफंड्स 7 बिज़नेस दिनों के अंदर ओरिजिनल पेमेंट मेथड में प्रोसेस किए जाते हैं।',
      },
    ],
  },
}

export default function RefundPolicy() {
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
            </div>
          ))}
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}
