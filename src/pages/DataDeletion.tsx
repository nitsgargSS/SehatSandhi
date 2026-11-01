import { useLanguage } from '../i18n/LanguageContext'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// Data deletion instructions — the page Meta asks for from an app that uses
// Facebook Login (App settings → Basic → Data deletion instructions URL).
// What a business that connected its Facebook Page and Instagram for daily
// posts (0295) can do to remove what we hold, and how anyone else asks for
// deletion. Disconnect really does delete at once: social-connect drops both
// keys from Vault and the social_accounts row. Added 1 Nov 2026.

const content = {
  en: {
    title: 'Data deletion',
    updated: 'Last updated: 1 November 2026',
    intro: 'Sehatsandhi uses Facebook Login only for businesses that choose to connect their Facebook Page and Instagram account, so their approved daily health posts can be published there. This page explains what we keep and how to have it deleted.',
    sections: [
      {
        h: '1. What we keep when a business connects Facebook',
        p: "The Page's name and ID, the linked Instagram account's ID and username, and the keys Meta gives us to post to that Page and account. We do not keep the followers, messages, comments or any other content of the Page or account.",
      },
      {
        h: '2. Delete it yourself, straight away',
        p: 'Sign in to your Sehatsandhi dashboard, open Social posts and press Disconnect. The Page and account details and both keys are deleted from our systems immediately, and nothing more is posted.',
      },
      {
        h: '3. Or remove Sehatsandhi in Facebook',
        p: 'In Facebook, go to Settings & privacy → Settings → Business integrations, choose Sehatsandhi Bot and press Remove. Our keys stop working at once. To have the remaining Page and account details deleted too, email us as in section 4.',
      },
      {
        h: '4. Ask us to delete it',
        p: 'Email contact@sehatsandhi.com with the subject "Data deletion", and the name of your business or Facebook Page. We delete the connection details within 30 days and reply to confirm. Posts already published stay on your own Page and Instagram account, where you can delete them yourself.',
      },
      {
        h: '5. Other data',
        p: 'For any other personal data — bookings, patient records, accounts — see section 7 of our Privacy Policy (sehatsandhi.com/privacy) for your rights and how to use them.',
      },
    ],
  },
  hi: {
    title: 'डेटा डिलीट करना',
    updated: 'आखिरी अपडेट: 1 नवंबर 2026',
    intro: 'Sehatsandhi, Facebook Login का इस्तेमाल सिर्फ उन बिज़नेस के लिए करता है जो अपना Facebook पेज और Instagram अकाउंट जोड़ना चुनते हैं, ताकि उनकी मंज़ूर की हुई रोज़ की स्वास्थ्य पोस्ट वहाँ डाली जा सकें। यह पेज बताता है कि हम क्या रखते हैं और उसे कैसे डिलीट करवाएँ।',
    sections: [
      {
        h: '1. बिज़नेस के Facebook जोड़ने पर हम क्या रखते हैं',
        p: 'पेज का नाम और ID, जुड़े Instagram अकाउंट की ID और यूज़रनेम, और वे keys जो Meta हमें उस पेज और अकाउंट पर पोस्ट करने के लिए देता है। हम पेज या अकाउंट के फ़ॉलोअर, मैसेज, कमेंट या कोई और कंटेंट नहीं रखते।',
      },
      {
        h: '2. खुद तुरंत डिलीट करें',
        p: 'अपने Sehatsandhi डैशबोर्ड में साइन इन करें, Social posts खोलें और Disconnect दबाएँ। पेज और अकाउंट की जानकारी और दोनों keys हमारे सिस्टम से तुरंत डिलीट हो जाती हैं, और आगे कुछ पोस्ट नहीं होता।',
      },
      {
        h: '3. या Facebook में Sehatsandhi को हटाएँ',
        p: 'Facebook में Settings & privacy → Settings → Business integrations पर जाएँ, Sehatsandhi Bot चुनें और Remove दबाएँ। हमारी keys तुरंत काम करना बंद कर देती हैं। बाकी पेज और अकाउंट की जानकारी भी डिलीट करवाने के लिए सेक्शन 4 की तरह हमें ईमेल करें।',
      },
      {
        h: '4. हमसे डिलीट करवाएँ',
        p: 'contact@sehatsandhi.com पर "Data deletion" विषय के साथ, अपने बिज़नेस या Facebook पेज के नाम के साथ ईमेल करें। हम 30 दिन के अंदर कनेक्शन की जानकारी डिलीट करते हैं और जवाब देकर पुष्टि करते हैं। पहले से डाली गई पोस्ट आपके अपने पेज और Instagram अकाउंट पर रहती हैं, जिन्हें आप खुद डिलीट कर सकते हैं।',
      },
      {
        h: '5. बाकी डेटा',
        p: 'किसी और व्यक्तिगत डेटा के लिए — बुकिंग, मरीज़ के रिकॉर्ड, अकाउंट — अपने अधिकारों और उनके इस्तेमाल के लिए हमारी प्राइवेसी पॉलिसी (sehatsandhi.com/privacy) का सेक्शन 7 देखें।',
      },
    ],
  },
}

export default function DataDeletion() {
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
