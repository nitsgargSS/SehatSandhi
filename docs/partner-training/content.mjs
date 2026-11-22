// Care Partner Program — reading material and quiz questions for Modules 1–10.
// DRAFT (22 Nov 2026), written from the live product and the brief; to be
// reviewed by Nitin (and the lawyer/CA for Modules 3, 5, 7, 8, 10) before launch.
// Build the PDFs and load sandbox with: node scripts/partner-training.mjs
//
// Rules for this text: no income promises, never "government/ABDM approved",
// no insurance or EMI, prices described as "at the time of writing — check
// sehatsandhi.com/business". Numbers that are settings are written as they
// are today; the Help Center always shows the current values.

export const VERSION = 'draft-1 · 22 Nov 2026'

export const MODULES = [
  {
    slug: 'what-is-sehatsandhi',
    en: {
      title: 'What Sehatsandhi is, and who it is for',
      sections: [
        ['Sehatsandhi in one line', ['Sehatsandhi helps families find and book verified doctors, labs, pharmacies and ambulances near them — and gives those businesses simple software to run their practice and be found.']],
        ['For patients (free)', ['Patients search on the website or simply message on WhatsApp, in Hindi or English, any time of day.', 'They book appointments, order medicines, ask for an ambulance or a lab test, and receive prescriptions, bills and reports as a link on their phone.', 'Patients never pay Sehatsandhi.']],
        ['For businesses (paid plans)', ['Clinics, polyclinics, multi-speciality clinics and hospitals', 'Pathology labs and diagnostic centres', 'Pharmacies', 'They get: being listed for the PIN codes around them, WhatsApp booking, the clinic software (appointments, patient records, billing, pharmacy, lab, reports) and, as add-ons, WhatsApp marketing to their own patients and a website.']],
        ['Who runs it', ['Sehatsandhi is a product of NG Technologies. Businesses always pay Sehatsandhi directly, online.']],
        ['Your role as a Care Partner', ['You introduce Sehatsandhi to doctors and health businesses near you, explain what it does, and help them decide. You are an independent partner — not an employee, and never someone who handles money.']],
      ],
    },
    hi: {
      title: 'सेहतसंधि क्या है, और किसके लिए है',
      sections: [
        ['एक पंक्ति में सेहतसंधि', ['सेहतसंधि परिवारों को अपने आस-पास के वेरिफ़ाइड डॉक्टर, लैब, फ़ार्मेसी और एम्बुलेंस ढूँढने और बुक करने में मदद करता है — और इन व्यवसायों को अपना काम चलाने और मरीज़ों तक पहुँचने के लिए आसान सॉफ़्टवेयर देता है।']],
        ['मरीज़ों के लिए (मुफ़्त)', ['मरीज़ वेबसाइट पर खोजते हैं या सीधे WhatsApp पर, हिंदी या अंग्रेज़ी में, किसी भी समय मैसेज करते हैं।', 'वे अपॉइंटमेंट बुक करते हैं, दवाइयाँ मँगाते हैं, एम्बुलेंस या लैब टेस्ट माँगते हैं, और पर्ची, बिल व रिपोर्ट अपने फ़ोन पर लिंक के रूप में पाते हैं।', 'मरीज़ सेहतसंधि को कभी भुगतान नहीं करते।']],
        ['व्यवसायों के लिए (पेड प्लान)', ['क्लिनिक, पॉलीक्लिनिक, मल्टी-स्पेशियलिटी क्लिनिक और अस्पताल', 'पैथोलॉजी लैब और डायग्नोस्टिक सेंटर', 'फ़ार्मेसी', 'उन्हें मिलता है: आस-पास के PIN कोड में लिस्टिंग, WhatsApp बुकिंग, क्लिनिक सॉफ़्टवेयर (अपॉइंटमेंट, मरीज़ रिकॉर्ड, बिलिंग, फ़ार्मेसी, लैब, रिपोर्ट) और ऐड-ऑन के रूप में अपने मरीज़ों को WhatsApp मार्केटिंग और वेबसाइट।']],
        ['इसे कौन चलाता है', ['सेहतसंधि NG Technologies का प्रोडक्ट है। व्यवसाय हमेशा सीधे, ऑनलाइन सेहतसंधि को भुगतान करते हैं।']],
        ['केयर पार्टनर के रूप में आपकी भूमिका', ['आप अपने आस-पास के डॉक्टरों और हेल्थ व्यवसायों को सेहतसंधि के बारे में बताते हैं, समझाते हैं कि यह क्या करता है, और उन्हें फ़ैसला लेने में मदद करते हैं। आप एक स्वतंत्र पार्टनर हैं — कर्मचारी नहीं, और कभी पैसे लेने वाले नहीं।']],
      ],
    },
    questions: [
      ['single', 'Who pays Sehatsandhi?', 'सेहतसंधि को कौन भुगतान करता है?', [['Patients, for every booking', 'मरीज़, हर बुकिंग पर'], ['Businesses on paid plans; patients use it free', 'पेड प्लान वाले व्यवसाय; मरीज़ों के लिए मुफ़्त'], ['The government', 'सरकार'], ['Care Partners', 'केयर पार्टनर']], ['b'], 'Patients never pay Sehatsandhi. Businesses pay for their plans.', 'मरीज़ कभी भुगतान नहीं करते। व्यवसाय अपने प्लान के लिए भुगतान करते हैं।'],
      ['multi', 'Which businesses can use Sehatsandhi? (choose all that are right)', 'कौन-से व्यवसाय सेहतसंधि इस्तेमाल कर सकते हैं? (सभी सही चुनें)', [['Clinics and hospitals', 'क्लिनिक और अस्पताल'], ['Pathology labs and diagnostic centres', 'पैथोलॉजी लैब और डायग्नोस्टिक सेंटर'], ['Pharmacies', 'फ़ार्मेसी'], ['Grocery shops', 'किराने की दुकानें']], ['a', 'b', 'c'], 'Clinics, hospitals, labs, diagnostic centres and pharmacies.', 'क्लिनिक, अस्पताल, लैब, डायग्नोस्टिक सेंटर और फ़ार्मेसी।'],
      ['truefalse', 'Patients can book on WhatsApp in Hindi or English.', 'मरीज़ WhatsApp पर हिंदी या अंग्रेज़ी में बुक कर सकते हैं।', null, ['t'], 'Yes — any time of day.', 'हाँ — किसी भी समय।'],
      ['single', 'What is a Care Partner?', 'केयर पार्टनर कौन है?', [['An employee of Sehatsandhi', 'सेहतसंधि का कर्मचारी'], ['An independent partner who introduces Sehatsandhi to businesses', 'एक स्वतंत्र पार्टनर जो व्यवसायों को सेहतसंधि के बारे में बताता है'], ['A cashier who collects plan fees', 'प्लान फ़ीस लेने वाला कैशियर'], ['A doctor who refers patients', 'मरीज़ भेजने वाला डॉक्टर']], ['b'], 'You are independent, and you never handle money.', 'आप स्वतंत्र हैं, और कभी पैसे नहीं लेते।'],
      ['truefalse', 'Businesses pay Sehatsandhi directly, online.', 'व्यवसाय सीधे, ऑनलाइन सेहतसंधि को भुगतान करते हैं।', null, ['t'], 'Always — never through a partner.', 'हमेशा — कभी पार्टनर के ज़रिए नहीं।'],
      ['single', 'Which company is Sehatsandhi a product of?', 'सेहतसंधि किस कंपनी का प्रोडक्ट है?', [['NG Technologies', 'NG Technologies'], ['A government department', 'एक सरकारी विभाग'], ['A hospital chain', 'एक अस्पताल चेन'], ['An insurance company', 'एक बीमा कंपनी']], ['a'], 'Sehatsandhi is a product of NG Technologies.', 'सेहतसंधि NG Technologies का प्रोडक्ट है।'],
    ],
  },
  {
    slug: 'product-demo',
    en: {
      title: 'Product demo: what a doctor gets',
      sections: [
        ['Nothing to install', ['Sehatsandhi runs in the browser the clinic already uses, on a computer or a phone. Each person signs in with their own mobile number.']],
        ['Appointments and the front desk', ['Patients book on WhatsApp in Hindi or English; reception books walk-ins and phone calls.', 'A QR poster for the clinic: patients scan it to book.', 'Patients who book on WhatsApp are asked to rate the visit.']],
        ['Patient records and documents', ['Visits, prescriptions, bills and discharge summaries, kept in one place.', 'Prescriptions, bills and reports are sent to the patient as a link to any phone.']],
        ['Billing that tallies', ['OPD and IPD bills; discounts need a reason.', 'Cash, UPI and cards — with the name of who took the money.', 'Collections by person and by method, to match the cash drawer.']],
        ['Pharmacy and lab (where the plan includes them)', ['Stock by batch and expiry; the oldest is sold first.', 'Lab orders, results and reports, with lab-technician logins.']],
        ['Team and control', ['Owner, manager, doctor, nurse and reception each see only their own screens.', 'Every search of patient records is logged.']],
        ['Being found', ['Listed for the PIN codes around the business, on WhatsApp and the web.', 'Add-ons: WhatsApp messages to their own patients, and a website with their Facebook and Instagram.']],
        ['How to demo', ['Show it on your phone in two minutes: the WhatsApp booking, a prescription link, and the bill. Then ask what matters most to them.']],
      ],
    },
    hi: {
      title: 'प्रोडक्ट डेमो: डॉक्टर को क्या मिलता है',
      sections: [
        ['कुछ इंस्टॉल नहीं करना', ['सेहतसंधि उसी ब्राउज़र में चलता है जो क्लिनिक पहले से इस्तेमाल करता है, कंप्यूटर या फ़ोन पर। हर व्यक्ति अपने मोबाइल नंबर से साइन इन करता है।']],
        ['अपॉइंटमेंट और रिसेप्शन', ['मरीज़ WhatsApp पर हिंदी या अंग्रेज़ी में बुक करते हैं; रिसेप्शन वॉक-इन और फ़ोन कॉल बुक करता है।', 'क्लिनिक के लिए QR पोस्टर: मरीज़ स्कैन करके बुक करते हैं।', 'WhatsApp से बुक करने वाले मरीज़ों से विज़िट की रेटिंग माँगी जाती है।']],
        ['मरीज़ रिकॉर्ड और दस्तावेज़', ['विज़िट, पर्ची, बिल और डिस्चार्ज समरी, एक जगह।', 'पर्ची, बिल और रिपोर्ट मरीज़ को किसी भी फ़ोन पर लिंक के रूप में भेजे जाते हैं।']],
        ['सही हिसाब वाली बिलिंग', ['OPD और IPD बिल; छूट के लिए कारण ज़रूरी।', 'नकद, UPI और कार्ड — पैसे लेने वाले के नाम के साथ।', 'व्यक्ति और तरीके के हिसाब से कलेक्शन, कैश से मिलान के लिए।']],
        ['फ़ार्मेसी और लैब (जहाँ प्लान में शामिल हों)', ['बैच और एक्सपायरी के हिसाब से स्टॉक; पुराना पहले बिकता है।', 'लैब ऑर्डर, रिज़ल्ट और रिपोर्ट, लैब-टेक्नीशियन लॉगिन के साथ।']],
        ['टीम और नियंत्रण', ['मालिक, मैनेजर, डॉक्टर, नर्स और रिसेप्शन — हर कोई सिर्फ़ अपनी स्क्रीन देखता है।', 'मरीज़ रिकॉर्ड की हर खोज लॉग होती है।']],
        ['मरीज़ों तक पहुँच', ['व्यवसाय के आस-पास के PIN कोड में, WhatsApp और वेब पर लिस्टिंग।', 'ऐड-ऑन: अपने मरीज़ों को WhatsApp मैसेज, और Facebook व Instagram के साथ वेबसाइट।']],
        ['डेमो कैसे दें', ['अपने फ़ोन पर दो मिनट में दिखाएँ: WhatsApp बुकिंग, पर्ची का लिंक और बिल। फिर पूछें कि उनके लिए सबसे ज़रूरी क्या है।']],
      ],
    },
    questions: [
      ['truefalse', 'The clinic has to install special software on its computers.', 'क्लिनिक को अपने कंप्यूटर पर खास सॉफ़्टवेयर इंस्टॉल करना पड़ता है।', null, ['f'], 'Nothing to install — it runs in the browser.', 'कुछ इंस्टॉल नहीं — यह ब्राउज़र में चलता है।'],
      ['single', 'How does a patient receive a prescription or bill?', 'मरीज़ को पर्ची या बिल कैसे मिलता है?', [['Only on paper', 'सिर्फ़ कागज़ पर'], ['As a link on their phone', 'फ़ोन पर लिंक के रूप में'], ['By post', 'डाक से'], ['They cannot receive it', 'नहीं मिल सकता']], ['b'], 'Documents are sent as a link to any phone.', 'दस्तावेज़ किसी भी फ़ोन पर लिंक के रूप में जाते हैं।'],
      ['multi', 'Which are part of billing? (choose all that are right)', 'बिलिंग में क्या शामिल है? (सभी सही चुनें)', [['Discounts need a reason', 'छूट के लिए कारण ज़रूरी'], ['The name of who took the money', 'पैसे लेने वाले का नाम'], ['Collections by method', 'तरीके के हिसाब से कलेक्शन'], ['Hiding cash from the owner', 'मालिक से नकद छुपाना']], ['a', 'b', 'c'], 'Every rupee is accounted for, and by whom.', 'हर रुपये का हिसाब, और किसने लिया।'],
      ['single', 'What does the QR poster do?', 'QR पोस्टर क्या करता है?', [['Patients scan it to book with the clinic', 'मरीज़ स्कैन करके क्लिनिक में बुक करते हैं'], ['It pays the bill', 'बिल भरता है'], ['It shows the doctor\'s salary', 'डॉक्टर की सैलरी दिखाता है'], ['Nothing', 'कुछ नहीं']], ['a'], 'Scan to book.', 'स्कैन करके बुक करें।'],
      ['truefalse', 'Each staff member signs in with their own mobile number.', 'हर स्टाफ़ सदस्य अपने मोबाइल नंबर से साइन इन करता है।', null, ['t'], 'One mobile number, one person.', 'एक मोबाइल नंबर, एक व्यक्ति।'],
      ['single', 'A good first demo is…', 'एक अच्छा पहला डेमो है…', [['A one-hour lecture', 'एक घंटे का भाषण'], ['Two minutes on your phone: WhatsApp booking, a prescription link, the bill', 'फ़ोन पर दो मिनट: WhatsApp बुकिंग, पर्ची का लिंक, बिल'], ['Sending them a long PDF only', 'सिर्फ़ लंबी PDF भेजना'], ['Asking them to pay first', 'पहले भुगतान माँगना']], ['b'], 'Short, on your phone, then listen.', 'छोटा, फ़ोन पर, फिर सुनें।'],
    ],
  },
  {
    slug: 'plans-and-rewards',
    en: {
      title: 'Plans, pricing, and how Partner Rewards work',
      sections: [
        ['Plans (at the time of writing — always check sehatsandhi.com/business)', ['Per month: Clinic (up to 2 doctors) ₹2,000 · Polyclinic (up to 4) ₹3,000 · Multi-speciality (up to 8) ₹5,000 · Hospital (up to 15) ₹8,000.', 'Labs: Pathology Lab ₹2,000 · Diagnostic Centre ₹4,000 · Diagnostic + Pathology ₹5,000. Pharmacy ₹1,500.', 'Add-ons: IPD + Pharmacy ₹2,000, Pathology ₹1,500, Diagnostics ₹3,000, Pharmacy ₹1,000, Social media & website ₹1,000. Two add-ons: 10% off; three or more: 20% off.', 'GST (18%) is added to these prices.']],
        ['Terms', ['6 months costs 5 months\' price; 12 months costs 9 months\' price. The 12-month term is the best value.']],
        ['Partner Rewards — how they work', ['You earn a reward only when a business you introduced pays for a 12-month term. 1-month and 6-month terms earn nothing.', 'Start Reward: on its 12-month payments in the first 12 months after it confirms you — 15% (Associate), 20% (Senior), 25% (Elite) of the amount before GST, up to ₹15,000 per business.', 'Renewal Reward: 10% when it renews for 12 months, as long as it keeps renewing and you stay active.', 'Your level depends on how many active businesses you have (Senior from 10, Elite from 30).']],
        ['When rewards are paid', ['A reward is approved 15 days after the business pays. Payouts are monthly: a payment on or before the 15th is in that month\'s payout; after the 15th, in the next month\'s.', 'If a business is refunded, the reward on it is taken back.']],
        ['What never earns a reward', ['Your own certification fee, bringing in other partners, monthly or 6-month terms, WhatsApp wallet top-ups.']],
        ['Important', ['We never promise income. How much you receive depends entirely on the businesses that choose Sehatsandhi.']],
      ],
    },
    hi: {
      title: 'प्लान, कीमतें, और पार्टनर रिवॉर्ड कैसे काम करते हैं',
      sections: [
        ['प्लान (लिखते समय — हमेशा sehatsandhi.com/business देखें)', ['हर महीने: क्लिनिक (2 डॉक्टर तक) ₹2,000 · पॉलीक्लिनिक (4 तक) ₹3,000 · मल्टी-स्पेशियलिटी (8 तक) ₹5,000 · अस्पताल (15 तक) ₹8,000।', 'लैब: पैथोलॉजी लैब ₹2,000 · डायग्नोस्टिक सेंटर ₹4,000 · डायग्नोस्टिक + पैथोलॉजी ₹5,000। फ़ार्मेसी ₹1,500।', 'ऐड-ऑन: IPD + फ़ार्मेसी ₹2,000, पैथोलॉजी ₹1,500, डायग्नोस्टिक्स ₹3,000, फ़ार्मेसी ₹1,000, सोशल मीडिया और वेबसाइट ₹1,000। दो ऐड-ऑन पर 10% छूट; तीन या ज़्यादा पर 20%।', 'इन कीमतों पर GST (18%) जुड़ता है।']],
        ['अवधि', ['6 महीने की कीमत 5 महीने जितनी; 12 महीने की कीमत 9 महीने जितनी। 12 महीने का प्लान सबसे फ़ायदेमंद है।']],
        ['पार्टनर रिवॉर्ड — कैसे काम करते हैं', ['रिवॉर्ड तभी मिलता है जब आपका जोड़ा हुआ व्यवसाय 12 महीने का प्लान लेता है। 1 या 6 महीने पर कुछ नहीं।', 'स्टार्ट रिवॉर्ड: आपकी पुष्टि के बाद पहले 12 महीनों में 12 महीने के भुगतानों पर — GST से पहले की राशि का 15% (एसोसिएट), 20% (सीनियर), 25% (एलीट), प्रति व्यवसाय ₹15,000 तक।', 'रिन्यूअल रिवॉर्ड: 12 महीने के रिन्यूअल पर 10%, जब तक वह रिन्यू करता रहे और आप सक्रिय रहें।', 'आपका लेवल आपके सक्रिय व्यवसायों की संख्या पर निर्भर है (10 से सीनियर, 30 से एलीट)।']],
        ['रिवॉर्ड कब मिलते हैं', ['व्यवसाय के भुगतान के 15 दिन बाद रिवॉर्ड मंज़ूर होता है। भुगतान हर महीने: 15 तारीख तक का भुगतान उसी महीने के पेआउट में; 15 के बाद, अगले महीने में।', 'अगर व्यवसाय को रिफ़ंड मिलता है, तो उस पर मिला रिवॉर्ड वापस लिया जाता है।']],
        ['किस पर कभी रिवॉर्ड नहीं', ['आपकी अपनी सर्टिफ़िकेशन फ़ीस, दूसरे पार्टनर जोड़ना, मासिक या 6 महीने के प्लान, WhatsApp वॉलेट टॉप-अप।']],
        ['ज़रूरी', ['हम कभी कमाई का वादा नहीं करते। आपको कितना मिलेगा, यह पूरी तरह उन व्यवसायों पर निर्भर है जो सेहतसंधि चुनते हैं।']],
      ],
    },
    questions: [
      ['single', 'Which term earns a Partner Reward?', 'किस अवधि पर पार्टनर रिवॉर्ड मिलता है?', [['1 month', '1 महीना'], ['6 months', '6 महीने'], ['12 months', '12 महीने'], ['Any term', 'कोई भी']], ['c'], 'Only 12-month terms.', 'सिर्फ़ 12 महीने।'],
      ['single', 'What does a 12-month term cost?', '12 महीने के प्लान की कीमत कितनी है?', [['12 months\' price', '12 महीने जितनी'], ['9 months\' price', '9 महीने जितनी'], ['6 months\' price', '6 महीने जितनी'], ['It is free', 'मुफ़्त']], ['b'], '12 months costs 9 months\' price.', '12 महीने की कीमत 9 महीने जितनी।'],
      ['truefalse', 'You earn a reward on your own certification fee.', 'आपको अपनी सर्टिफ़िकेशन फ़ीस पर रिवॉर्ड मिलता है।', null, ['f'], 'Never.', 'कभी नहीं।'],
      ['single', 'A business pays on the 20th. Which payout is its reward in?', 'व्यवसाय 20 तारीख को भुगतान करता है। उसका रिवॉर्ड किस पेआउट में होगा?', [['This month\'s', 'इस महीने के'], ['Next month\'s', 'अगले महीने के'], ['Next year\'s', 'अगले साल के'], ['None', 'किसी में नहीं']], ['b'], 'After the 15th → next month\'s payout.', '15 के बाद → अगले महीने का पेआउट।'],
      ['multi', 'Which never earn a reward? (choose all that are right)', 'किन पर कभी रिवॉर्ड नहीं मिलता? (सभी सही चुनें)', [['Bringing in other partners', 'दूसरे पार्टनर जोड़ना'], ['A 6-month term', '6 महीने का प्लान'], ['WhatsApp wallet top-ups', 'WhatsApp वॉलेट टॉप-अप'], ['A 12-month term of a business you introduced', 'आपके जोड़े व्यवसाय का 12 महीने का प्लान']], ['a', 'b', 'c'], 'Only 12-month plan payments of businesses you introduced.', 'सिर्फ़ आपके जोड़े व्यवसायों के 12 महीने के प्लान।'],
      ['truefalse', 'Sehatsandhi promises partners a fixed monthly income.', 'सेहतसंधि पार्टनर को तय मासिक कमाई का वादा करता है।', null, ['f'], 'We never promise income.', 'हम कभी कमाई का वादा नहीं करते।'],
    ],
  },
  {
    slug: 'approaching-a-doctor',
    en: {
      title: 'How to approach a doctor',
      sections: [
        ['Before you go', ['Know the clinic: what kind (clinic, lab, pharmacy, hospital), how many doctors, busy hours. Visit outside the busiest time.', 'Carry your badge, and have the demo ready on your phone.']],
        ['The first two minutes', ['Introduce yourself by name, say you are a Sehatsandhi Care Partner and show your badge (the doctor can scan it to check you).', 'Ask for two minutes, and ask how they handle bookings and bills today.']],
        ['Listen first', ['Find their real problem: missed calls, long queues, billing that does not tally, wanting more patients nearby. Show only the part of Sehatsandhi that solves it.']],
        ['Common questions', ['"It costs money." — Explain the plan for their size, and that the 12-month term costs 9 months\' price. Never invent a discount.', '"My staff are not good with computers." — Nothing to install; it runs in the browser and each screen is simple.', '"I already have software." — Ask what they miss in it; WhatsApp booking and being listed nearby are often new.', '"I will think about it." — Thank them, leave your details, agree a time to come back. Never pressure.']],
        ['Closing', ['When they are ready, they sign up on sehatsandhi.com/business themselves. They can type your Partner ID, or you reserve their number first in your app. They always pay Sehatsandhi directly.']],
      ],
    },
    hi: {
      title: 'डॉक्टर से कैसे बात करें',
      sections: [
        ['जाने से पहले', ['क्लिनिक को जानें: किस तरह का है (क्लिनिक, लैब, फ़ार्मेसी, अस्पताल), कितने डॉक्टर, भीड़ का समय। सबसे व्यस्त समय से बचें।', 'अपना बैज साथ रखें, और फ़ोन पर डेमो तैयार रखें।']],
        ['पहले दो मिनट', ['अपना नाम बताएँ, कहें कि आप सेहतसंधि केयर पार्टनर हैं और बैज दिखाएँ (डॉक्टर इसे स्कैन करके जाँच सकते हैं)।', 'दो मिनट माँगें, और पूछें कि वे आज बुकिंग और बिल कैसे संभालते हैं।']],
        ['पहले सुनें', ['उनकी असली समस्या समझें: छूटी कॉल, लंबी लाइन, बिलिंग का हिसाब न मिलना, आस-पास से ज़्यादा मरीज़ चाहना। सेहतसंधि का वही हिस्सा दिखाएँ जो उसे हल करे।']],
        ['आम सवाल', ['"इसमें पैसे लगते हैं।" — उनके आकार का प्लान समझाएँ, और बताएँ कि 12 महीने की कीमत 9 महीने जितनी है। कभी अपनी तरफ़ से छूट न बनाएँ।', '"मेरा स्टाफ़ कंप्यूटर में अच्छा नहीं।" — कुछ इंस्टॉल नहीं; ब्राउज़र में चलता है और हर स्क्रीन आसान है।', '"मेरे पास पहले से सॉफ़्टवेयर है।" — पूछें उसमें क्या कमी है; WhatsApp बुकिंग और आस-पास लिस्टिंग अक्सर नई होती है।', '"मैं सोचूँगा।" — धन्यवाद कहें, अपना संपर्क छोड़ें, फिर आने का समय तय करें। कभी दबाव न डालें।']],
        ['बात पूरी करना', ['जब वे तैयार हों, वे खुद sehatsandhi.com/business पर साइन अप करते हैं। वे आपका Partner ID लिख सकते हैं, या आप पहले ऐप में उनका नंबर रिज़र्व करें। वे हमेशा सीधे सेहतसंधि को भुगतान करते हैं।']],
      ],
    },
    questions: [
      ['single', 'What should you do first when you meet a doctor?', 'डॉक्टर से मिलते ही पहले क्या करें?', [['Ask them to pay', 'भुगतान माँगें'], ['Introduce yourself and show your badge', 'अपना परिचय दें और बैज दिखाएँ'], ['Criticise their current software', 'उनके मौजूदा सॉफ़्टवेयर की बुराई करें'], ['Promise more patients', 'ज़्यादा मरीज़ों का वादा करें']], ['b'], 'Name, Care Partner, badge.', 'नाम, केयर पार्टनर, बैज।'],
      ['truefalse', 'If a doctor says "I will think about it", you should keep pressing until they agree.', 'अगर डॉक्टर कहें "मैं सोचूँगा", तो आपको तब तक दबाव डालना चाहिए जब तक वे मान न जाएँ।', null, ['f'], 'Never pressure. Agree a time to come back.', 'कभी दबाव नहीं। फिर आने का समय तय करें।'],
      ['single', 'A doctor asks for a discount. You…', 'डॉक्टर छूट माँगते हैं। आप…', [['Offer 50% off from your side', 'अपनी तरफ़ से 50% छूट दें'], ['Explain the 12-month term and never invent a discount', '12 महीने का प्लान समझाएँ, अपनी तरफ़ से छूट कभी न बनाएँ'], ['Promise a free year', 'एक साल मुफ़्त का वादा करें'], ['Take cash to give a discount', 'छूट के लिए नकद लें']], ['b'], 'Only official prices and offers.', 'सिर्फ़ आधिकारिक कीमतें और ऑफ़र।'],
      ['single', 'Where does the doctor sign up?', 'डॉक्टर कहाँ साइन अप करते हैं?', [['On sehatsandhi.com/business, themselves', 'खुद sehatsandhi.com/business पर'], ['Through your personal bank account', 'आपके बैंक खाते से'], ['By giving you cash', 'आपको नकद देकर'], ['On a paper form you keep', 'आपके पास रहने वाले कागज़ी फ़ॉर्म पर']], ['a'], 'They sign up and pay Sehatsandhi directly.', 'वे खुद साइन अप करके सीधे सेहतसंधि को भुगतान करते हैं।'],
      ['truefalse', 'It is better to visit a clinic outside its busiest hours.', 'क्लिनिक में सबसे व्यस्त समय के बाहर जाना बेहतर है।', null, ['t'], 'Respect their time.', 'उनके समय का सम्मान करें।'],
      ['multi', 'Good ways to start a conversation (choose all that are right)', 'बातचीत शुरू करने के अच्छे तरीके (सभी सही चुनें)', [['Ask for two minutes', 'दो मिनट माँगें'], ['Ask how they handle bookings today', 'पूछें आज बुकिंग कैसे संभालते हैं'], ['Show a short demo on your phone', 'फ़ोन पर छोटा डेमो दिखाएँ'], ['Read out a long list of every feature', 'हर फ़ीचर की लंबी सूची पढ़ें']], ['a', 'b', 'c'], 'Short, curious, relevant.', 'छोटा, जिज्ञासु, काम का।'],
    ],
  },
  {
    slug: 'dos-and-donts',
    en: {
      title: "Dos and don'ts",
      sections: [
        ['Say only what is true and approved', ['Describe only what this training teaches. If you do not know, say "I will find out" and ask us through a ticket.']],
        ['Never say', ['"Sehatsandhi is government approved" or "ABDM approved". It is not something you may claim.', '"You will get more patients" or "you will earn ₹X". Never promise patients, income or results.', 'Anything bad about another company or software.']],
        ['Never do', ['Never take cash or any payment from a business — they always pay Sehatsandhi directly.', 'Never offer a discount, free months or gifts that are not official offers.', 'Never sign up a business for them or use their login.', 'Never collect or look at patient data.']],
        ['Always do', ['Show your badge; tell them they can check you at sehatsandhi.com/verify/<your ID>.', 'Respect "no". Leave politely.', 'Report problems or complaints to us through a ticket.']],
        ['If you break these rules', ['A warning, a pause, or the end of your partnership — and misrepresentation means immediate suspension and losing unpaid rewards.']],
      ],
    },
    hi: {
      title: 'क्या करें और क्या न करें',
      sections: [
        ['सिर्फ़ सच और मान्य बातें कहें', ['सिर्फ़ वही बताएँ जो यह ट्रेनिंग सिखाती है। अगर नहीं पता, तो कहें "मैं पता करके बताऊँगा" और टिकट से हमसे पूछें।']],
        ['कभी न कहें', ['"सेहतसंधि सरकार से मंज़ूर है" या "ABDM से मंज़ूर है"। आप यह दावा नहीं कर सकते।', '"आपको ज़्यादा मरीज़ मिलेंगे" या "आप ₹X कमाएँगे"। कभी मरीज़, कमाई या नतीजों का वादा न करें।', 'किसी दूसरी कंपनी या सॉफ़्टवेयर की बुराई।']],
        ['कभी न करें', ['किसी व्यवसाय से कभी नकद या कोई भुगतान न लें — वे हमेशा सीधे सेहतसंधि को भुगतान करते हैं।', 'ऐसी छूट, मुफ़्त महीने या तोहफ़े न दें जो आधिकारिक ऑफ़र नहीं हैं।', 'उनकी तरफ़ से साइन अप न करें, न उनका लॉगिन इस्तेमाल करें।', 'मरीज़ों का डेटा कभी न लें, न देखें।']],
        ['हमेशा करें', ['अपना बैज दिखाएँ; बताएँ कि वे sehatsandhi.com/verify/<आपका ID> पर आपको जाँच सकते हैं।', '"नहीं" का सम्मान करें। विनम्रता से जाएँ।', 'समस्या या शिकायत टिकट से हमें बताएँ।']],
        ['नियम तोड़ने पर', ['चेतावनी, रोक, या साझेदारी खत्म — और गलत जानकारी देने पर तुरंत निलंबन और बकाया रिवॉर्ड खत्म।']],
      ],
    },
    questions: [
      ['single', 'A doctor asks "Is Sehatsandhi government approved?" You say…', 'डॉक्टर पूछते हैं "क्या सेहतसंधि सरकार से मंज़ूर है?" आप कहेंगे…', [['Yes, fully approved', 'हाँ, पूरी तरह मंज़ूर'], ['Yes, ABDM approved', 'हाँ, ABDM से मंज़ूर'], ['I can only tell you what Sehatsandhi does; I will not claim approvals', 'मैं सिर्फ़ बता सकता हूँ कि सेहतसंधि क्या करता है; मंज़ूरी का दावा नहीं करूँगा'], ['Probably', 'शायद']], ['c'], 'Never claim government or ABDM approval.', 'सरकार या ABDM मंज़ूरी का दावा कभी नहीं।'],
      ['truefalse', 'You may promise a doctor more patients if they join.', 'आप डॉक्टर को जुड़ने पर ज़्यादा मरीज़ों का वादा कर सकते हैं।', null, ['f'], 'Never promise patients, income or results.', 'मरीज़, कमाई या नतीजों का वादा कभी नहीं।'],
      ['single', 'A doctor wants to pay you in cash to save time. You…', 'डॉक्टर समय बचाने के लिए आपको नकद देना चाहते हैं। आप…', [['Take it and pay online later', 'ले लें और बाद में ऑनलाइन भर दें'], ['Refuse; they pay Sehatsandhi directly online', 'मना करें; वे सीधे ऑनलाइन सेहतसंधि को भुगतान करें'], ['Take half', 'आधा ले लें'], ['Ask a friend to collect it', 'किसी दोस्त से लेने को कहें']], ['b'], 'Never handle money.', 'कभी पैसे न लें।'],
      ['multi', 'Which are allowed? (choose all that are right)', 'किसकी अनुमति है? (सभी सही चुनें)', [['Showing your badge', 'अपना बैज दिखाना'], ['Saying "I will find out" when unsure', 'पक्का न होने पर "मैं पता करूँगा" कहना'], ['Offering free months on your own', 'अपनी तरफ़ से मुफ़्त महीने देना'], ['Respecting "no"', '"नहीं" का सम्मान करना']], ['a', 'b', 'd'], 'Free months are only official offers.', 'मुफ़्त महीने सिर्फ़ आधिकारिक ऑफ़र होते हैं।'],
      ['truefalse', 'Misrepresenting Sehatsandhi can lead to immediate suspension.', 'सेहतसंधि के बारे में गलत जानकारी देने से तुरंत निलंबन हो सकता है।', null, ['t'], 'And unpaid rewards are lost.', 'और बकाया रिवॉर्ड खत्म।'],
      ['single', 'Can you sign up a business using its owner\'s login?', 'क्या आप मालिक के लॉगिन से व्यवसाय का साइन अप कर सकते हैं?', [['Yes, if they are busy', 'हाँ, अगर वे व्यस्त हों'], ['No — they sign up themselves', 'नहीं — वे खुद साइन अप करते हैं'], ['Only for small clinics', 'सिर्फ़ छोटे क्लिनिक के लिए'], ['Only on weekends', 'सिर्फ़ छुट्टी के दिन']], ['b'], 'Never use their login.', 'उनका लॉगिन कभी नहीं।'],
    ],
  },
  {
    slug: 'using-the-partner-app',
    en: {
      title: 'Using the Partner app: Partner ID, leads and confirmation',
      sections: [
        ['Your Partner ID and badge', ['After the exam and the certification fee you get a Partner ID (like SP-4K7M2Q) and a badge with a QR code. Anyone can scan it to see your name, city and status. Accept the Partner Agreement to activate it.']],
        ['Reserving a doctor', ['In your dashboard, add the doctor\'s name and mobile number. The number is kept for you for 90 days. Nothing is sent to the doctor.', 'A number already on Sehatsandhi cannot be reserved — the app simply says it cannot be locked.', 'A new partner can hold 10 reserved doctors at a time; the limit rises as businesses you introduce start paying.']],
        ['How the doctor confirms you', ['When the doctor signs up with that number, the app asks: "Did <your name> from <your city> introduce Sehatsandhi to you?" Yes credits you; No does not.', 'Or the doctor types your Partner ID at sign-up — that counts as yes.']],
        ['If the doctor paid without your ID', ['Open a ticket within 7 days of their payment with the business name and number. We ask the business to confirm in its app; nothing is credited until it says yes.']],
        ['Tickets and help', ['The Help Center answers most questions. For anything about your account, open a ticket — we reply within 48 hours. There is no phone support.']],
      ],
    },
    hi: {
      title: 'पार्टनर ऐप: Partner ID, लीड और पुष्टि',
      sections: [
        ['आपका Partner ID और बैज', ['परीक्षा और सर्टिफ़िकेशन फ़ीस के बाद आपको Partner ID (जैसे SP-4K7M2Q) और QR कोड वाला बैज मिलता है। कोई भी इसे स्कैन करके आपका नाम, शहर और स्थिति देख सकता है। इसे चालू करने के लिए पार्टनर एग्रीमेंट स्वीकार करें।']],
        ['डॉक्टर को रिज़र्व करना', ['डैशबोर्ड में डॉक्टर का नाम और मोबाइल नंबर जोड़ें। नंबर 90 दिन आपके नाम रहता है। डॉक्टर को कुछ नहीं भेजा जाता।', 'जो नंबर पहले से सेहतसंधि पर है, वह रिज़र्व नहीं होता — ऐप बस कहता है कि यह लॉक नहीं हो सकता।', 'नया पार्टनर एक समय में 10 डॉक्टर रिज़र्व कर सकता है; आपके जोड़े व्यवसाय भुगतान शुरू करें तो सीमा बढ़ती है।']],
        ['डॉक्टर आपकी पुष्टि कैसे करते हैं', ['डॉक्टर जब उस नंबर से साइन अप करते हैं, ऐप पूछता है: "क्या <आपके शहर> के <आपका नाम> ने आपको सेहतसंधि के बारे में बताया?" हाँ पर आपको क्रेडिट मिलता है; नहीं पर नहीं।', 'या डॉक्टर साइन अप पर आपका Partner ID लिखते हैं — यह हाँ माना जाता है।']],
        ['अगर डॉक्टर ने आपके ID के बिना भुगतान किया', ['उनके भुगतान के 7 दिन के अंदर व्यवसाय का नाम और नंबर लिखकर टिकट खोलें। हम व्यवसाय से ऐप में पुष्टि माँगते हैं; हाँ कहने तक कुछ क्रेडिट नहीं होता।']],
        ['टिकट और मदद', ['ज़्यादातर सवालों के जवाब सहायता केंद्र में हैं। अपने खाते के बारे में कुछ भी हो तो टिकट खोलें — हम 48 घंटे में जवाब देते हैं। फ़ोन सहायता नहीं है।']],
      ],
    },
    questions: [
      ['truefalse', 'When you reserve a doctor, Sehatsandhi sends them a message.', 'जब आप डॉक्टर को रिज़र्व करते हैं, सेहतसंधि उन्हें मैसेज भेजता है।', null, ['f'], 'Nothing is sent to the doctor.', 'डॉक्टर को कुछ नहीं भेजा जाता।'],
      ['single', 'How long is a reserved number kept for you?', 'रिज़र्व किया नंबर कितने दिन आपके नाम रहता है?', [['7 days', '7 दिन'], ['30 days', '30 दिन'], ['90 days', '90 दिन'], ['Forever', 'हमेशा']], ['c'], '90 days (a setting; the Help Center shows the current value).', '90 दिन (सेटिंग; सहायता केंद्र में मौजूदा संख्या)।'],
      ['single', 'The doctor typed your Partner ID at sign-up. This means…', 'डॉक्टर ने साइन अप पर आपका Partner ID लिखा। इसका मतलब…', [['Nothing', 'कुछ नहीं'], ['It counts as confirming you', 'यह आपकी पुष्टि माना जाता है'], ['You must pay a fee', 'आपको फ़ीस देनी होगी'], ['The doctor gets a discount', 'डॉक्टर को छूट मिलती है']], ['b'], 'Typing your ID is a yes.', 'ID लिखना हाँ है।'],
      ['single', 'A doctor paid without your ID. What do you do?', 'डॉक्टर ने आपके ID के बिना भुगतान किया। आप क्या करेंगे?', [['Nothing can be done', 'कुछ नहीं हो सकता'], ['Open a ticket within 7 days of their payment', 'उनके भुगतान के 7 दिन के अंदर टिकट खोलें'], ['Ask the doctor to pay again', 'डॉक्टर से दोबारा भुगतान करवाएँ'], ['Call Sehatsandhi\'s phone number', 'सेहतसंधि के फ़ोन नंबर पर कॉल करें']], ['b'], 'The business then confirms in its app.', 'फिर व्यवसाय ऐप में पुष्टि करता है।'],
      ['truefalse', 'Anyone can check your badge by scanning its QR code.', 'कोई भी QR कोड स्कैन करके आपका बैज जाँच सकता है।', null, ['t'], 'It shows your name, city and status.', 'यह आपका नाम, शहर और स्थिति दिखाता है।'],
      ['single', 'The app says a number "can\'t be locked". Why?', 'ऐप कहता है नंबर "लॉक नहीं हो सकता"। क्यों?', [['It is already on Sehatsandhi or reserved', 'यह पहले से सेहतसंधि पर है या रिज़र्व है'], ['You must pay first', 'पहले भुगतान करना होगा'], ['The doctor blocked you', 'डॉक्टर ने आपको ब्लॉक किया'], ['The app is broken', 'ऐप खराब है']], ['a'], 'The app never says which, to protect privacy.', 'प्राइवेसी के लिए ऐप कभी नहीं बताता कि कौन-सा।'],
    ],
  },
  {
    slug: 'payments-and-tax',
    en: {
      title: 'Payments, payouts and tax',
      sections: [
        ['How businesses pay', ['Businesses pay Sehatsandhi directly online (Razorpay). Partners never collect money.']],
        ['The life of a reward', ['Pending: the business paid. Approved: 15 days later, if not refunded. Paid: in the monthly payout.', 'A payment on or before the 15th is in that month\'s payout; after the 15th, in the next month\'s.', 'If a payment is refunded, its reward is reversed, or taken back from later rewards.']],
        ['Your PAN and bank account', ['Before your first payout, add your own PAN and your own bank account in the dashboard. The names must match. We keep them encrypted and show only the last 4 digits.', 'We never ask for your Aadhaar number. Never share OTPs or documents with anyone.']],
        ['Minimum payout and statements', ['Payouts are made when your approved total is at least ₹500; smaller amounts carry forward.', 'Each payout has a statement in your dashboard showing the total, any tax deducted and what you receive.']],
        ['Tax', ['Tax (TDS) is deducted from payouts where the law requires it, and shown on your statement.', 'For your own tax filing, please ask your own CA — we cannot give tax advice.']],
      ],
    },
    hi: {
      title: 'भुगतान, पेआउट और टैक्स',
      sections: [
        ['व्यवसाय कैसे भुगतान करते हैं', ['व्यवसाय सीधे ऑनलाइन (Razorpay) सेहतसंधि को भुगतान करते हैं। पार्टनर कभी पैसे नहीं लेते।']],
        ['रिवॉर्ड का सफ़र', ['पेंडिंग: व्यवसाय ने भुगतान किया। मंज़ूर: 15 दिन बाद, अगर रिफ़ंड नहीं हुआ। भुगतान: मासिक पेआउट में।', '15 तारीख तक का भुगतान उसी महीने के पेआउट में; 15 के बाद, अगले महीने में।', 'अगर भुगतान रिफ़ंड होता है, तो उसका रिवॉर्ड वापस होता है, या आगे के रिवॉर्ड से काटा जाता है।']],
        ['आपका PAN और बैंक खाता', ['पहले पेआउट से पहले डैशबोर्ड में अपना PAN और अपना बैंक खाता जोड़ें। नाम मेल खाने चाहिए। हम इन्हें एन्क्रिप्ट करके रखते हैं और सिर्फ़ आख़िरी 4 अंक दिखाते हैं।', 'हम कभी आपका आधार नंबर नहीं माँगते। कभी किसी से OTP या दस्तावेज़ साझा न करें।']],
        ['न्यूनतम पेआउट और स्टेटमेंट', ['पेआउट तब होता है जब आपका मंज़ूर कुल कम से कम ₹500 हो; कम राशि आगे जुड़ती है।', 'हर पेआउट का डैशबोर्ड में स्टेटमेंट होता है: कुल, काटा गया टैक्स, और आपको मिलने वाली राशि।']],
        ['टैक्स', ['जहाँ कानून कहता है, पेआउट से टैक्स (TDS) काटा जाता है और स्टेटमेंट में दिखता है।', 'अपने टैक्स के लिए अपने CA से पूछें — हम टैक्स सलाह नहीं दे सकते।']],
      ],
    },
    questions: [
      ['single', 'When is a reward approved?', 'रिवॉर्ड कब मंज़ूर होता है?', [['The same day', 'उसी दिन'], ['15 days after the business pays, if not refunded', 'व्यवसाय के भुगतान के 15 दिन बाद, अगर रिफ़ंड नहीं हुआ'], ['After one year', 'एक साल बाद'], ['Never', 'कभी नहीं']], ['b'], '15 days, then paid monthly.', '15 दिन, फिर मासिक भुगतान।'],
      ['truefalse', 'Sehatsandhi asks for your Aadhaar number for payouts.', 'सेहतसंधि पेआउट के लिए आपका आधार नंबर माँगता है।', null, ['f'], 'Only PAN and your own bank account.', 'सिर्फ़ PAN और आपका अपना बैंक खाता।'],
      ['single', 'Your approved total this month is ₹300. What happens?', 'इस महीने आपका मंज़ूर कुल ₹300 है। क्या होगा?', [['It is lost', 'खत्म हो जाएगा'], ['It carries forward until it reaches the minimum payout', 'न्यूनतम पेआउट तक पहुँचने तक आगे जुड़ता है'], ['You must pay ₹200', 'आपको ₹200 देने होंगे'], ['It is paid in cash', 'नकद मिलेगा']], ['b'], 'Minimum payout ₹500; smaller amounts carry forward.', 'न्यूनतम पेआउट ₹500; कम राशि आगे जुड़ती है।'],
      ['truefalse', 'The bank account must be in your own name.', 'बैंक खाता आपके अपने नाम पर होना चाहिए।', null, ['t'], 'Names on PAN and bank must match.', 'PAN और बैंक के नाम मेल खाने चाहिए।'],
      ['single', 'A business you introduced gets a full refund after your reward was paid. Then…', 'आपके रिवॉर्ड के भुगतान के बाद आपके जोड़े व्यवसाय को पूरा रिफ़ंड मिलता है। तब…', [['Nothing changes', 'कुछ नहीं बदलता'], ['The reward is taken back from later rewards', 'रिवॉर्ड आगे के रिवॉर्ड से काटा जाता है'], ['You go to jail', 'आप जेल जाते हैं'], ['The business pays you', 'व्यवसाय आपको भुगतान करता है']], ['b'], 'This is called a clawback.', 'इसे क्लॉबैक कहते हैं।'],
      ['single', 'Who should you ask about your own income tax?', 'अपने इनकम टैक्स के बारे में किससे पूछें?', [['Sehatsandhi support', 'सेहतसंधि सहायता'], ['Your own CA', 'अपने CA से'], ['The doctor', 'डॉक्टर से'], ['Another partner', 'दूसरे पार्टनर से']], ['b'], 'We cannot give tax advice.', 'हम टैक्स सलाह नहीं दे सकते।'],
    ],
  },
  {
    slug: 'ethics-and-privacy',
    en: {
      title: 'Medical ethics and privacy',
      sections: [
        ['Why this matters', ['Healthcare runs on trust. Doctors follow the National Medical Commission (NMC) rules on ethics, and personal data is protected by India\'s Digital Personal Data Protection (DPDP) Act.']],
        ['Never tied to patients', ['Rewards are only for software plans that businesses buy. Nothing you do is ever linked to referring patients, patient numbers or what a doctor prescribes.', 'Never suggest to a doctor that Sehatsandhi will send them patients in return for anything.']],
        ['No patient data, ever', ['You see a business\'s name, city and whether it is paying — nothing else. You never see, ask for, photograph or share patient information, even if offered.']],
        ['The doctor\'s own data', ['Add a doctor\'s number only if you are really talking to them. Never share a doctor\'s number with others. When a reservation ends, the number is deleted.']],
        ['Your data', ['We keep only what we need to run your partnership. You can ask to delete your account; financial records are kept as the law requires.']],
      ],
    },
    hi: {
      title: 'मेडिकल नैतिकता और प्राइवेसी',
      sections: [
        ['यह क्यों ज़रूरी है', ['स्वास्थ्य सेवा भरोसे पर चलती है। डॉक्टर नैतिकता के लिए राष्ट्रीय चिकित्सा आयोग (NMC) के नियम मानते हैं, और निजी डेटा भारत के डिजिटल पर्सनल डेटा प्रोटेक्शन (DPDP) कानून से सुरक्षित है।']],
        ['मरीज़ों से कभी जुड़ा नहीं', ['रिवॉर्ड सिर्फ़ उन सॉफ़्टवेयर प्लान के लिए हैं जो व्यवसाय खरीदते हैं। आपका कोई भी काम मरीज़ भेजने, मरीज़ों की संख्या या डॉक्टर के लिखे इलाज से कभी नहीं जुड़ता।', 'डॉक्टर को कभी न कहें कि सेहतसंधि किसी बदले में उन्हें मरीज़ भेजेगा।']],
        ['मरीज़ों का डेटा, कभी नहीं', ['आप व्यवसाय का नाम, शहर और भुगतान स्थिति देखते हैं — और कुछ नहीं। आप मरीज़ों की जानकारी कभी न देखें, न माँगें, न फ़ोटो लें, न साझा करें, भले ही कोई दे।']],
        ['डॉक्टर का अपना डेटा', ['डॉक्टर का नंबर तभी जोड़ें जब आप सच में उनसे बात कर रहे हों। किसी डॉक्टर का नंबर दूसरों से साझा न करें। रिज़र्वेशन खत्म होने पर नंबर हटा दिया जाता है।']],
        ['आपका डेटा', ['हम सिर्फ़ उतना रखते हैं जितना आपकी साझेदारी के लिए ज़रूरी है। आप अपना खाता हटाने को कह सकते हैं; वित्तीय रिकॉर्ड कानून के अनुसार रखे जाते हैं।']],
      ],
    },
    questions: [
      ['truefalse', 'Partner Rewards are linked to how many patients a doctor sees.', 'पार्टनर रिवॉर्ड डॉक्टर के मरीज़ों की संख्या से जुड़े हैं।', null, ['f'], 'Only to software plans businesses buy.', 'सिर्फ़ व्यवसायों के खरीदे सॉफ़्टवेयर प्लान से।'],
      ['single', 'A clinic owner offers to show you their patient list. You…', 'क्लिनिक मालिक आपको मरीज़ों की सूची दिखाना चाहते हैं। आप…', [['Take a photo for later', 'बाद के लिए फ़ोटो लें'], ['Politely refuse — partners never see patient data', 'विनम्रता से मना करें — पार्टनर कभी मरीज़ों का डेटा नहीं देखते'], ['Copy the phone numbers', 'फ़ोन नंबर कॉपी करें'], ['Share it with another partner', 'दूसरे पार्टनर को दें']], ['b'], 'No patient data, ever.', 'मरीज़ों का डेटा, कभी नहीं।'],
      ['single', 'Which law protects personal data in India?', 'भारत में निजी डेटा कौन-सा कानून सुरक्षित करता है?', [['The DPDP Act', 'DPDP कानून'], ['The Motor Vehicles Act', 'मोटर वाहन कानून'], ['No law', 'कोई कानून नहीं'], ['The Income Tax Act only', 'सिर्फ़ इनकम टैक्स कानून']], ['a'], 'Digital Personal Data Protection Act.', 'डिजिटल पर्सनल डेटा प्रोटेक्शन कानून।'],
      ['truefalse', 'You may tell a doctor that Sehatsandhi will send them patients if they buy a plan.', 'आप डॉक्टर को कह सकते हैं कि प्लान लेने पर सेहतसंधि उन्हें मरीज़ भेजेगा।', null, ['f'], 'Never link anything to patients.', 'किसी चीज़ को मरीज़ों से कभी न जोड़ें।'],
      ['single', 'What can you see about a business you introduced?', 'आपके जोड़े व्यवसाय के बारे में आप क्या देख सकते हैं?', [['Its patients\' records', 'उसके मरीज़ों के रिकॉर्ड'], ['Its name, city and whether it is paying', 'उसका नाम, शहर और भुगतान स्थिति'], ['Its bank balance', 'उसका बैंक बैलेंस'], ['Its staff salaries', 'उसके स्टाफ़ की सैलरी']], ['b'], 'Nothing else.', 'और कुछ नहीं।'],
      ['truefalse', 'You should add a doctor\'s number only if you are really talking to them.', 'डॉक्टर का नंबर तभी जोड़ें जब आप सच में उनसे बात कर रहे हों।', null, ['t'], 'And never share it.', 'और कभी साझा न करें।'],
    ],
  },
  {
    slug: 'communication-rules',
    en: {
      title: 'Communication rules',
      sections: [
        ['Only your own number', ['Talk to doctors from your own phone. Never use, ask for or pretend to be Sehatsandhi\'s official WhatsApp number.']],
        ['Only people who want to hear from you', ['Message or call only doctors who have agreed to talk to you. No bulk or repeated messages, no messaging groups of doctors, no messages at night.']],
        ['Respect "no"', ['If a doctor says no, or asks you to stop, stop. Doctors can block partners and report them to us.']],
        ['Online and social media', ['Share only material Sehatsandhi has published. Never post fake reviews, edited screenshots or anything that looks like an official Sehatsandhi account.']],
        ['When unsure', ['Ask us through a ticket before you send something you are not sure about.']],
      ],
    },
    hi: {
      title: 'बातचीत के नियम',
      sections: [
        ['सिर्फ़ अपना नंबर', ['डॉक्टरों से अपने फ़ोन से बात करें। सेहतसंधि का आधिकारिक WhatsApp नंबर कभी इस्तेमाल न करें, न माँगें, न उसके होने का दिखावा करें।']],
        ['सिर्फ़ उनसे जो बात करना चाहें', ['सिर्फ़ उन डॉक्टरों को मैसेज या कॉल करें जो आपसे बात करने को राज़ी हैं। कोई बल्क या बार-बार मैसेज नहीं, डॉक्टरों के ग्रुप में मैसेज नहीं, रात में मैसेज नहीं।']],
        ['"नहीं" का सम्मान', ['अगर डॉक्टर मना करें या रुकने को कहें, तो रुक जाएँ। डॉक्टर पार्टनर को ब्लॉक कर सकते हैं और हमें शिकायत कर सकते हैं।']],
        ['ऑनलाइन और सोशल मीडिया', ['सिर्फ़ वही सामग्री साझा करें जो सेहतसंधि ने प्रकाशित की है। कभी नकली रिव्यू, बदले हुए स्क्रीनशॉट या सेहतसंधि का आधिकारिक खाता जैसा दिखने वाला कुछ न डालें।']],
        ['पक्का न हो तो', ['कुछ भेजने से पहले, अगर पक्का न हो, तो टिकट से हमसे पूछें।']],
      ],
    },
    questions: [
      ['single', 'Which number do you use to talk to doctors?', 'डॉक्टरों से बात करने के लिए कौन-सा नंबर?', [['Sehatsandhi\'s official WhatsApp', 'सेहतसंधि का आधिकारिक WhatsApp'], ['Your own number', 'आपका अपना नंबर'], ['Any number you find', 'कोई भी नंबर'], ['The clinic\'s number', 'क्लिनिक का नंबर']], ['b'], 'Only your own.', 'सिर्फ़ अपना।'],
      ['truefalse', 'Sending the same message to hundreds of doctors is a good way to find businesses.', 'सैकड़ों डॉक्टरों को एक ही मैसेज भेजना व्यवसाय ढूँढने का अच्छा तरीका है।', null, ['f'], 'No bulk or repeated messages.', 'कोई बल्क या बार-बार मैसेज नहीं।'],
      ['single', 'A doctor asks you to stop messaging. You…', 'डॉक्टर मैसेज बंद करने को कहते हैं। आप…', [['Message from another number', 'दूसरे नंबर से मैसेज करें'], ['Stop', 'रुक जाएँ'], ['Ask a friend to message', 'दोस्त से मैसेज करवाएँ'], ['Send one more reminder', 'एक और रिमाइंडर भेजें']], ['b'], 'Respect "no".', '"नहीं" का सम्मान करें।'],
      ['multi', 'Which are allowed online? (choose all that are right)', 'ऑनलाइन क्या करने की अनुमति है? (सभी सही चुनें)', [['Sharing material Sehatsandhi published', 'सेहतसंधि की प्रकाशित सामग्री साझा करना'], ['Posting fake reviews', 'नकली रिव्यू डालना'], ['Making a page that looks official', 'आधिकारिक जैसा पेज बनाना'], ['Asking us when unsure', 'पक्का न होने पर हमसे पूछना']], ['a', 'd'], 'Only published material; ask when unsure.', 'सिर्फ़ प्रकाशित सामग्री; पक्का न हो तो पूछें।'],
      ['truefalse', 'Doctors can block a partner and report them.', 'डॉक्टर पार्टनर को ब्लॉक और शिकायत कर सकते हैं।', null, ['t'], 'Complaints are looked into.', 'शिकायतों की जाँच होती है।'],
      ['single', 'Is it fine to message doctors late at night?', 'क्या देर रात डॉक्टरों को मैसेज करना ठीक है?', [['Yes', 'हाँ'], ['No', 'नहीं'], ['Only on Sundays', 'सिर्फ़ रविवार'], ['Only if urgent for you', 'सिर्फ़ अगर आपके लिए ज़रूरी हो']], ['b'], 'No messages at night.', 'रात में मैसेज नहीं।'],
    ],
  },
  {
    slug: 'code-of-conduct',
    en: {
      title: 'Code of conduct, strikes and termination',
      sections: [
        ['What we expect', ['Honesty, respect for doctors\' time, following this training and the Partner Agreement.']],
        ['Strikes', ['First problem: a warning. Repeated problems: your Partner ID is paused. Serious or continued problems: the partnership ends.', 'Misrepresenting Sehatsandhi (false claims, fake approvals, taking money) means immediate suspension and losing rewards not yet paid.']],
        ['Complaints about you', ['If a business reports you, we look into it and may pause your ID while we do. You can explain your side through a ticket.']],
        ['Staying active', ['If you have no first paying business within 90 days of getting your ID, it is paused; a refresher quiz reactivates it.', 'Your Partner ID is valid for 12 months. Every year, from 30 days before it ends, you renew it in the app: pass a short refresher quiz, then pay the same fee, ₹100 + GST.', 'While it is expired you cannot reserve doctors and payments earn no reward. If it is not renewed within 30 days after it ends, your partnership ends. This keeps every Partner ID genuine.']],
        ['Ending the partnership', ['You may stop at any time by writing to us. Rewards already approved are paid as usual; nothing is earned after the partnership ends.']],
      ],
    },
    hi: {
      title: 'आचार संहिता, चेतावनी और समाप्ति',
      sections: [
        ['हम क्या उम्मीद करते हैं', ['ईमानदारी, डॉक्टरों के समय का सम्मान, यह ट्रेनिंग और पार्टनर एग्रीमेंट मानना।']],
        ['चेतावनियाँ', ['पहली समस्या: चेतावनी। बार-बार समस्या: आपका Partner ID रोका जाता है। गंभीर या लगातार समस्या: साझेदारी समाप्त।', 'सेहतसंधि के बारे में गलत जानकारी (झूठे दावे, नकली मंज़ूरी, पैसे लेना) पर तुरंत निलंबन और बकाया रिवॉर्ड खत्म।']],
        ['आपके बारे में शिकायत', ['अगर कोई व्यवसाय आपकी शिकायत करता है, तो हम जाँच करते हैं और तब तक आपका ID रोक सकते हैं। आप टिकट से अपनी बात रख सकते हैं।']],
        ['सक्रिय रहना', ['ID मिलने के 90 दिन में पहला भुगतान करने वाला व्यवसाय न हो, तो ID रोका जाता है; रिफ़्रेशर क्विज़ से फिर चालू होता है।', 'आपका Partner ID 12 महीने वैध है। हर साल, खत्म होने से 30 दिन पहले से, आप ऐप में इसे रिन्यू करते हैं: छोटा रिफ़्रेशर क्विज़ पास करें, फिर वही फ़ीस, ₹100 + GST, दें।', 'खत्म रहने के दौरान आप डॉक्टर रिज़र्व नहीं कर सकते और भुगतानों पर रिवॉर्ड नहीं मिलता। खत्म होने के 30 दिन में रिन्यू न होने पर साझेदारी समाप्त हो जाती है। इससे हर Partner ID असली रहता है।']],
        ['साझेदारी खत्म करना', ['आप कभी भी हमें लिखकर रुक सकते हैं। पहले से मंज़ूर रिवॉर्ड सामान्य रूप से मिलते हैं; साझेदारी खत्म होने के बाद कुछ नहीं मिलता।']],
      ],
    },
    questions: [
      ['single', 'What usually happens at the first problem?', 'पहली समस्या पर आम तौर पर क्या होता है?', [['A warning', 'चेतावनी'], ['Immediate termination', 'तुरंत समाप्ति'], ['A fine', 'जुर्माना'], ['Nothing', 'कुछ नहीं']], ['a'], 'Warning → pause → termination.', 'चेतावनी → रोक → समाप्ति।'],
      ['truefalse', 'Taking money from a doctor can lead to immediate suspension.', 'डॉक्टर से पैसे लेने पर तुरंत निलंबन हो सकता है।', null, ['t'], 'And unpaid rewards are lost.', 'और बकाया रिवॉर्ड खत्म।'],
      ['single', 'How long is a Partner ID valid?', 'Partner ID कितने समय वैध है?', [['1 month', '1 महीना'], ['12 months', '12 महीने'], ['5 years', '5 साल'], ['Forever', 'हमेशा']], ['b'], 'Renew every year with a refresher quiz and ₹100 + GST.', 'हर साल रिफ़्रेशर क्विज़ और ₹100 + GST से रिन्यू करें।'],
      ['single', 'Your Partner ID ended 40 days ago and you did not renew. What has happened?', 'आपका Partner ID 40 दिन पहले खत्म हुआ और आपने रिन्यू नहीं किया। क्या हुआ है?', [['Nothing — it renews by itself', 'कुछ नहीं — अपने-आप रिन्यू होता है'], ['Your partnership has ended', 'आपकी साझेदारी समाप्त हो गई है'], ['You get a free extra year', 'आपको एक साल मुफ़्त मिलता है'], ['Your rewards double', 'आपके रिवॉर्ड दोगुने होते हैं']], ['b'], 'Renew within 30 days after expiry, or the partnership ends.', 'खत्म होने के 30 दिन में रिन्यू करें, नहीं तो साझेदारी समाप्त।'],
      ['single', 'A business reports you. What can you do?', 'कोई व्यवसाय आपकी शिकायत करता है। आप क्या कर सकते हैं?', [['Threaten the business', 'व्यवसाय को धमकाएँ'], ['Explain your side through a ticket', 'टिकट से अपनी बात रखें'], ['Create a new account', 'नया खाता बनाएँ'], ['Nothing', 'कुछ नहीं']], ['b'], 'We look into every report.', 'हम हर शिकायत की जाँच करते हैं।'],
      ['truefalse', 'You can stop being a partner at any time.', 'आप कभी भी पार्टनर बनना बंद कर सकते हैं।', null, ['t'], 'Approved rewards are still paid.', 'मंज़ूर रिवॉर्ड फिर भी मिलते हैं।'],
      ['single', 'No first paying business within 90 days of your ID. Then…', 'ID मिलने के 90 दिन में कोई भुगतान करने वाला व्यवसाय नहीं। तब…', [['Your ID is paused; a refresher quiz reactivates it', 'ID रोका जाता है; रिफ़्रेशर क्विज़ से फिर चालू'], ['You pay a fine', 'जुर्माना देना होगा'], ['Nothing happens', 'कुछ नहीं होता'], ['You must take the whole course again', 'पूरा कोर्स दोबारा करना होगा']], ['a'], 'A short refresher quiz.', 'एक छोटा रिफ़्रेशर क्विज़।'],
    ],
  },
]
