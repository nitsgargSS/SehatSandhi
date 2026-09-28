import { useLanguage } from '../i18n/LanguageContext'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

const content = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: September 2026',
    intro: 'Sehatsandhi ("we," "us," "our") is operated by NG Technologies. This policy explains what information we collect, how we use it, and your rights regarding it. Sehatsandhi is a WhatsApp-first platform connecting patients with verified doctors and healthcare partners in the pincodes we serve.',
    sections: [
      {
        h: '1. Information We Collect',
        p: 'From patients: name, phone number, age, and the details you share while booking an appointment (speciality needed, area/PIN code). From doctors and partners: registration details, qualification, clinic address, phone, email, and the details of payments for listing fees — payments are made through Razorpay, and we never see or store your card number. From a clinic\'s staff: name, phone, email and role, so each person can sign in to their own account. If you rate a visit by replying on WhatsApp, we keep the score and any words you add. If you use the form on our Contact page, we keep your name, phone or email and your message so we can reply. We also use Google Analytics to understand website traffic (anonymized, aggregate data — not tied to individual patients). Separately, we record anonymous usage events on our own systems: which pages were opened, what speciality or area was searched for, which listings were shown, viewed or tapped, and when the WhatsApp or call button was used. Each event carries a temporary per-visit identifier that is discarded when you close the tab, your device type (mobile, tablet or desktop), and the website you arrived from. We remove search text from the page address before storing it, and these events are not linked to your name or phone number. We use them to improve the service and to show partners how their own listing is performing. If your browser sends a "Do Not Track" signal, we record no usage events at all.',
      },
      {
        h: '2. Location',
        p: 'We record the approximate location of each visit so we know which areas our patients come from and where we should list more doctors. This is worked out from your internet connection and is accurate only to the level of a town or city — often not even that, since mobile networks in India frequently place a connection in the wrong district entirely. We store one location per visit and overwrite it as you browse, so we hold where you are now, not a history of everywhere you have been. It is kept against the same temporary per-visit identifier described above, which is discarded when you close the tab, and it is never linked to your name, your phone number or your bookings. If you use a feature that asks permission to use your exact location, your browser will show you its own permission prompt first — we receive precise coordinates only if you press Allow, and you can refuse or later withdraw that permission in your browser settings without losing access to anything else. Location records are deleted automatically after 90 days. If your browser sends a "Do Not Track" signal, we record no location at all.',
      },
      {
        h: '3. How We Use Your Information',
        p: 'To connect patients with appropriate doctors/partners, to verify doctor credentials against official medical registries, to process appointment bookings, to send booking confirmations and reminders, to send you the prescriptions, bills and discharge summaries your clinic asks us to send, to answer your messages, and to improve our service. We never sell your personal information to third parties.',
      },
      {
        h: '4. Health Records Kept by Your Clinic',
        p: "When you visit a clinic or hospital that uses Sehatsandhi's software, that clinic may record your visits, vitals, allergies, diagnoses, prescriptions, operations, admissions, bills and the medicines it dispenses to you on our system. These records belong to the clinic, which decides what is recorded and is responsible for it. We store them securely on the clinic's behalf, show them only to that clinic's staff whose role needs them (a doctor sees the patients they are treating), keep a log of who searched or opened records, and never use them for advertising or share them with anyone else. You can ask the clinic, or us, to see or correct your records. Documents uploaded to a record are kept for the retention period for medical records and then deleted. For a booking alone, Sehatsandhi holds only what is needed to make it: your name, phone number, age, the speciality you are looking for and your area.",
      },
      {
        h: '5. WhatsApp Messaging Data',
        p: "Since booking happens over WhatsApp, please note that WhatsApp's own data handling also applies — Meta's Cloud API retains message content for a maximum of 30 days, and deletes user identifiers within 30 days of the last message status update. This is separate from and in addition to the limited booking information described in Section 4, which we store only for as long as needed to facilitate your appointment.",
      },
      {
        h: '6. Data Sharing',
        p: 'We share your booking details only with the specific doctor or partner you choose to connect with, so they can provide the service you requested. To run the service we use a small number of providers who handle data only on our instructions: WhatsApp messaging (Meta, through AiSensy), SMS, email (Zoho ZeptoMail), payments (Razorpay) and secure hosting (Supabase). We do not sell, rent, or trade personal information with advertisers or unrelated third parties.',
      },
      {
        h: '7. Your Rights',
        p: 'Under India\'s Digital Personal Data Protection Act, 2023, you have the right to access, correct, or request deletion of your personal data. To exercise these rights, contact us using the details below.',
      },
      {
        h: '8. Data Security',
        p: 'We use industry-standard security practices, including encrypted connections and access controls, to protect your information. No system is completely immune to risk, but we take reasonable measures to safeguard your data.',
      },
      {
        h: '9. Children\'s Privacy',
        p: 'Sehatsandhi is intended for use by adults booking appointments for themselves or their family members. If you are booking on behalf of a minor, please ensure you have the authority to do so.',
      },
      {
        h: '10. Changes to This Policy',
        p: 'We may update this policy from time to time. Material changes will be reflected with an updated date at the top of this page.',
      },
      {
        h: '11. Contact Us',
        p: 'For any privacy-related questions or requests, use the form on our Contact page, email contact@sehatsandhi.com, or message us on WhatsApp.',
      },
    ],
  },
  hi: {
    title: 'गोपनीयता नीति',
    updated: 'आखिरी अपडेट: सितंबर 2026',
    intro: 'Sehatsandhi ("हम", "हमारा") NG Technologies द्वारा संचालित है। यह नीति बताती है कि हम कौनसी जानकारी इकट्ठा करते हैं, उसका इस्तेमाल कैसे करते हैं, और इस बारे में आपके अधिकार क्या हैं। Sehatsandhi उन पिनकोड्स में मरीज़ों को वेरिफाइड डॉक्टरों और हेल्थकेयर पार्टनर्स से जोड़ने वाला एक WhatsApp-फर्स्ट प्लेटफॉर्म है जहां हम उपलब्ध हैं।',
    sections: [
      {
        h: '1. हम कौनसी जानकारी इकट्ठा करते हैं',
        p: 'मरीज़ों से: नाम, फ़ोन नंबर, उम्र, और अपॉइंटमेंट बुक करते समय आपके द्वारा शेयर की गई डिटेल्स (चाहिए स्पेशलिटी, एरिया/PIN कोड)। डॉक्टरों और पार्टनर्स से: रजिस्ट्रेशन डिटेल्स, क्वालिफिकेशन, क्लिनिक एड्रेस, फ़ोन, ईमेल, और लिस्टिंग फीस के पेमेंट की डिटेल्स — पेमेंट Razorpay के ज़रिए होता है, और हम आपका कार्ड नंबर कभी नहीं देखते या स्टोर करते। क्लिनिक के स्टाफ से: नाम, फ़ोन, ईमेल और रोल, ताकि हर व्यक्ति अपने अकाउंट में साइन इन कर सके। अगर आप WhatsApp पर जवाब देकर विज़िट की रेटिंग देते हैं, तो हम रेटिंग और आपके लिखे शब्द रखते हैं। अगर आप हमारे संपर्क पेज का फ़ॉर्म भरते हैं, तो जवाब देने के लिए हम आपका नाम, फ़ोन या ईमेल और मैसेज रखते हैं। हम Google Analytics का भी इस्तेमाल करते हैं वेबसाइट ट्रैफिक समझने के लिए (एनोनिमाइज्ड, एग्रीगेट डेटा — किसी इंडिविजुअल मरीज़ से जुड़ा नहीं)। इसके अलावा, हम अपने सिस्टम पर एनोनिमस यूसेज इवेंट्स रिकॉर्ड करते हैं: कौनसे पेज खोले गए, कौनसी स्पेशलिटी या एरिया सर्च किया गया, कौनसी लिस्टिंग्स दिखाई गईं, देखी गईं या टैप की गईं, और WhatsApp या कॉल बटन कब इस्तेमाल हुआ। हर इवेंट के साथ एक टेम्पररी पर-विज़िट आइडेंटिफायर होता है जो टैब बंद करते ही खत्म हो जाता है, आपका डिवाइस टाइप (मोबाइल, टैबलेट या डेस्कटॉप), और वो वेबसाइट जहां से आप आए। हम पेज एड्रेस से सर्च टेक्स्ट हटा देते हैं स्टोर करने से पहले, और ये इवेंट्स आपके नाम या फ़ोन नंबर से जुड़े नहीं होते। हम इन्हें सर्विस बेहतर बनाने और पार्टनर्स को उनकी अपनी लिस्टिंग की परफॉर्मेंस दिखाने के लिए इस्तेमाल करते हैं। अगर आपका ब्राउज़र "Do Not Track" सिग्नल भेजता है, तो हम कोई भी यूसेज इवेंट रिकॉर्ड नहीं करते।',
      },
      {
        h: '2. लोकेशन',
        p: 'हम हर विज़िट की अनुमानित (approximate) लोकेशन रिकॉर्ड करते हैं ताकि हमें पता चले कि हमारे मरीज़ किन इलाकों से आते हैं और हमें कहां और डॉक्टर लिस्ट करने चाहिए। यह आपके इंटरनेट कनेक्शन से निकाली जाती है और सिर्फ शहर या कस्बे के स्तर तक सही होती है — अक्सर उतनी भी नहीं, क्योंकि भारत में मोबाइल नेटवर्क कई बार कनेक्शन को बिल्कुल गलत ज़िले में दिखाते हैं। हम हर विज़िट की सिर्फ एक लोकेशन रखते हैं और ब्राउज़ करते समय उसे ऊपर से बदलते रहते हैं, यानी हमारे पास यह रहता है कि आप अभी कहां हैं, न कि आप कहां-कहां गए इसका इतिहास। यह उसी टेम्पररी पर-विज़िट आइडेंटिफायर के साथ रखी जाती है जिसका ज़िक्र ऊपर है, जो टैब बंद करते ही खत्म हो जाता है, और यह कभी भी आपके नाम, फ़ोन नंबर या आपकी बुकिंग से नहीं जोड़ी जाती। अगर आप कोई ऐसा फीचर इस्तेमाल करते हैं जो आपकी सटीक (exact) लोकेशन की अनुमति मांगता है, तो आपका ब्राउज़र पहले आपको अपना परमिशन प्रॉम्प्ट दिखाएगा — सटीक कोऑर्डिनेट्स हमें सिर्फ तभी मिलते हैं जब आप "Allow" दबाते हैं, और आप मना कर सकते हैं या बाद में ब्राउज़र सेटिंग्स से यह अनुमति वापस ले सकते हैं, इससे बाकी कोई भी सुविधा बंद नहीं होती। लोकेशन रिकॉर्ड्स 90 दिन बाद अपने आप डिलीट हो जाते हैं। अगर आपका ब्राउज़र "Do Not Track" सिग्नल भेजता है, तो हम कोई लोकेशन रिकॉर्ड नहीं करते।',
      },
      {
        h: '3. हम आपकी जानकारी का इस्तेमाल कैसे करते हैं',
        p: 'मरीज़ों को सही डॉक्टर/पार्टनर से जोड़ने के लिए, डॉक्टर की क्रेडेंशियल्स ऑफिशियल मेडिकल रजिस्ट्री के खिलाफ वेरिफाई करने के लिए, अपॉइंटमेंट बुकिंग प्रोसेस करने के लिए, बुकिंग कन्फर्मेशन और रिमाइंडर भेजने के लिए, आपके क्लिनिक के कहने पर आपको प्रिस्क्रिप्शन, बिल और डिस्चार्ज समरी भेजने के लिए, आपके मैसेज का जवाब देने के लिए, और हमारी सर्विस बेहतर बनाने के लिए। हम कभी भी आपकी पर्सनल जानकारी थर्ड पार्टीज़ को नहीं बेचते।',
      },
      {
        h: '4. आपके क्लिनिक द्वारा रखे गए हेल्थ रिकॉर्ड',
        p: 'जब आप किसी ऐसे क्लिनिक या हॉस्पिटल में जाते हैं जो Sehatsandhi का सॉफ्टवेयर इस्तेमाल करता है, तो वह क्लिनिक हमारे सिस्टम पर आपकी विज़िट, वाइटल्स, एलर्जी, डायग्नोसिस, प्रिस्क्रिप्शन, ऑपरेशन, भर्ती, बिल और आपको दी गई दवाइयां रिकॉर्ड कर सकता है। ये रिकॉर्ड क्लिनिक के हैं — क्या रिकॉर्ड होगा, यह क्लिनिक तय करता है और उसकी ज़िम्मेदारी क्लिनिक की है। हम ये रिकॉर्ड क्लिनिक की ओर से सुरक्षित रखते हैं, सिर्फ उस क्लिनिक के उन्हीं स्टाफ को दिखाते हैं जिनके काम के लिए ज़रूरी हो (डॉक्टर सिर्फ अपने मरीज़ देखते हैं), किसने रिकॉर्ड सर्च किए या खोले इसका लॉग रखते हैं, और इन्हें कभी विज्ञापन के लिए इस्तेमाल नहीं करते या किसी और से शेयर नहीं करते। आप अपने रिकॉर्ड देखने या ठीक कराने के लिए क्लिनिक से या हमसे कह सकते हैं। रिकॉर्ड में अपलोड किए गए डॉक्यूमेंट मेडिकल रिकॉर्ड की तय अवधि तक रखे जाते हैं और फिर डिलीट कर दिए जाते हैं। सिर्फ बुकिंग के लिए Sehatsandhi उतनी ही जानकारी रखता है जितनी ज़रूरी है: आपका नाम, फ़ोन नंबर, उम्र, जो स्पेशलिटी आप ढूंढ रहे हैं और आपका एरिया।',
      },
      {
        h: '5. WhatsApp मैसेजिंग डेटा',
        p: 'चूंकि बुकिंग WhatsApp पर होती है, कृपया ध्यान दें कि WhatsApp की अपनी डेटा हैंडलिंग भी लागू होती है — Meta का Cloud API मैसेज कंटेंट को ज़्यादा से ज़्यादा 30 दिन तक रखता है, और लास्ट मैसेज स्टेटस अपडेट के 30 दिन के अंदर यूज़र आइडेंटिफायर्स डिलीट कर देता है। यह सेक्शन 4 में बताई गई लिमिटेड बुकिंग जानकारी से अलग और अतिरिक्त है, जिसे हम सिर्फ आपकी अपॉइंटमेंट फैसिलिटेट करने के लिए ज़रूरी समय तक स्टोर करते हैं।',
      },
      {
        h: '6. डेटा शेयरिंग',
        p: 'हम आपकी बुकिंग डिटेल्स सिर्फ उसी डॉक्टर या पार्टनर के साथ शेयर करते हैं जिसे आप कनेक्ट करना चुनते हैं, ताकि वो आपकी रिक्वेस्टेड सर्विस दे सकें। सर्विस चलाने के लिए हम कुछ प्रोवाइडर्स का इस्तेमाल करते हैं जो सिर्फ हमारे निर्देश पर डेटा संभालते हैं: WhatsApp मैसेजिंग (Meta, AiSensy के ज़रिए), SMS, ईमेल (Zoho ZeptoMail), पेमेंट (Razorpay) और सुरक्षित होस्टिंग (Supabase)। हम पर्सनल जानकारी एडवरटाइज़र्स या अनरिलेटेड थर्ड पार्टीज़ के साथ नहीं बेचते, रेंट नहीं करते, या ट्रेड नहीं करते।',
      },
      {
        h: '7. आपके अधिकार',
        p: 'भारत के डिजिटल पर्सनल डेटा प्रोटेक्शन एक्ट, 2023 के तहत, आपको अपने पर्सनल डेटा को एक्सेस करने, सही करने, या डिलीट करने की रिक्वेस्ट करने का अधिकार है। इन अधिकारों का इस्तेमाल करने के लिए, नीचे दी गई डिटेल्स से हमसे कॉन्टैक्ट करें।',
      },
      {
        h: '8. डेटा सिक्योरिटी',
        p: 'हम इंडस्ट्री-स्टैंडर्ड सिक्योरिटी प्रैक्टिसेज़ इस्तेमाल करते हैं, जिसमें एन्क्रिप्टेड कनेक्शन और एक्सेस कंट्रोल शामिल हैं, आपकी जानकारी प्रोटेक्ट करने के लिए। कोई भी सिस्टम पूरी तरह रिस्क-फ्री नहीं होता, लेकिन हम आपके डेटा को सेफगार्ड करने के लिए रीज़नेबल कदम उठाते हैं।',
      },
      {
        h: '9. बच्चों की गोपनीयता',
        p: 'Sehatsandhi एडल्ट्स के इस्तेमाल के लिए है जो खुद के लिए या अपने परिवार के सदस्यों के लिए अपॉइंटमेंट बुक करते हैं। अगर आप किसी माइनर के लिए बुक कर रहे हैं, तो कृपया कन्फर्म करें कि आपके पास ऐसा करने का अधिकार है।',
      },
      {
        h: '10. इस नीति में बदलाव',
        p: 'हम समय-समय पर इस नीति को अपडेट कर सकते हैं। महत्वपूर्ण बदलाव इस पेज के ऊपर अपडेटेड तारीख के साथ दिखाए जाएंगे।',
      },
      {
        h: '11. हमसे संपर्क करें',
        p: 'किसी भी प्राइवेसी-रिलेटेड सवाल या रिक्वेस्ट के लिए, हमारे संपर्क पेज का फ़ॉर्म भरें, contact@sehatsandhi.com पर ईमेल करें, या WhatsApp पर मैसेज करें।',
      },
    ],
  },
}

export default function PrivacyPolicy() {
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
