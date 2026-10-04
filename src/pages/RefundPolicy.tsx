import { useLanguage } from '../i18n/LanguageContext'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

const content = {
  en: {
    title: 'Refund & Cancellation Policy',
    updated: 'Last updated: 4 October 2026',
    intro: 'This policy explains refunds and cancellations for clinics, hospitals, labs, pharmacies, ambulance services and insurance advisors who pay Sehatsandhi — a listing fee, a lead fee, money added to a wallet, or an optional add-on such as WhatsApp messaging. Sehatsandhi is completely free for patients — they never pay us; section 11 explains who to ask about money paid to a clinic, pharmacy or ambulance.',
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
        p: 'Message us on WhatsApp or email us — the details are on our Contact page — along with your registered phone number and reason for the request. We aim to respond within 2 business days.',
      },
      {
        h: '7. Processing Time',
        p: 'Approved refunds are processed within 7 business days to the original payment method.',
      },
      {
        h: '8. Pharmacies and Ambulance Services',
        p: 'Pharmacies and ambulance services pay a listing fee like clinics, and sections 1 to 7 apply to it in the same way. Sehatsandhi takes no commission on medicine orders or trips, so there is nothing else to refund.',
      },
      {
        h: '9. Insurance Advisors — Lead Fees',
        p: 'Insurance advisors list free. The lead fee is taken from your wallet only when you choose to accept a lead, and the amount is shown before you accept. If a lead is not genuine — for example the number is wrong or the person never asked for insurance — report it from the lead within 7 days of accepting. If we find the report is right, the fee goes back into your wallet, usually within 2 business days; the lead\'s history shows the decision. A lead that was genuine but did not end in a policy is not refunded.',
      },
      {
        h: '10. Money in Your Wallet',
        p: 'Money you add to your Sehatsandhi wallet is credit for lead fees and WhatsApp messages. It is not refunded for a change of mind. Any unused balance is refunded to the original payment method within 7 business days when you close your account, or if we remove your listing for any reason other than a breach of our Terms — ask us through the Contact page.',
      },
      {
        h: '11. Money Patients Pay to a Clinic, Pharmacy or Ambulance',
        p: 'Patients pay clinics, pharmacies and ambulance services directly, never Sehatsandhi. A refund of a consultation fee, of medicines delivered through a medicine order, or of an ambulance fare is decided and paid by that business. If you cannot reach them, or something went wrong, tell us through the Contact page ("A medicine order, ambulance or insurance request") and we will take it up with them.',
      },
      {
        h: '12. Automatic Renewal',
        p: 'If you choose automatic renewal, we tell you before we charge for the next term, and you can switch it off at any time from your dashboard before the renewal date. If you do not choose it, we remind you before your plan ends and charge nothing.',
      },
      {
        h: '13. Bills Issued by Your Clinic',
        p: 'Consultation bills, pharmacy bills and receipts that a clinic issues to its own patients through Sehatsandhi are between the patient and that clinic. A refund of a fee or of medicines is decided and paid by the clinic, which records it in its own books using our software — please ask the clinic directly.',
      },
    ],
  },
  hi: {
    title: 'रिफंड और कैंसिलेशन पॉलिसी',
    updated: 'आखिरी अपडेट: 4 अक्टूबर 2026',
    intro: 'यह पॉलिसी उन क्लिनिक, हॉस्पिटल, लैब, फार्मेसी, एम्बुलेंस सेवाओं और बीमा सलाहकारों के लिए रिफंड और कैंसिलेशन को बताती है जो Sehatsandhi को पेमेंट करते हैं — लिस्टिंग फीस, लीड फीस, वॉलेट में डाला पैसा, या WhatsApp मैसेजिंग जैसा कोई ऑप्शनल ऐड-ऑन। Sehatsandhi मरीज़ों के लिए बिल्कुल फ्री है — वे हमें कभी पेमेंट नहीं करते; क्लिनिक, फार्मेसी या एम्बुलेंस को दिए पैसे के बारे में किससे पूछें, यह सेक्शन 11 में है।',
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
        p: 'हमें WhatsApp पर मैसेज करें या ईमेल करें — डिटेल्स हमारे संपर्क पेज पर हैं — अपने रजिस्टर्ड फ़ोन नंबर और रिक्वेस्ट के कारण के साथ। हम 2 बिज़नेस दिनों के अंदर रिस्पॉन्ड करने का लक्ष्य रखते हैं।',
      },
      {
        h: '7. प्रोसेसिंग टाइम',
        p: 'अप्रूव्ड रिफंड्स 7 बिज़नेस दिनों के अंदर ओरिजिनल पेमेंट मेथड में प्रोसेस किए जाते हैं।',
      },
      {
        h: '8. फार्मेसी और एम्बुलेंस सेवाएँ',
        p: 'फार्मेसी और एम्बुलेंस सेवाएँ क्लिनिक की तरह लिस्टिंग फीस देती हैं, और उस पर सेक्शन 1 से 7 वैसे ही लागू होते हैं। Sehatsandhi दवाई के ऑर्डर या यात्राओं पर कोई कमीशन नहीं लेता, इसलिए और कुछ रिफंड करने को नहीं है।',
      },
      {
        h: '9. बीमा सलाहकार — लीड फीस',
        p: 'बीमा सलाहकार मुफ़्त लिस्ट होते हैं। लीड फीस आपके वॉलेट से सिर्फ तब कटती है जब आप कोई लीड स्वीकार करना चुनते हैं, और रकम स्वीकार करने से पहले दिखती है। अगर लीड असली नहीं है — जैसे नंबर गलत है या व्यक्ति ने कभी बीमा के बारे में पूछा ही नहीं — तो स्वीकार करने के 7 दिन के अंदर उसी लीड से रिपोर्ट करें। जाँच में रिपोर्ट सही निकली तो फीस आपके वॉलेट में वापस आ जाती है, आमतौर पर 2 बिज़नेस दिनों में; लीड की हिस्ट्री में फ़ैसला दिखता है। जो लीड असली थी पर पॉलिसी में नहीं बदली, उसका रिफंड नहीं होता।',
      },
      {
        h: '10. आपके वॉलेट का पैसा',
        p: 'Sehatsandhi वॉलेट में डाला गया पैसा लीड फीस और WhatsApp मैसेज के लिए क्रेडिट है। मन बदलने पर इसका रिफंड नहीं होता। बचा हुआ बैलेंस 7 बिज़नेस दिनों में ओरिजिनल पेमेंट मेथड में लौटाया जाता है, जब आप अपना अकाउंट बंद करते हैं, या हम हमारी शर्तों के उल्लंघन के अलावा किसी और कारण से आपकी लिस्टिंग हटाते हैं — संपर्क पेज से हमसे कहें।',
      },
      {
        h: '11. मरीज़ क्लिनिक, फार्मेसी या एम्बुलेंस को जो पैसा देते हैं',
        p: 'मरीज़ क्लिनिक, फार्मेसी और एम्बुलेंस सेवाओं को सीधे पेमेंट करते हैं, Sehatsandhi को कभी नहीं। कंसल्टेशन फीस, दवाई के ऑर्डर से आई दवाइयों, या एम्बुलेंस किराए का रिफंड वही बिज़नेस तय करता है और देता है। अगर आप उनसे संपर्क नहीं कर पा रहे, या कुछ गलत हुआ, तो संपर्क पेज पर ("दवाई का ऑर्डर, एम्बुलेंस या बीमा का अनुरोध") हमें बताइए — हम उनसे बात करेंगे।',
      },
      {
        h: '12. ऑटोमैटिक रिन्यूअल',
        p: 'अगर आप ऑटोमैटिक रिन्यूअल चुनते हैं, तो अगली अवधि का चार्ज करने से पहले हम आपको बताते हैं, और रिन्यूअल की तारीख से पहले आप इसे कभी भी अपने डैशबोर्ड से बंद कर सकते हैं। अगर आप इसे नहीं चुनते, तो आपका प्लान खत्म होने से पहले हम आपको याद दिलाते हैं और कुछ चार्ज नहीं करते।',
      },
      {
        h: '13. आपके क्लिनिक द्वारा दिए गए बिल',
        p: 'कंसल्टेशन बिल, फार्मेसी बिल और रसीदें जो कोई क्लिनिक Sehatsandhi के ज़रिए अपने मरीज़ों को देता है, वे मरीज़ और उस क्लिनिक के बीच हैं। फीस या दवाइयों का रिफंड क्लिनिक तय करता है और देता है, और उसे हमारे सॉफ्टवेयर से अपने हिसाब में दर्ज करता है — कृपया सीधे क्लिनिक से पूछें।',
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
