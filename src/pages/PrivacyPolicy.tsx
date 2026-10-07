import { useLanguage } from '../i18n/LanguageContext'
import SiteHeader from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'
import { OPEN_ANALYTICS_SETTINGS } from '../components/AnalyticsConsent'

// The Privacy Policy — the notice required by the Digital Personal Data
// Protection Act, 2023 and the DPDP Rules, 2025, read with the IT Act, 2000 and
// the SPDI Rules, 2011 (health data is sensitive personal data), the IT
// (Intermediary Guidelines) Rules, 2021 (grievance timelines) and CERT-In's
// 2022 directions (incident reporting). Rewritten 29 Sep 2026.
//
// Every period and provider below is checked against the system, not
// aspirational: retention comes from the pg_cron purge jobs (0059, 0171, 0172),
// document retention (0058: 10 years by default, set by the clinic), lab report
// files (0169: the lab's plan, 1 year by default), and the providers are the
// ones the code calls. Log retention and STOP/START: 0173. Medicine orders,
// ambulance requests and insurance leads (what a partner sees, and for how
// long): 0189, 0191, 0192 — updated 4 Oct 2026, with extra and foreign phone
// numbers and the correction log (0193), the tips opt-in (0187) and app push
// notifications (0185). If any of that changes, this page changes with it.
// Still for a lawyer to review before relying on it.

type Section = { h: string; p?: string; list?: string[]; after?: string }

const content: Record<'en' | 'hi', { title: string; updated: string; intro: string; sections: Section[]; settings: string }> = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: 7 October 2026',
    intro: `Sehatsandhi ("we", "us") is operated by NG Technologies. This notice explains, in plain words, what personal data we process, why, for how long, who else handles it, and how you can use your rights or complain. It is given under the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025, and the Information Technology Act, 2000 and the rules under it where they apply. We treat health information as sensitive personal data.`,
    settings: 'Change your Google Analytics choice',
    sections: [
      {
        h: '1. Who is responsible for your data',
        list: [
          `When you book through Sehatsandhi, list a business with us, contact us or use our website, NG Technologies decides why and how your data is used — we are the "Data Fiduciary".`,
          `When a clinic, hospital, lab or pharmacy uses our software to keep its patients' records, that business is the Data Fiduciary for those records and we are its "Data Processor": we store and process them only on its instructions and for its purposes. Requests about those records should go to that business; if you send them to us, we pass them on and help it respond.`,
        ],
      },
      {
        h: '2. What we collect and why',
        p: 'We collect only what each purpose needs:',
        list: [
          `Booking a doctor or service (on WhatsApp or the website): your name, phone number, age, the family member you are booking for and their relation to you, the speciality or service you need, and your area or pincode — to find a suitable doctor or partner, make the booking, and send you the confirmation and reminders.`,
          `Records a clinic keeps with our software (as its processor): visits, vital signs, allergies, diagnoses, examinations, prescriptions, lab tests and results, uploaded reports and documents, operations, admissions and discharge, bills, payments and medicines dispensed. If your clinic turns on voice notes, the audio of the consultation is converted to text so the doctor can check it; see section 4.`,
          `Documents sent to you: when your clinic or lab asks, we send your prescription, bill, discharge summary or lab report as a secure link on WhatsApp, SMS or email.`,
          `Ratings: if you reply to a rating request after a visit, we keep the score and any words you add.`,
          `Ordering medicines (WhatsApp): your name, delivery address and PIN code, the medicines you ask for and, if you send it, a photo of your prescription. Every pharmacy that delivers to your PIN code sees only the area and the medicines. The first pharmacy to accept sees your prescription photo and first name so it can price the order; your full name, phone number and address go to that one pharmacy only after you approve its price on your order link. It can see them for 7 days after delivery. We also keep what the pharmacy charged and, if you tell us, what you paid and your rating.`,
          `Asking for an ambulance (WhatsApp): your name, phone number, pickup address and PIN code, and what is needed. Because it may be an emergency, every ambulance service covering your PIN code is alerted, and the one that accepts sees your phone number and pickup address straight away, for 7 days after the trip. We always give you 108 and nearby numbers first; you never have to wait for us.`,
          `Asking about health insurance (WhatsApp): your name, phone number, PIN code, the cover you want, who it is for (with ages) and when to call. Licensed advisors serving your PIN code see what you want but not who you are; only the one advisor who accepts gets your name and number, for 90 days. In those 90 days the advisor may also send you WhatsApp messages about cover, if they use Sehatsandhi's WhatsApp service — send STOP to stop them. Your medical records are never shared with an advisor. You can tell us on your request link if they did not call, and say afterwards whether you bought a policy.`,
          `The Sehatsandhi app, for patients: you sign in with a one-time code sent to your WhatsApp; we keep your number, when you signed in, and your phone's notification token so we can remind you to rate a visit, an order, a trip or an advisor (turn notifications off in your phone settings to stop them). If you tap "Use my location", your phone's position is used once to find your PIN code — sent to BigDataCloud only for that lookup and not stored — except for an ambulance request, where it is sent to the ambulance service that accepts, as a map pin, for 7 days after the trip. A prescription photo you add is stored privately under your account and shared with the pharmacy that takes your order through a link that stops working after 14 days. Whether a request came from the app, WhatsApp or the website is recorded, to understand how people use Sehatsandhi.`,
          `What you type to our WhatsApp assistant or in the app's search box: the message, to work out what you need — a kind of doctor, a test, medicines, an ambulance, insurance or a health camp, and your area and day — and take you to the right place. This is done by our own rules, with no outside AI service, and it never gives a diagnosis or suggests a medicine. A message that looks like an emergency is answered with 108 and 112 straight away. We keep the message with what it was understood as, so our team can check and improve the understanding; your phone number is not kept with it — only a one-way scrambled code of it (WhatsApp) or your app sign-in (app).`,
          `Your records and messages in the app: signed in with your number, you see what clinics on Sehatsandhi have recorded for the people on that number — visits, prescriptions, lab reports, bills and discharge summaries — because they are yours to see. Anyone who signs in with that number sees them, so keep your phone to yourself. You can message a clinic you have visited; the clinic's staff read and answer it, the message and who answered are kept with the clinic's records, and a photo you send is shared through a link that stops working after 14 days.`,
          `Health tips from Sehatsandhi: only if you tap "Yes, send me health tips" on our WhatsApp. We keep that consent and the message as proof. Send STOP at any time to stop.`,
          `Your phone numbers and corrections: a clinic may keep more than one number for you, including a number outside India, and may correct your name, age or gender if it was typed wrong; every correction is recorded with who made it.`,
          `Clinic and marketing messages: a clinic may send you health camp, reminder or offer messages only if you agreed — for example by scanning its QR code or telling the clinic — and only that clinic. To stop them from every clinic at once, send STOP on our WhatsApp; send START to turn them back on. Appointment, prescription, bill and report messages continue either way (section 7).`,
          `Doctors, businesses and their staff: name, phone, email, qualification and registration number (checked against the National Medical Commission's Indian Medical Register), a pharmacy's drug licence and an insurance advisor's IRDAI licence or POSP code, clinic address, GST details if you give them, sign-in details for each staff member, who did each step of an order, trip or lead, wallet top-ups and lead fees, and payments of fees — made through Razorpay; we never see or store your card, UPI PIN or bank password. If staff use the Sehatsandhi app, we keep their phone's notification token so alerts reach them; it is removed when they sign out.`,
          `Contact form: your name, phone or email and your message, so we can reply.`,
          `Using our website: anonymous usage events on our own systems — pages opened, what speciality or area was searched, which listings were shown, viewed or tapped, and when the WhatsApp or call button was used — with a temporary per-tab identifier that is discarded when you close the tab, your device type and the website you came from. Search text is removed from page addresses. These are never linked to your name or phone number, and are not recorded at all if your browser sends "Do Not Track".`,
          `Approximate location of a visit: worked out from your internet address by a lookup service (ipwho.is), accurate at best to a town and often wrong on mobile networks. We keep one location per visit, not a history, never linked to your name, phone or bookings. Not recorded under "Do Not Track".`,
          `Checking an area on our page for businesses: what you typed or the district found and how you searched, with the same per-tab identifier, so we can see which areas businesses are interested in. If you press "Use my location" and allow it in your browser, your position is rounded to about 1 km and sent once to BigDataCloud only to find your district; we do not store those coordinates. Once allowed, the page may use it again on later visits until you withdraw it in your browser settings.`,
          `Google Analytics: only if you choose "Allow" on the banner shown on your first visit. It sets Google cookies and tells us how many people visit and which pages help. You can change your choice any time from "Analytics settings" at the bottom of every page.`,
        ],
        after: `We do not sell your personal data, use your health information for advertising, or show advertising based on it.`,
      },
      {
        h: '3. On what basis',
        list: [
          `Consent — for marketing messages from a clinic, Google Analytics, precise location and voice notes. Consent is free, specific and can be withdrawn as easily as it was given; withdrawing does not affect what was done before, but the feature may stop.`,
          `Legitimate uses allowed by section 7 of the DPDP Act — when you give us your data yourself for a purpose (for example, to book an appointment or to register your clinic), to respond to a medical emergency, and to comply with the law or a court order.`,
          `As a processor for clinics — on the clinic's own lawful basis and instructions.`,
        ],
      },
      {
        h: '4. Who else handles your data',
        p: `We share your booking with the doctor or partner you choose, so they can serve you — and a medicine order, ambulance request or insurance request with the pharmacy, ambulance service or advisor as described in section 2. Once a partner has your details, it is responsible for using them only to serve you. To run the service we use these providers, each under contract and only for the purpose shown:`,
        list: [
          `Supabase — secure hosting of our database and files (servers in Singapore).`,
          `Vercel — hosting of this website.`,
          `AiSensy and Meta (WhatsApp Business) — sending and receiving WhatsApp messages. Meta's own terms apply to WhatsApp; its Cloud API keeps message content for up to 30 days.`,
          `MSG91 — SMS and email; Zoho ZeptoMail — email.`,
          `Razorpay — payments.`,
          `Expo (expo.dev) — delivering notifications to the Sehatsandhi app on staff phones; a notification carries only a short line such as an order number or a patient's first name.`,
          `Sarvam AI — converting a consultation voice note to text, only if your clinic uses voice notes. The audio is deleted as soon as it is converted, and in any case within 7 days.`,
          `Anthropic — reading the doctor-checked text of a voice note to draft medicine suggestions for the doctor to accept or change, only if the clinic uses this. No audio is sent.`,
          `Google — Analytics (only with your consent) and Places (to look up a clinic's address when a business registers).`,
          `ipwho.is, BigDataCloud and India Post's pincode service (api.postalpincode.in) — turning an internet address, a rounded position or a pincode into a place name.`,
          `National Medical Commission — checking a doctor's registration.`,
        ],
        after: `We may also disclose data when the law requires it — to a court, regulator or law-enforcement agency with lawful authority — and we will tell you where the law allows.`,
      },
      {
        h: '5. Processing outside India',
        p: `Our database is hosted in Singapore, and some providers above (Meta, Google, Anthropic, Vercel) may process data in other countries. Section 16 of the DPDP Act allows this except to countries the Government of India restricts; we will stop or move any processing if a restriction is notified. Wherever it is processed, your data stays under the protections in this policy and our contracts.`,
      },
      {
        h: '6. How long we keep it',
        p: `We keep data only as long as its purpose needs, or longer only where the law requires. These deletions are automatic:`,
        list: [
          `Documents in a clinic's records (reports, scans, consent forms and others): kept for the period the clinic sets, 10 years from the document's date unless it sets another, then the file is deleted. Clinics must also keep records for the periods medical regulations require. A clinic can place a document on legal hold, for example for a court case, and then it is kept until the hold ends.`,
          `Lab report files uploaded by a lab: for the lab's plan, 1 year unless the lab's plan says otherwise; then the file and its link stop working.`,
          `Consultation voice notes: deleted once converted to text, and within 7 days at most.`,
          `WhatsApp message content in our systems: deleted 7 days after the conversation closes.`,
          `Approximate visit location: 90 days after the visit's last activity.`,
          `Anonymous website usage events: about 13 months.`,
          `Area searches on the page for businesses: 12 months.`,
          `Contact form messages: 24 months.`,
          `Used or expired sign-in codes: deleted daily. Phone verification codes: 30 days after use or expiry.`,
          `Records of messages we sent (number, template and delivery status): 12 months. Queued notifications and emails: 90 days after they were sent or failed.`,
          `WhatsApp conversation records: 12 months after the conversation closed; the record that a number wrote to us: 24 months after its last message.`,
          `Search logs of the WhatsApp assistant (no phone number is kept): 24 months.`,
          `What you typed to our WhatsApp assistant or the app's search box: the words are deleted after 90 days; what they were understood as (for example "eye doctor, Jagadhri, tomorrow") is kept without them for 24 months, to measure and improve the service.`,
          `Medicine orders, ambulance requests and insurance requests: kept with business records (below); a partner stops seeing your contact details 7 days after a delivery or trip, and 90 days after accepting an insurance request.`,
          `Bookings, patient and business accounts, bills and payment records: while the account is in use and afterwards for as long as tax, accounting and medical-record laws require; then deleted or made anonymous. You can ask for earlier erasure where the law allows (section 7).`,
          `Logs of which staff member searched or opened a patient's record: kept with that record, for security and audit, and for at least one year as the DPDP Rules require.`,
        ],
      },
      {
        h: '7. Your rights and how to use them',
        p: `Under the DPDP Act you may:`,
        list: [
          `get a summary of your personal data we process, what we do with it, and who we have shared it with;`,
          `have it corrected, completed or updated;`,
          `have it erased when it is no longer needed, unless the law requires us to keep it;`,
          `withdraw consent you gave, at any time — for promotional messages and rating requests from clinics, simply send STOP on WhatsApp (START turns them back on), or tell the clinic or us;`,
          `have a grievance heard and answered by our Grievance Officer (section 11);`,
          `nominate a person to use these rights for you if you die or cannot act yourself.`,
        ],
        after: `To use a right, choose "My personal data" on our Contact page (sehatsandhi.com/contact?topic=privacy), email contact@sehatsandhi.com with the words "Privacy request", or message us on WhatsApp — with your name and phone number. We may confirm it is you with a one-time code to your phone. A parent or guardian can ask on behalf of a child or a person they are the lawful guardian of. For records kept by a clinic, we pass the request to that clinic and help it respond. We acknowledge every request within 24 hours and resolve it within 15 days. We keep a record of each request and what we did for 3 years after it is closed, as evidence that it was handled. You also have duties under the Act: give correct information, do not impersonate anyone, and do not make false or frivolous complaints.`,
      },
      {
        h: '8. Children and people who need a guardian',
        p: `Our service is for adults. A booking or record for a child (under 18) or for a person with a disability who needs a lawful guardian is made by their parent or guardian, who gives consent on their behalf. We use such data only to provide health services, and we never track the behaviour of children or show them targeted advertising. Clinics are responsible for guardian consent for the records they keep.`,
      },
      {
        h: '9. How we protect it',
        p: `Data travels encrypted (HTTPS) and is encrypted at rest by our hosting provider. Access is limited by role and enforced in the database itself: clinic staff see only their own clinic, and a doctor sees the patients they treat. Every search and opening of a patient record is logged with who did it. Staff passwords expire every 90 days, one-time codes are stored only as hashes, and secrets are kept in a vault. No system is completely secure, but we take reasonable security safeguards as the law requires.`,
      },
      {
        h: '10. If there is a data breach',
        p: `If a personal data breach affects you, we will tell you without delay — what happened, when, the likely impact, what we are doing and what you can do — and we will report it to the Data Protection Board of India as the DPDP Rules require (with a full report within 72 hours) and to CERT-In where its directions require (within 6 hours).`,
      },
      {
        h: '11. Grievance Officer and complaints',
        p: `Grievance Officer, NG Technologies (Sehatsandhi) — email contact@sehatsandhi.com, phone +91 85708 89188, or the form on our Contact page, which also shows our registered address. We acknowledge a grievance within 24 hours and resolve it within 15 days. If you are not satisfied with our answer, you may complain to the Data Protection Board of India.`,
      },
      {
        h: '12. Cookies and similar storage',
        p: `The site stores your language and your analytics choice in your browser, and a temporary per-tab identifier that disappears when you close the tab. Google Analytics cookies are set only if you allow them. Blocking storage in your browser does not stop you booking.`,
      },
      {
        h: '13. Changes to this policy',
        p: `When we change this policy, we update the date at the top. If a change needs your consent — for example, a new purpose — we will ask for it before applying it to you. This policy is governed by the laws of India and is read with our Terms.`,
      },
    ],
  },
  hi: {
    title: 'गोपनीयता नीति',
    updated: 'आखिरी अपडेट: 7 अक्टूबर 2026',
    intro: `Sehatsandhi ("हम") NG Technologies द्वारा संचालित है। यह सूचना आसान शब्दों में बताती है कि हम कौनसा व्यक्तिगत डेटा प्रोसेस करते हैं, क्यों, कितने समय तक, और कौन-कौन उसे संभालता है, और आप अपने अधिकारों का इस्तेमाल या शिकायत कैसे कर सकते हैं। यह डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 (DPDP Act) और DPDP नियम, 2025, और जहां लागू हो वहां सूचना प्रौद्योगिकी अधिनियम, 2000 और उसके नियमों के तहत दी गई है। स्वास्थ्य से जुड़ी जानकारी को हम संवेदनशील व्यक्तिगत डेटा मानते हैं।`,
    settings: 'Google Analytics के लिए अपनी पसंद बदलें',
    sections: [
      {
        h: '1. आपके डेटा के लिए ज़िम्मेदार कौन है',
        list: [
          `जब आप Sehatsandhi से बुकिंग करते हैं, हमारे साथ अपना बिज़नेस लिस्ट करते हैं, हमसे संपर्क करते हैं या हमारी वेबसाइट इस्तेमाल करते हैं, तब NG Technologies तय करती है कि आपका डेटा क्यों और कैसे इस्तेमाल होगा — यानी हम "डेटा फ़िड्यूशियरी" हैं।`,
          `जब कोई क्लिनिक, हॉस्पिटल, लैब या फ़ार्मेसी अपने मरीज़ों के रिकॉर्ड रखने के लिए हमारा सॉफ्टवेयर इस्तेमाल करती है, तो उन रिकॉर्ड्स की डेटा फ़िड्यूशियरी वह बिज़नेस है और हम उसके "डेटा प्रोसेसर" हैं: हम उन्हें सिर्फ उसके निर्देश पर और उसके काम के लिए रखते और प्रोसेस करते हैं। उन रिकॉर्ड्स से जुड़े अनुरोध उसी बिज़नेस को भेजें; अगर आप हमें भेजते हैं, तो हम उन्हें आगे भेजकर जवाब देने में उसकी मदद करते हैं।`,
        ],
      },
      {
        h: '2. हम क्या इकट्ठा करते हैं और क्यों',
        p: 'हम हर काम के लिए सिर्फ उतना ही लेते हैं जितना ज़रूरी है:',
        list: [
          `डॉक्टर या सेवा की बुकिंग (WhatsApp या वेबसाइट पर): आपका नाम, फ़ोन नंबर, उम्र, परिवार का जो सदस्य है उसका नाम और आपसे रिश्ता, चाहिए स्पेशलिटी या सेवा, और आपका इलाका या पिनकोड — सही डॉक्टर या पार्टनर ढूंढने, बुकिंग करने और आपको कन्फ़र्मेशन व रिमाइंडर भेजने के लिए।`,
          `क्लिनिक हमारे सॉफ्टवेयर पर जो रिकॉर्ड रखता है (उसके प्रोसेसर के रूप में): विज़िट, वाइटल्स, एलर्जी, डायग्नोसिस, जांच, पर्चे, लैब टेस्ट और रिज़ल्ट, अपलोड की गई रिपोर्ट और दस्तावेज़, ऑपरेशन, भर्ती और डिस्चार्ज, बिल, पेमेंट और दी गई दवाइयां। अगर आपका क्लिनिक वॉइस नोट्स चालू करता है, तो कंसल्टेशन की ऑडियो को टेक्स्ट में बदला जाता है ताकि डॉक्टर उसे जांच सकें; सेक्शन 4 देखें।`,
          `आपको भेजे जाने वाले दस्तावेज़: जब आपका क्लिनिक या लैब कहता है, हम आपका पर्चा, बिल, डिस्चार्ज समरी या लैब रिपोर्ट WhatsApp, SMS या ईमेल पर एक सुरक्षित लिंक के रूप में भेजते हैं।`,
          `रेटिंग: विज़िट के बाद रेटिंग के मैसेज का जवाब देने पर हम स्कोर और आपके लिखे शब्द रखते हैं।`,
          `दवाई मंगाना (WhatsApp): आपका नाम, डिलीवरी का पता और PIN कोड, आप कौनसी दवाइयाँ चाहते हैं और, अगर आप भेजें, पर्ची की फ़ोटो। आपके PIN कोड में डिलीवरी करने वाली हर फ़ार्मेसी को सिर्फ इलाका और दवाइयाँ दिखती हैं। जो फ़ार्मेसी पहले स्वीकार करती है, उसे कीमत बताने के लिए पर्ची की फ़ोटो और आपका पहला नाम दिखता है; आपका पूरा नाम, फ़ोन नंबर और पता सिर्फ उसी फ़ार्मेसी को, और सिर्फ तब मिलता है जब आप अपने ऑर्डर लिंक पर उसकी कीमत को हाँ कहते हैं। डिलीवरी के 7 दिन बाद तक वह इन्हें देख सकती है। फ़ार्मेसी ने कितना लिया, और अगर आप बताएँ तो आपने कितना दिया और आपकी रेटिंग, हम यह भी रखते हैं।`,
          `एम्बुलेंस मंगाना (WhatsApp): आपका नाम, फ़ोन नंबर, जहाँ से लेना है वह पता और PIN कोड, और क्या ज़रूरत है। यह इमरजेंसी हो सकती है, इसलिए आपके PIN कोड की हर एम्बुलेंस सेवा को अलर्ट जाता है, और जो स्वीकार करती है उसे आपका फ़ोन नंबर और पता तुरंत दिखता है — यात्रा के 7 दिन बाद तक। हम हमेशा पहले 108 और पास के नंबर देते हैं; आपको हमारा इंतज़ार कभी नहीं करना पड़ता।`,
          `स्वास्थ्य बीमा के बारे में पूछना (WhatsApp): आपका नाम, फ़ोन नंबर, PIN कोड, कैसा कवर चाहिए, किसके लिए (उम्र सहित) और कब कॉल करें। आपके PIN कोड के लाइसेंस वाले सलाहकारों को दिखता है कि आप क्या चाहते हैं, पर आप कौन हैं यह नहीं; आपका नाम और नंबर सिर्फ उस एक सलाहकार को मिलता है जो स्वीकार करता है — 90 दिन के लिए। इन 90 दिनों में, अगर सलाहकार Sehatsandhi की WhatsApp सेवा इस्तेमाल करता है, तो वह आपको कवर के बारे में WhatsApp मैसेज भी भेज सकता है — बंद करने के लिए STOP भेजें। आपके मेडिकल रिकॉर्ड किसी सलाहकार को कभी नहीं दिए जाते। अगर सलाहकार ने कॉल नहीं किया तो आप अपने लिंक पर बता सकते हैं, और बाद में बता सकते हैं कि पॉलिसी ली या नहीं।`,
          `मरीज़ों के लिए Sehatsandhi ऐप: आप अपने WhatsApp पर आए एक बार के कोड से साइन इन करते हैं; हम आपका नंबर, साइन-इन का समय, और फ़ोन का नोटिफ़िकेशन टोकन रखते हैं ताकि विज़िट, ऑर्डर, यात्रा या सलाहकार को रेटिंग देने की याद दिला सकें (रोकने के लिए फ़ोन की सेटिंग में नोटिफ़िकेशन बंद करें)। "मेरी लोकेशन" दबाने पर फ़ोन की लोकेशन एक बार PIN कोड ढूँढने के लिए BigDataCloud को भेजी जाती है और रखी नहीं जाती — सिवाय एम्बुलेंस के अनुरोध के, जहाँ यह स्वीकार करने वाली एम्बुलेंस सेवा को मैप पिन के रूप में, यात्रा के 7 दिन बाद तक, दिखती है। आपकी जोड़ी हुई पर्ची की फ़ोटो आपके अकाउंट में निजी रूप से रखी जाती है और ऑर्डर लेने वाली फ़ार्मेसी के साथ एक लिंक से शेयर होती है जो 14 दिन बाद काम करना बंद कर देता है। कोई अनुरोध ऐप, WhatsApp या वेबसाइट से आया, यह दर्ज होता है, ताकि हम समझ सकें कि लोग Sehatsandhi कैसे इस्तेमाल करते हैं।`,
          `हमारे WhatsApp असिस्टेंट को या ऐप के सर्च बॉक्स में आप जो लिखते हैं: वह मैसेज, यह समझने के लिए कि आपको क्या चाहिए — किस तरह का डॉक्टर, जांच, दवाई, एम्बुलेंस, बीमा या हेल्थ कैंप, और आपका इलाका व दिन — और आपको सही जगह पहुँचाने के लिए। यह हमारे अपने नियमों से होता है, किसी बाहरी AI सेवा से नहीं, और यह कभी बीमारी नहीं बताता न कोई दवा सुझाता है। जो मैसेज इमरजेंसी लगता है, उसका जवाब तुरंत 108 और 112 के साथ दिया जाता है। हम मैसेज को इस बात के साथ रखते हैं कि उसे क्या समझा गया, ताकि हमारी टीम जांच कर समझ को बेहतर बना सके; आपका फ़ोन नंबर इसके साथ नहीं रखा जाता — सिर्फ उसका एक-तरफ़ा बदला हुआ कोड (WhatsApp) या आपका ऐप साइन-इन (ऐप)।`,
          `ऐप में आपके रिकॉर्ड और मैसेज: अपने नंबर से साइन इन करने पर आप देखते हैं कि Sehatsandhi पर क्लिनिकों ने उस नंबर वाले लोगों के लिए क्या दर्ज किया है — विज़िट, पर्चे, लैब रिपोर्ट, बिल और डिस्चार्ज समरी — क्योंकि ये आपके हैं। उस नंबर से जो भी साइन इन करे, उसे ये दिखते हैं, इसलिए अपना फ़ोन किसी और को न दें। जिस क्लिनिक में आप गए हैं, उसे मैसेज कर सकते हैं; क्लिनिक का स्टाफ़ उसे पढ़कर जवाब देता है, मैसेज और किसने जवाब दिया यह क्लिनिक के रिकॉर्ड के साथ रखा जाता है, और आपकी भेजी फ़ोटो एक लिंक से शेयर होती है जो 14 दिन बाद काम करना बंद कर देता है।`,
          `Sehatsandhi से हेल्थ टिप्स: सिर्फ तब जब आप हमारे WhatsApp पर "हाँ, हेल्थ टिप्स भेजें" दबाएँ। हम वह सहमति और मैसेज सबूत के तौर पर रखते हैं। बंद करने के लिए कभी भी STOP भेजें।`,
          `आपके फ़ोन नंबर और सुधार: क्लिनिक आपके एक से ज़्यादा नंबर रख सकता है, भारत के बाहर का नंबर भी, और गलत लिखा नाम, उम्र या लिंग सुधार सकता है; हर सुधार किसने किया, यह दर्ज होता है।`,
          `क्लिनिक और मार्केटिंग मैसेज: कोई क्लिनिक आपको हेल्थ कैंप, रिमाइंडर या ऑफ़र के मैसेज सिर्फ तभी भेज सकता है जब आपने सहमति दी हो — जैसे उसका QR कोड स्कैन करके या क्लिनिक को बताकर — और सिर्फ वही क्लिनिक। सभी क्लिनिक्स के ये मैसेज एक साथ रोकने के लिए हमारे WhatsApp पर STOP भेजें; फिर से शुरू करने के लिए START भेजें। अपॉइंटमेंट, पर्चे, बिल और रिपोर्ट के मैसेज दोनों हालात में आते रहेंगे (सेक्शन 7)।`,
          `डॉक्टर, बिज़नेस और उनका स्टाफ़: नाम, फ़ोन, ईमेल, क्वालिफ़िकेशन और रजिस्ट्रेशन नंबर (राष्ट्रीय चिकित्सा आयोग के इंडियन मेडिकल रजिस्टर से जांचा जाता है), फ़ार्मेसी का ड्रग लाइसेंस और बीमा सलाहकार का IRDAI लाइसेंस या POSP कोड, क्लिनिक का पता, दिए जाने पर GST डिटेल्स, हर स्टाफ़ सदस्य की लॉगिन डिटेल्स, ऑर्डर, यात्रा या लीड का हर कदम किसने उठाया, वॉलेट टॉप-अप और लीड फ़ीस, और फ़ीस के पेमेंट — जो Razorpay से होते हैं; हम आपका कार्ड, UPI PIN या बैंक पासवर्ड न देखते हैं न रखते हैं। स्टाफ़ Sehatsandhi ऐप इस्तेमाल करे तो अलर्ट पहुँचाने के लिए हम उनके फ़ोन का नोटिफ़िकेशन टोकन रखते हैं; लॉग आउट करने पर वह हट जाता है।`,
          `संपर्क फ़ॉर्म: आपका नाम, फ़ोन या ईमेल और आपका मैसेज, ताकि हम जवाब दे सकें।`,
          `हमारी वेबसाइट का इस्तेमाल: हमारे अपने सिस्टम पर बिना नाम के इस्तेमाल के इवेंट — कौनसे पेज खुले, कौनसी स्पेशलिटी या इलाका खोजा गया, कौनसी लिस्टिंग दिखी, देखी या टैप हुई, और WhatsApp या कॉल बटन कब दबा — एक टेम्पररी पर-टैब आइडेंटिफायर के साथ जो टैब बंद होते ही खत्म हो जाता है, आपके डिवाइस का प्रकार और आप किस वेबसाइट से आए। पेज एड्रेस से खोज का टेक्स्ट हटा दिया जाता है। ये कभी आपके नाम या फ़ोन से नहीं जोड़े जाते, और अगर आपका ब्राउज़र "Do Not Track" भेजता है तो बिल्कुल रिकॉर्ड नहीं होते।`,
          `विज़िट की अनुमानित लोकेशन: आपके इंटरनेट एड्रेस से एक लुकअप सर्विस (ipwho.is) द्वारा निकाली जाती है, ज़्यादा से ज़्यादा कस्बे तक सही और मोबाइल नेटवर्क पर अक्सर गलत। हम हर विज़िट की एक ही लोकेशन रखते हैं, इतिहास नहीं, और यह कभी आपके नाम, फ़ोन या बुकिंग से नहीं जुड़ती। "Do Not Track" पर रिकॉर्ड नहीं होती।`,
          `बिज़नेस वाले पेज पर इलाका देखना: आपने क्या लिखा या कौनसा ज़िला मिला और खोज कैसे की, उसी पर-टैब आइडेंटिफायर के साथ, ताकि हम देख सकें कि बिज़नेस किन इलाकों में दिलचस्पी ले रहे हैं। अगर आप "Use my location" दबाते हैं और ब्राउज़र में अनुमति देते हैं, तो आपकी लोकेशन लगभग 1 किलोमीटर तक गोल करके सिर्फ एक बार BigDataCloud को भेजी जाती है, सिर्फ ज़िला पता करने के लिए; हम ये कोऑर्डिनेट्स सेव नहीं करते। अनुमति के बाद पेज अगली विज़िट पर भी इसका इस्तेमाल कर सकता है, जब तक आप ब्राउज़र सेटिंग्स में इसे वापस नहीं लेते।`,
          `Google Analytics: सिर्फ तभी जब आप पहली विज़िट पर दिखने वाले बैनर पर "अनुमति दें" चुनें। यह Google की कुकीज़ लगाता है और हमें बताता है कि कितने लोग आते हैं और कौनसे पेज काम के हैं। हर पेज के नीचे "एनालिटिक्स सेटिंग" से आप कभी भी अपनी पसंद बदल सकते हैं।`,
        ],
        after: `हम आपका व्यक्तिगत डेटा बेचते नहीं, आपकी स्वास्थ्य जानकारी का इस्तेमाल विज्ञापन के लिए नहीं करते, और उसके आधार पर विज्ञापन नहीं दिखाते।`,
      },
      {
        h: '3. किस आधार पर',
        list: [
          `सहमति — क्लिनिक के मार्केटिंग मैसेज, Google Analytics, सटीक लोकेशन और वॉइस नोट्स के लिए। सहमति आपकी मर्ज़ी से और खास काम के लिए होती है, और उतनी ही आसानी से वापस ली जा सकती है जितनी आसानी से दी गई; वापस लेने से पहले हुआ काम प्रभावित नहीं होता, पर वह सुविधा बंद हो सकती है।`,
          `DPDP Act की धारा 7 में दिए गए वैध उपयोग — जब आप किसी काम के लिए खुद अपना डेटा देते हैं (जैसे अपॉइंटमेंट बुक करने या क्लिनिक रजिस्टर करने के लिए), मेडिकल इमरजेंसी में, और कानून या कोर्ट के आदेश का पालन करने के लिए।`,
          `क्लिनिक के प्रोसेसर के रूप में — क्लिनिक के अपने कानूनी आधार और निर्देश पर।`,
        ],
      },
      {
        h: '4. आपका डेटा और कौन संभालता है',
        p: `आपकी बुकिंग हम उसी डॉक्टर या पार्टनर के साथ शेयर करते हैं जिसे आप चुनते हैं, ताकि वे आपकी सेवा कर सकें — और दवाई का ऑर्डर, एम्बुलेंस या बीमा का अनुरोध उस फ़ार्मेसी, एम्बुलेंस सेवा या सलाहकार के साथ, जैसा सेक्शन 2 में बताया है। आपकी जानकारी मिलने के बाद पार्टनर की ज़िम्मेदारी है कि वह उसे सिर्फ आपकी सेवा के लिए इस्तेमाल करे। सेवा चलाने के लिए हम ये प्रोवाइडर इस्तेमाल करते हैं, हर एक कॉन्ट्रैक्ट के तहत और सिर्फ बताए गए काम के लिए:`,
        list: [
          `Supabase — हमारे डेटाबेस और फ़ाइलों की सुरक्षित होस्टिंग (सर्वर सिंगापुर में)।`,
          `Vercel — इस वेबसाइट की होस्टिंग।`,
          `AiSensy और Meta (WhatsApp Business) — WhatsApp मैसेज भेजना और पाना। WhatsApp पर Meta की अपनी शर्तें लागू होती हैं; उसका Cloud API मैसेज का कंटेंट 30 दिन तक रखता है।`,
          `MSG91 — SMS और ईमेल; Zoho ZeptoMail — ईमेल।`,
          `Razorpay — पेमेंट।`,
          `Expo (expo.dev) — स्टाफ़ के फ़ोन पर Sehatsandhi ऐप में नोटिफ़िकेशन पहुँचाना; नोटिफ़िकेशन में सिर्फ छोटी लाइन होती है, जैसे ऑर्डर नंबर या मरीज़ का पहला नाम।`,
          `Sarvam AI — कंसल्टेशन के वॉइस नोट को टेक्स्ट में बदलना, सिर्फ तभी जब आपका क्लिनिक वॉइस नोट्स इस्तेमाल करे। ऑडियो बदलते ही डिलीट हो जाती है, और हर हाल में 7 दिन के अंदर।`,
          `Anthropic — डॉक्टर द्वारा जांचे गए वॉइस नोट के टेक्स्ट को पढ़कर दवाइयों के सुझाव का ड्राफ़्ट बनाना, जिसे डॉक्टर मानें या बदलें — सिर्फ तभी जब क्लिनिक इसे इस्तेमाल करे। कोई ऑडियो नहीं भेजी जाती।`,
          `Google — Analytics (सिर्फ आपकी सहमति से) और Places (बिज़नेस रजिस्टर होते समय क्लिनिक का पता ढूंढने के लिए)।`,
          `ipwho.is, BigDataCloud और India Post की पिनकोड सर्विस (api.postalpincode.in) — इंटरनेट एड्रेस, गोल की गई लोकेशन या पिनकोड से जगह का नाम पता करना।`,
          `राष्ट्रीय चिकित्सा आयोग — डॉक्टर का रजिस्ट्रेशन जांचना।`,
        ],
        after: `जब कानून ज़रूरी करे — किसी कोर्ट, रेगुलेटर या कानूनी अधिकार वाली एजेंसी को — तब भी हम डेटा दे सकते हैं, और जहां कानून इजाज़त दे वहां आपको बताएंगे।`,
      },
      {
        h: '5. भारत के बाहर प्रोसेसिंग',
        p: `हमारा डेटाबेस सिंगापुर में होस्ट है, और ऊपर दिए कुछ प्रोवाइडर (Meta, Google, Anthropic, Vercel) दूसरे देशों में डेटा प्रोसेस कर सकते हैं। DPDP Act की धारा 16 इसकी इजाज़त देती है, सिवाय उन देशों के जिन पर भारत सरकार रोक लगाए; रोक की सूचना आने पर हम वह प्रोसेसिंग बंद करेंगे या कहीं और ले जाएंगे। डेटा जहां भी प्रोसेस हो, उस पर इस नीति और हमारे कॉन्ट्रैक्ट्स की सुरक्षा लागू रहती है।`,
      },
      {
        h: '6. हम इसे कितने समय तक रखते हैं',
        p: `हम डेटा सिर्फ उतने समय तक रखते हैं जितना उसके काम के लिए ज़रूरी है, या उससे ज़्यादा सिर्फ तब जब कानून ज़रूरी करे। ये डिलीशन अपने आप होते हैं:`,
        list: [
          `क्लिनिक के रिकॉर्ड के दस्तावेज़ (रिपोर्ट, स्कैन, सहमति फ़ॉर्म आदि): क्लिनिक जितना समय तय करे उतना, नहीं तो दस्तावेज़ की तारीख से 10 साल, फिर फ़ाइल डिलीट हो जाती है। मेडिकल नियमों में दी गई अवधि तक रिकॉर्ड रखना क्लिनिक की ज़िम्मेदारी भी है। क्लिनिक किसी दस्तावेज़ को लीगल होल्ड पर रख सकता है, जैसे कोर्ट केस के लिए, तब वह होल्ड खत्म होने तक रहता है।`,
          `लैब द्वारा अपलोड की गई रिपोर्ट फ़ाइल: लैब के प्लान के अनुसार, नहीं तो 1 साल; फिर फ़ाइल और उसका लिंक काम करना बंद कर देते हैं।`,
          `कंसल्टेशन के वॉइस नोट्स: टेक्स्ट में बदलते ही डिलीट, और ज़्यादा से ज़्यादा 7 दिन में।`,
          `हमारे सिस्टम में WhatsApp मैसेज का कंटेंट: बातचीत बंद होने के 7 दिन बाद डिलीट।`,
          `विज़िट की अनुमानित लोकेशन: विज़िट की आखिरी गतिविधि के 90 दिन बाद।`,
          `वेबसाइट के बिना नाम वाले इवेंट: लगभग 13 महीने।`,
          `बिज़नेस वाले पेज पर इलाके की खोज: 12 महीने।`,
          `संपर्क फ़ॉर्म के मैसेज: 24 महीने।`,
          `इस्तेमाल हो चुके या एक्सपायर लॉगिन कोड: रोज़ डिलीट। फ़ोन वेरिफ़िकेशन कोड: इस्तेमाल या एक्सपायर होने के 30 दिन बाद।`,
          `हमारे भेजे मैसेज का रिकॉर्ड (नंबर, टेम्पलेट और डिलीवरी स्टेटस): 12 महीने। कतार में रखे नोटिफ़िकेशन और ईमेल: भेजे जाने या फ़ेल होने के 90 दिन बाद।`,
          `WhatsApp बातचीत के रिकॉर्ड: बातचीत बंद होने के 12 महीने बाद; किसी नंबर ने हमें मैसेज किया, इसका रिकॉर्ड: उसके आखिरी मैसेज के 24 महीने बाद।`,
          `WhatsApp असिस्टेंट के सर्च लॉग (कोई फ़ोन नंबर नहीं रखा जाता): 24 महीने।`,
          `हमारे WhatsApp असिस्टेंट को या ऐप के सर्च बॉक्स में लिखे शब्द: 90 दिन बाद मिटा दिए जाते हैं; उन्हें क्या समझा गया (जैसे "आँखों के डॉक्टर, जगाधरी, कल") वह शब्दों के बिना 24 महीने रखा जाता है, सेवा को मापने और बेहतर बनाने के लिए।`,
          `दवाई के ऑर्डर, एम्बुलेंस और बीमा के अनुरोध: बिज़नेस रिकॉर्ड के साथ रखे जाते हैं (नीचे); डिलीवरी या यात्रा के 7 दिन बाद, और बीमा अनुरोध स्वीकार करने के 90 दिन बाद पार्टनर को आपकी संपर्क जानकारी दिखना बंद हो जाती है।`,
          `बुकिंग, मरीज़ और बिज़नेस अकाउंट, बिल और पेमेंट रिकॉर्ड: जब तक अकाउंट इस्तेमाल में है, और उसके बाद उतने समय तक जितना टैक्स, अकाउंटिंग और मेडिकल रिकॉर्ड के कानून ज़रूरी करें; फिर डिलीट या बिना पहचान वाले कर दिए जाते हैं। जहां कानून इजाज़त दे, आप पहले डिलीट करने को कह सकते हैं (सेक्शन 7)।`,
          `किस स्टाफ़ ने मरीज़ का रिकॉर्ड खोजा या खोला, इसका लॉग: सुरक्षा और ऑडिट के लिए उसी रिकॉर्ड के साथ रखा जाता है, और DPDP नियमों के अनुसार कम से कम एक साल।`,
        ],
      },
      {
        h: '7. आपके अधिकार और उनका इस्तेमाल कैसे करें',
        p: `DPDP Act के तहत आप:`,
        list: [
          `हमारे पास आपके व्यक्तिगत डेटा का सारांश, हम उसके साथ क्या करते हैं, और किसके साथ शेयर किया है — यह जान सकते हैं;`,
          `उसे सही, पूरा या अपडेट करवा सकते हैं;`,
          `ज़रूरत खत्म होने पर उसे डिलीट करवा सकते हैं, जब तक कानून उसे रखना ज़रूरी न करे;`,
          `दी हुई सहमति कभी भी वापस ले सकते हैं — क्लिनिक्स के प्रचार वाले मैसेज और रेटिंग के अनुरोध के लिए बस WhatsApp पर STOP भेजें (START से फिर शुरू), या क्लिनिक को या हमें बताएं;`,
          `हमारे शिकायत अधिकारी से अपनी शिकायत सुनवा और उसका जवाब पा सकते हैं (सेक्शन 11);`,
          `किसी व्यक्ति को नॉमिनेट कर सकते हैं जो आपकी मृत्यु या असमर्थता पर आपके लिए ये अधिकार इस्तेमाल करे।`,
        ],
        after: `किसी अधिकार के लिए, हमारे संपर्क पेज (sehatsandhi.com/contact?topic=privacy) पर "मेरा व्यक्तिगत डेटा" चुनें, contact@sehatsandhi.com पर "Privacy request" लिखकर ईमेल करें, या WhatsApp पर मैसेज करें — अपने नाम और फ़ोन नंबर के साथ। हम आपके फ़ोन पर एक वन-टाइम कोड भेजकर पुष्टि कर सकते हैं कि यह आप ही हैं। माता-पिता या अभिभावक किसी बच्चे या जिनके वे कानूनी अभिभावक हैं, उनकी ओर से अनुरोध कर सकते हैं। क्लिनिक के रखे रिकॉर्ड के लिए हम अनुरोध उस क्लिनिक को भेजते हैं और जवाब देने में उसकी मदद करते हैं। हम हर अनुरोध की पावती 24 घंटे में देते हैं और 15 दिन में निपटाते हैं। हर अनुरोध और उस पर की गई कार्रवाई का रिकॉर्ड, सबूत के तौर पर, बंद होने के 3 साल बाद तक रखते हैं। कानून के तहत आपके कर्तव्य भी हैं: सही जानकारी दें, किसी और का रूप न धरें, और झूठी या बेवजह शिकायत न करें।`,
      },
      {
        h: '8. बच्चे और जिन्हें अभिभावक की ज़रूरत है',
        p: `हमारी सेवा वयस्कों के लिए है। किसी बच्चे (18 साल से कम) या ऐसे दिव्यांग व्यक्ति की बुकिंग या रिकॉर्ड, जिन्हें कानूनी अभिभावक की ज़रूरत है, उनके माता-पिता या अभिभावक बनाते हैं, जो उनकी ओर से सहमति देते हैं। ऐसा डेटा हम सिर्फ स्वास्थ्य सेवा देने के लिए इस्तेमाल करते हैं, और बच्चों के व्यवहार को कभी ट्रैक नहीं करते न उन्हें टारगेटेड विज्ञापन दिखाते हैं। क्लिनिक अपने रखे रिकॉर्ड के लिए अभिभावक की सहमति के ज़िम्मेदार हैं।`,
      },
      {
        h: '9. हम इसे कैसे सुरक्षित रखते हैं',
        p: `डेटा एन्क्रिप्टेड (HTTPS) होकर आता-जाता है और हमारे होस्टिंग प्रोवाइडर द्वारा स्टोरेज में भी एन्क्रिप्टेड रहता है। एक्सेस रोल के हिसाब से सीमित है और डेटाबेस में ही लागू होता है: क्लिनिक स्टाफ़ सिर्फ अपना क्लिनिक देखता है, और डॉक्टर उन्हीं मरीज़ों को देखते हैं जिनका वे इलाज करते हैं। मरीज़ के रिकॉर्ड की हर खोज और हर बार खोलना, किसने किया के साथ लॉग होता है। स्टाफ़ के पासवर्ड हर 90 दिन में एक्सपायर होते हैं, वन-टाइम कोड सिर्फ हैश के रूप में रखे जाते हैं, और सीक्रेट्स एक वॉल्ट में रखे जाते हैं। कोई भी सिस्टम पूरी तरह सुरक्षित नहीं होता, पर हम कानून के अनुसार उचित सुरक्षा उपाय करते हैं।`,
      },
      {
        h: '10. अगर डेटा ब्रीच हो',
        p: `अगर किसी पर्सनल डेटा ब्रीच का असर आप पर पड़ता है, तो हम बिना देर किए आपको बताएंगे — क्या हुआ, कब, संभावित असर, हम क्या कर रहे हैं और आप क्या कर सकते हैं — और DPDP नियमों के अनुसार भारत के डेटा संरक्षण बोर्ड को (पूरी रिपोर्ट 72 घंटे में) और जहां CERT-In के निर्देश ज़रूरी करें वहां CERT-In को (6 घंटे में) रिपोर्ट करेंगे।`,
      },
      {
        h: '11. शिकायत अधिकारी और शिकायतें',
        p: `शिकायत अधिकारी (Grievance Officer), NG Technologies (Sehatsandhi) — ईमेल contact@sehatsandhi.com, फ़ोन +91 85708 89188, या हमारे संपर्क पेज का फ़ॉर्म, जहां हमारा रजिस्टर्ड पता भी दिया है। हम शिकायत की पावती 24 घंटे में देते हैं और 15 दिन में निपटाते हैं। अगर आप हमारे जवाब से संतुष्ट नहीं हैं, तो आप भारत के डेटा संरक्षण बोर्ड (Data Protection Board of India) में शिकायत कर सकते हैं।`,
      },
      {
        h: '12. कुकीज़ और इसी तरह की स्टोरेज',
        p: `साइट आपकी भाषा और एनालिटिक्स की पसंद आपके ब्राउज़र में रखती है, और एक टेम्पररी पर-टैब आइडेंटिफायर जो टैब बंद करते ही खत्म हो जाता है। Google Analytics की कुकीज़ सिर्फ आपकी अनुमति पर लगती हैं। ब्राउज़र में स्टोरेज ब्लॉक करने से भी आप बुकिंग कर सकते हैं।`,
      },
      {
        h: '13. इस नीति में बदलाव',
        p: `इस नीति में बदलाव करने पर हम ऊपर की तारीख बदलते हैं। अगर किसी बदलाव के लिए आपकी सहमति चाहिए — जैसे कोई नया काम — तो आप पर लागू करने से पहले हम आपसे पूछेंगे। यह नीति भारत के कानूनों के तहत है और हमारी शर्तों (Terms) के साथ पढ़ी जाती है।`,
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
              {s.p && <p className="text-gray-600 text-sm leading-relaxed">{s.p}</p>}
              {s.list && (
                <ul className="list-disc pl-5 mt-2 space-y-1.5 text-gray-600 text-sm leading-relaxed">
                  {s.list.map(item => <li key={item}>{item}</li>)}
                </ul>
              )}
              {s.after && <p className="text-gray-600 text-sm leading-relaxed mt-2">{s.after}</p>}
            </div>
          ))}
        </div>

        <button onClick={() => window.dispatchEvent(new Event(OPEN_ANALYTICS_SETTINGS))}
          className="mt-8 text-sm font-semibold text-teal-700 underline">
          {c.settings}
        </button>
      </div>

      <SiteFooter />
    </div>
  )
}
