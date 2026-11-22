// Care Partner Program — contracts and policies. DRAFT for the lawyer (and the
// CA for the Rewards Policy and Fee terms) — NOT legal advice, not final.
// Written 22 Nov 2026 from the programme brief and what the platform does.
// Build PDFs / load sandbox: node scripts/partner-training.mjs [--sandbox]
//
// [LAWYER: …] marks a point the lawyer must decide. The English version
// prevails over the Hindi translation.

export const CONTRACT_VERSION = 'draft-1'
export const CONTRACT_DATE = '22 Nov 2026'

const CO_EN = 'NG Technologies, 1743/C Vishnu Garden, Opp. Civil Hospital, Jagadhri, Haryana 135003, operating Sehatsandhi'
const CO_HI = 'NG Technologies, 1743/C विष्णु गार्डन, सिविल अस्पताल के सामने, जगाधरी, हरियाणा 135003, जो सेहतसंधि चलाती है'

export const CONTRACTS = [
  {
    kind: 'partner_agreement',
    en: {
      title: 'Care Partner Agreement',
      sections: [
        ['1. The parties', [`This Agreement is between ${CO_EN} ("Sehatsandhi", "we") and the person who accepts it in the Partner app ("Partner", "you").`]],
        ['2. What this Agreement is', ['You are appointed, on a non-exclusive basis, to introduce Sehatsandhi\'s software plans to clinics, hospitals, laboratories, diagnostic centres and pharmacies in India ("Businesses").', 'You are an independent contractor. Nothing here makes you an employee, agent, partner in law or representative of Sehatsandhi. You decide your own hours and methods within this Agreement, and you bear your own costs.']],
        ['3. Who may be a Partner', ['You confirm that you are 18 or older; that you are not a registered medical practitioner; that you will not receive rewards for any business you own, work in or are related to; and that this work does not breach your employer\'s rules or any agreement you have signed.', 'One person may hold only one Partner account, with their own mobile number, PAN and bank account.']],
        ['4. What you may and may not do', ['You may describe Sehatsandhi only as the training and our published material describe it.', 'You have no authority to make promises, offer prices, discounts or terms, or sign anything for Sehatsandhi.', 'You must never collect any money from a Business or anyone else. Businesses pay Sehatsandhi directly.', 'You must follow the Code of Conduct, which forms part of this Agreement.']],
        ['5. Partner ID, badge and validity', ['On paying the Certification Fee you receive a Partner ID and a badge. They are valid for 12 months.', 'You renew them every year in the Partner app, from 30 days before they end, by passing a refresher quiz and paying the renewal fee set out in the Certification Fee terms. The yearly renewal keeps every Partner ID current and genuine.', 'The badge and the public verification page show your name, city and status. You may use the Sehatsandhi name and badge only to introduce Sehatsandhi, and only while your Partner ID is active.']],
        ['6. Partner Rewards', ['Your only compensation is Partner Rewards, as set out in the Rewards Policy, which forms part of this Agreement. No reward is paid on the Certification Fee or for introducing other Partners, and there are no levels of Partners above Partners.', 'Sehatsandhi does not promise or guarantee any income.']],
        ['7. Payouts, tax and records', ['Payouts are made monthly to your own verified bank account after your PAN and bank details are verified. Tax is deducted at source where the law requires, and a statement is given for each payout.', 'If a payment on which a reward was paid is refunded, the reward is recovered from your later rewards.']],
        ['8. Confidentiality and data', ['You must keep confidential anything you learn about Sehatsandhi or a Business that is not public.', 'You must never collect, see, store or share patient information. You may hold a doctor\'s contact details only to talk to that doctor about Sehatsandhi.', 'How we handle your personal data is described in the Privacy Notice for Partners.']],
        ['9. Term, suspension and termination', ['This Agreement starts when you accept it and continues while your Partner ID is valid.', 'While your Partner ID has expired you may not introduce Sehatsandhi, and no reward is earned on payments made in that time. If it is not renewed within 30 days after it ends, this Agreement ends automatically.', 'You may end it at any time by writing to us. We may end it on 15 days\' notice for any reason, or immediately for a breach of this Agreement or the Code of Conduct.', 'We may pause or suspend your Partner ID while we look into a complaint.', 'On ending: rewards already approved are paid as usual, except that rewards not yet paid are forfeited where the Agreement ends because of misrepresentation, fraud, taking money or a serious breach. Nothing is earned after the Agreement ends.']],
        ['10. Liability', ['Each party is responsible for its own acts. Sehatsandhi is not liable for indirect or consequential losses, and its total liability to you under this Agreement is limited to the rewards approved and unpaid at the time of the claim. [LAWYER: review the cap.]', 'You will make good any loss Sehatsandhi suffers because you broke this Agreement, the Code of Conduct or the law.']],
        ['11. Changes', ['We may change this Agreement or the policies that form part of it. A new version is shown in the app and must be accepted before further payouts. Rate changes apply only to rewards that start after the change.']],
        ['12. Notices and acceptance', ['Notices to you are sent through the Partner app or to your registered email. Notices to us: contact@sehatsandhi.com.', 'You accept this Agreement electronically in the app, confirmed by a one-time code sent to your registered mobile number. That acceptance is binding under the Information Technology Act, 2000.']],
        ['13. Law and disputes', ['This Agreement is governed by the laws of India. The parties will first try to settle any dispute by discussion within 30 days; failing that, the courts at Yamunanagar, Haryana have jurisdiction. [LAWYER: confirm jurisdiction or arbitration.]']],
        ['14. Whole agreement and language', ['This Agreement, the Code of Conduct, the Rewards Policy, the Privacy Notice for Partners and the Certification Fee terms are the whole agreement between the parties. If the Hindi translation differs from the English, the English prevails.']],
      ],
    },
    hi: {
      title: 'केयर पार्टनर एग्रीमेंट',
      sections: [
        ['1. पक्ष', [`यह एग्रीमेंट ${CO_HI} ("सेहतसंधि", "हम") और पार्टनर ऐप में इसे स्वीकार करने वाले व्यक्ति ("पार्टनर", "आप") के बीच है।`]],
        ['2. यह एग्रीमेंट क्या है', ['आपको भारत में क्लिनिक, अस्पताल, लैब, डायग्नोस्टिक सेंटर और फ़ार्मेसी ("व्यवसाय") को सेहतसंधि के सॉफ़्टवेयर प्लान के बारे में बताने के लिए, गैर-विशेष (non-exclusive) आधार पर नियुक्त किया जाता है।', 'आप एक स्वतंत्र कॉन्ट्रैक्टर हैं। इससे आप सेहतसंधि के कर्मचारी, एजेंट, कानूनी साझेदार या प्रतिनिधि नहीं बनते। इस एग्रीमेंट के अंदर आप अपना समय और तरीका खुद तय करते हैं, और अपना खर्च खुद उठाते हैं।']],
        ['3. कौन पार्टनर बन सकता है', ['आप पुष्टि करते हैं कि आपकी उम्र 18 साल या ज़्यादा है; आप रजिस्टर्ड मेडिकल प्रैक्टिशनर नहीं हैं; आप किसी ऐसे व्यवसाय पर रिवॉर्ड नहीं लेंगे जिसके आप मालिक हैं, जहाँ काम करते हैं या जिससे आपका रिश्ता है; और यह काम आपके नियोक्ता के नियमों या आपके किसी समझौते का उल्लंघन नहीं करता।', 'एक व्यक्ति का सिर्फ़ एक पार्टनर खाता हो सकता है, अपने मोबाइल नंबर, PAN और बैंक खाते के साथ।']],
        ['4. आप क्या कर सकते हैं और क्या नहीं', ['आप सेहतसंधि का वर्णन सिर्फ़ वैसे कर सकते हैं जैसे ट्रेनिंग और हमारी प्रकाशित सामग्री में है।', 'आपको सेहतसंधि की तरफ़ से कोई वादा करने, कीमत, छूट या शर्तें देने, या कुछ भी साइन करने का अधिकार नहीं है।', 'आप कभी किसी व्यवसाय या किसी और से पैसे नहीं लेंगे। व्यवसाय सीधे सेहतसंधि को भुगतान करते हैं।', 'आपको आचार संहिता माननी होगी, जो इस एग्रीमेंट का हिस्सा है।']],
        ['5. Partner ID, बैज और वैधता', ['सर्टिफ़िकेशन फ़ीस देने पर आपको Partner ID और बैज मिलता है। ये 12 महीने वैध हैं।', 'आप इन्हें हर साल पार्टनर ऐप में, खत्म होने से 30 दिन पहले से, रिफ़्रेशर क्विज़ पास करके और सर्टिफ़िकेशन फ़ीस की शर्तों में लिखी रिन्यूअल फ़ीस देकर रिन्यू करते हैं। सालाना रिन्यूअल से हर Partner ID सही और असली रहता है।', 'बैज और सार्वजनिक जाँच पेज आपका नाम, शहर और स्थिति दिखाते हैं। आप सेहतसंधि का नाम और बैज सिर्फ़ सेहतसंधि के परिचय के लिए, और सिर्फ़ Partner ID सक्रिय रहने तक इस्तेमाल कर सकते हैं।']],
        ['6. पार्टनर रिवॉर्ड', ['आपका एकमात्र भुगतान पार्टनर रिवॉर्ड है, जैसा रिवॉर्ड नीति में लिखा है, जो इस एग्रीमेंट का हिस्सा है। सर्टिफ़िकेशन फ़ीस पर या दूसरे पार्टनर जोड़ने पर कोई रिवॉर्ड नहीं, और पार्टनर के ऊपर पार्टनर के कोई लेवल नहीं।', 'सेहतसंधि किसी कमाई का वादा या गारंटी नहीं देता।']],
        ['7. पेआउट, टैक्स और रिकॉर्ड', ['PAN और बैंक विवरण जाँचे जाने के बाद पेआउट हर महीने आपके अपने बैंक खाते में होते हैं। जहाँ कानून कहता है, स्रोत पर टैक्स काटा जाता है, और हर पेआउट का स्टेटमेंट दिया जाता है।', 'अगर किसी भुगतान पर रिवॉर्ड दिया गया और वह भुगतान रिफ़ंड होता है, तो वह रिवॉर्ड आपके आगे के रिवॉर्ड से वसूला जाता है।']],
        ['8. गोपनीयता और डेटा', ['सेहतसंधि या किसी व्यवसाय के बारे में जो सार्वजनिक नहीं है, उसे आप गोपनीय रखेंगे।', 'आप कभी मरीज़ों की जानकारी न लेंगे, न देखेंगे, न रखेंगे, न साझा करेंगे। किसी डॉक्टर का संपर्क आप सिर्फ़ उसी डॉक्टर से सेहतसंधि के बारे में बात करने के लिए रख सकते हैं।', 'हम आपका निजी डेटा कैसे संभालते हैं, यह पार्टनर प्राइवेसी नोटिस में है।']],
        ['9. अवधि, निलंबन और समाप्ति', ['यह एग्रीमेंट स्वीकार करने पर शुरू होता है और Partner ID वैध रहने तक चलता है।', 'Partner ID खत्म रहने के दौरान आप सेहतसंधि का परिचय नहीं दे सकते, और उस समय के भुगतानों पर कोई रिवॉर्ड नहीं मिलता। खत्म होने के 30 दिन में रिन्यू न होने पर यह एग्रीमेंट अपने-आप समाप्त हो जाता है।', 'आप कभी भी हमें लिखकर इसे खत्म कर सकते हैं। हम किसी भी कारण से 15 दिन के नोटिस पर, या एग्रीमेंट या आचार संहिता के उल्लंघन पर तुरंत, इसे खत्म कर सकते हैं।', 'शिकायत की जाँच के दौरान हम आपका Partner ID रोक या निलंबित कर सकते हैं।', 'समाप्ति पर: पहले से मंज़ूर रिवॉर्ड सामान्य रूप से मिलते हैं, सिवाय इसके कि गलत जानकारी, धोखाधड़ी, पैसे लेने या गंभीर उल्लंघन से समाप्ति होने पर बकाया रिवॉर्ड नहीं मिलते। समाप्ति के बाद कुछ अर्जित नहीं होता।']],
        ['10. ज़िम्मेदारी', ['हर पक्ष अपने कामों के लिए ज़िम्मेदार है। सेहतसंधि अप्रत्यक्ष नुकसान के लिए ज़िम्मेदार नहीं है, और इस एग्रीमेंट के तहत आपके प्रति उसकी कुल ज़िम्मेदारी दावे के समय मंज़ूर पर बकाया रिवॉर्ड तक सीमित है। [वकील: सीमा जाँचें।]', 'आपके एग्रीमेंट, आचार संहिता या कानून तोड़ने से सेहतसंधि को हुआ नुकसान आप भरेंगे।']],
        ['11. बदलाव', ['हम यह एग्रीमेंट या इसकी नीतियाँ बदल सकते हैं। नया संस्करण ऐप में दिखेगा और आगे के पेआउट से पहले स्वीकार करना होगा। दरों में बदलाव सिर्फ़ बदलाव के बाद शुरू होने वाले रिवॉर्ड पर लागू होते हैं।']],
        ['12. सूचना और स्वीकृति', ['आपको सूचनाएँ पार्टनर ऐप या आपके रजिस्टर्ड ईमेल पर भेजी जाती हैं। हमें सूचना: contact@sehatsandhi.com।', 'आप यह एग्रीमेंट ऐप में इलेक्ट्रॉनिक रूप से स्वीकार करते हैं, आपके रजिस्टर्ड मोबाइल नंबर पर भेजे गए कोड से पुष्टि के साथ। यह स्वीकृति सूचना प्रौद्योगिकी अधिनियम, 2000 के तहत बाध्यकारी है।']],
        ['13. कानून और विवाद', ['यह एग्रीमेंट भारत के कानूनों के अधीन है। पक्ष किसी भी विवाद को पहले 30 दिन में बातचीत से सुलझाने की कोशिश करेंगे; न होने पर यमुनानगर, हरियाणा की अदालतों का अधिकार क्षेत्र होगा। [वकील: अधिकार क्षेत्र या मध्यस्थता की पुष्टि करें।]']],
        ['14. पूरा समझौता और भाषा', ['यह एग्रीमेंट, आचार संहिता, रिवॉर्ड नीति, पार्टनर प्राइवेसी नोटिस और सर्टिफ़िकेशन फ़ीस की शर्तें — यही पक्षों के बीच पूरा समझौता है। हिंदी अनुवाद और अंग्रेज़ी में अंतर होने पर अंग्रेज़ी मान्य होगी।']],
      ],
    },
  },
  {
    kind: 'code_of_conduct',
    en: {
      title: 'Code of Conduct for Care Partners',
      sections: [
        ['1. Honesty', ['Describe Sehatsandhi only as the training and published material do. If unsure, say you will find out.', 'Never claim government, ABDM or any other approval. Never promise patients, income, results or anything Sehatsandhi has not published.']],
        ['2. Money', ['Never take cash or any payment, gift or favour from a Business in connection with Sehatsandhi. Businesses pay Sehatsandhi directly.', 'Never offer discounts, free periods or gifts that are not official Sehatsandhi offers.']],
        ['3. Patients and medical ethics', ['Never collect, see, photograph or share patient information.', 'Never link anything to patient referrals, patient numbers or prescribing. Respect the doctor\'s professional obligations under the National Medical Commission\'s rules.']],
        ['4. Communication', ['Use only your own phone number. Never use or imitate Sehatsandhi\'s official WhatsApp number or accounts.', 'Contact only people who agree to hear from you. No bulk, repeated or night-time messages, no messages to groups of doctors.', 'Respect "no" and requests to stop.']],
        ['5. Identity and accounts', ['Show your badge when you introduce Sehatsandhi. Never sign up a Business yourself or use anyone\'s login. One person, one Partner account.']],
        ['6. Online', ['Share only material Sehatsandhi has published. No fake reviews, edited screenshots or pages that look official.']],
        ['7. What happens if this Code is broken', ['First breach: a warning. Repeated breaches: your Partner ID is paused. Serious or continued breaches: the partnership ends.', 'Misrepresentation, taking money, fraud or misuse of data: immediate suspension, and rewards not yet paid are forfeited.', 'You may explain your side through a ticket before a final decision.']],
      ],
    },
    hi: {
      title: 'केयर पार्टनर के लिए आचार संहिता',
      sections: [
        ['1. ईमानदारी', ['सेहतसंधि का वर्णन सिर्फ़ ट्रेनिंग और प्रकाशित सामग्री जैसा करें। पक्का न हो तो कहें कि आप पता करेंगे।', 'कभी सरकार, ABDM या किसी और मंज़ूरी का दावा न करें। कभी मरीज़, कमाई, नतीजे या ऐसी किसी चीज़ का वादा न करें जो सेहतसंधि ने प्रकाशित नहीं की।']],
        ['2. पैसा', ['सेहतसंधि के सिलसिले में किसी व्यवसाय से कभी नकद, भुगतान, तोहफ़ा या एहसान न लें। व्यवसाय सीधे सेहतसंधि को भुगतान करते हैं।', 'ऐसी छूट, मुफ़्त अवधि या तोहफ़े कभी न दें जो सेहतसंधि के आधिकारिक ऑफ़र नहीं हैं।']],
        ['3. मरीज़ और मेडिकल नैतिकता', ['मरीज़ों की जानकारी कभी न लें, न देखें, न फ़ोटो लें, न साझा करें।', 'किसी चीज़ को मरीज़ भेजने, मरीज़ों की संख्या या इलाज लिखने से कभी न जोड़ें। राष्ट्रीय चिकित्सा आयोग के नियमों के तहत डॉक्टर के पेशेवर दायित्वों का सम्मान करें।']],
        ['4. बातचीत', ['सिर्फ़ अपना फ़ोन नंबर इस्तेमाल करें। सेहतसंधि का आधिकारिक WhatsApp नंबर या खाते कभी इस्तेमाल न करें, न उनकी नकल करें।', 'सिर्फ़ उनसे संपर्क करें जो आपसे बात करने को राज़ी हैं। कोई बल्क, बार-बार या रात का मैसेज नहीं, डॉक्टरों के ग्रुप में मैसेज नहीं।', '"नहीं" और रुकने के अनुरोध का सम्मान करें।']],
        ['5. पहचान और खाते', ['सेहतसंधि का परिचय देते समय अपना बैज दिखाएँ। किसी व्यवसाय का साइन अप खुद न करें, न किसी का लॉगिन इस्तेमाल करें। एक व्यक्ति, एक पार्टनर खाता।']],
        ['6. ऑनलाइन', ['सिर्फ़ सेहतसंधि की प्रकाशित सामग्री साझा करें। नकली रिव्यू, बदले स्क्रीनशॉट या आधिकारिक जैसे पेज नहीं।']],
        ['7. इस संहिता के उल्लंघन पर', ['पहला उल्लंघन: चेतावनी। बार-बार: आपका Partner ID रोका जाता है। गंभीर या लगातार: साझेदारी समाप्त।', 'गलत जानकारी, पैसे लेना, धोखाधड़ी या डेटा का दुरुपयोग: तुरंत निलंबन, और बकाया रिवॉर्ड नहीं मिलते।', 'अंतिम फ़ैसले से पहले आप टिकट से अपनी बात रख सकते हैं।']],
      ],
    },
  },
  {
    kind: 'reward_policy',
    en: {
      title: 'Partner Rewards Policy',
      sections: [
        ['1. What earns a reward', ['A payment by a Business you introduced, for a 12-month term of a Sehatsandhi plan or add-on (including add-ons bought during a 12-month term).', '"Introduced" means the Business confirmed you in the app (it answered Yes, or typed your Partner ID before its first payment), or a claim you raised within 7 days of its first payment was confirmed by the Business.', 'The reward is worked out on the amount paid before GST and after any coupon.']],
        ['2. What never earns a reward', ['Payments for shorter terms, including the 1-month paid trial (the reward starts when the Business takes a 12-month term); WhatsApp wallet top-ups, usage credits and third-party charges; your own Certification Fee; introducing other Partners; any Business you own, work in or are related to.']],
        ['3. Rates (at the time of writing)', ['Start Reward — on eligible payments in the first 12 months after the Business confirms you: Associate 15%, Senior 20%, Elite 25%. Total Start Rewards per Business are capped at ₹15,000.', 'Renewal Reward — on eligible payments after that: 10%, while the Business keeps renewing and you remain active. A gap of more than 60 days after a term ends ends the renewal chain.', 'Level depends on the number of active Businesses you introduced: Senior from 10, Elite from 30. A level change affects only new Start Rewards.']],
        ['4. Approval and payout', ['A reward is pending until 15 days after the payment, then approved if the payment has not been refunded.', 'Payouts are monthly. A payment made on or before the 15th of a month is in that month\'s payout; a payment after the 15th is in the next month\'s.', 'A payout is made when your approved total is at least ₹500, your PAN and bank details are verified and you have accepted the current Agreement; otherwise it carries forward.']],
        ['5. Tax', ['Tax is deducted at source under the Income-tax Act where it applies (at the time of writing: section 194H), and shown on your statement. [CA: confirm rate, threshold and section.]']],
        ['6. Refunds and corrections', ['If a payment is refunded before its reward is approved, the reward is reduced or cancelled. If it is refunded after, the reward is recovered from your later rewards.', 'Rewards obtained by breaking the Agreement or the Code of Conduct are not payable and may be recovered.']],
        ['7. Changes and no promise', ['Rates, caps, periods and amounts may change; changes apply only to rewards that start after the change, and are shown in the app first.', 'Sehatsandhi does not promise or guarantee any reward or income.']],
      ],
    },
    hi: {
      title: 'पार्टनर रिवॉर्ड नीति',
      sections: [
        ['1. किस पर रिवॉर्ड मिलता है', ['आपके जोड़े व्यवसाय का, सेहतसंधि प्लान या ऐड-ऑन के 12 महीने की अवधि के लिए भुगतान (12 महीने की अवधि में खरीदे ऐड-ऑन सहित)।', '"जोड़ा" का मतलब: व्यवसाय ने ऐप में आपकी पुष्टि की (हाँ कहा, या पहले भुगतान से पहले आपका Partner ID लिखा), या पहले भुगतान के 7 दिन में आपका क्लेम व्यवसाय ने पुष्ट किया।', 'रिवॉर्ड GST से पहले और कूपन के बाद की राशि पर गिना जाता है।']],
        ['2. किस पर कभी रिवॉर्ड नहीं', ['छोटी अवधि के भुगतान, 1 महीने के पेड ट्रायल सहित (रिवॉर्ड तब शुरू होता है जब व्यवसाय 12 महीने की अवधि लेता है); WhatsApp वॉलेट टॉप-अप, उपयोग क्रेडिट और तीसरे पक्ष के शुल्क; आपकी अपनी सर्टिफ़िकेशन फ़ीस; दूसरे पार्टनर जोड़ना; ऐसा कोई व्यवसाय जिसके आप मालिक हैं, जहाँ काम करते हैं या जिससे आपका रिश्ता है।']],
        ['3. दरें (लिखते समय)', ['स्टार्ट रिवॉर्ड — व्यवसाय की पुष्टि के बाद पहले 12 महीनों के योग्य भुगतानों पर: एसोसिएट 15%, सीनियर 20%, एलीट 25%। प्रति व्यवसाय कुल स्टार्ट रिवॉर्ड ₹15,000 तक।', 'रिन्यूअल रिवॉर्ड — उसके बाद के योग्य भुगतानों पर: 10%, जब तक व्यवसाय रिन्यू करता रहे और आप सक्रिय रहें। अवधि खत्म होने के बाद 60 दिन से ज़्यादा का अंतर रिन्यूअल सिलसिला खत्म करता है।', 'लेवल आपके जोड़े सक्रिय व्यवसायों की संख्या पर निर्भर है: 10 से सीनियर, 30 से एलीट। लेवल बदलाव सिर्फ़ नए स्टार्ट रिवॉर्ड पर लागू।']],
        ['4. मंज़ूरी और पेआउट', ['भुगतान के 15 दिन बाद तक रिवॉर्ड पेंडिंग रहता है, फिर अगर भुगतान रिफ़ंड नहीं हुआ तो मंज़ूर।', 'पेआउट हर महीने। किसी महीने की 15 तारीख तक का भुगतान उसी महीने के पेआउट में; 15 के बाद का भुगतान अगले महीने के पेआउट में।', 'पेआउट तब होता है जब आपका मंज़ूर कुल कम से कम ₹500 हो, PAN और बैंक विवरण जाँचे जा चुके हों और आपने मौजूदा एग्रीमेंट स्वीकार किया हो; नहीं तो आगे जुड़ता है।']],
        ['5. टैक्स', ['जहाँ लागू हो, आयकर अधिनियम के तहत स्रोत पर टैक्स काटा जाता है (लिखते समय: धारा 194H), और स्टेटमेंट में दिखता है। [CA: दर, सीमा और धारा की पुष्टि करें।]']],
        ['6. रिफ़ंड और सुधार', ['अगर रिवॉर्ड मंज़ूर होने से पहले भुगतान रिफ़ंड होता है, तो रिवॉर्ड घटता या रद्द होता है। बाद में रिफ़ंड होने पर रिवॉर्ड आपके आगे के रिवॉर्ड से वसूला जाता है।', 'एग्रीमेंट या आचार संहिता तोड़कर पाए रिवॉर्ड देय नहीं हैं और वसूले जा सकते हैं।']],
        ['7. बदलाव और कोई वादा नहीं', ['दरें, सीमाएँ, अवधियाँ और राशियाँ बदल सकती हैं; बदलाव सिर्फ़ बाद में शुरू होने वाले रिवॉर्ड पर लागू होते हैं, और पहले ऐप में दिखाए जाते हैं।', 'सेहतसंधि किसी रिवॉर्ड या कमाई का वादा या गारंटी नहीं देता।']],
      ],
    },
  },
  {
    kind: 'privacy_notice',
    en: {
      title: 'Privacy Notice for Care Partners',
      sections: [
        ['1. Who we are', [`${CO_EN} is the Data Fiduciary for your personal data under the Digital Personal Data Protection Act, 2023.`]],
        ['2. What we collect, and why', ['Your mobile number, name, date of birth, city, state, language, email and optional occupation, and your eligibility declarations — to register you and run your partnership.', 'Your training progress, quiz answers and results — to certify you.', 'Your payments to us and invoices — for accounts and tax.', 'Your PAN and bank details — only to pay you and deduct tax. They are kept encrypted; only the last four characters are shown, and only authorised finance staff can see them in full, with every access recorded.', 'Doctors you reserve: their name and a one-way coded form of their number, only while the reservation lasts.', 'Tickets and messages you send us — to help you.']],
        ['3. What we never collect', ['Your Aadhaar number, and any patient information.']],
        ['4. Who we share it with', ['Our payment processor (Razorpay), our email and messaging providers, and banks — only as needed to do the above; tax authorities and others where the law requires.', 'A Business you introduced sees your first name, city and Partner ID. Anyone can see your name, city and status on your public verification page.']],
        ['5. How long we keep it', ['While you are a Partner, and afterwards only as long as the law requires (financial and tax records for the legally required period). Doctor reservation details are deleted when the reservation ends.']],
        ['6. Your rights', ['You can see the data we hold about you, ask us to correct it, withdraw your consent and ask us to erase it (we keep only what the law requires), and nominate someone to exercise these rights.', 'Write to our Grievance Officer at contact@sehatsandhi.com. We acknowledge within 24 hours and resolve within 15 days. If you are not satisfied, you may complain to the Data Protection Board of India.']],
        ['7. Consent', ['By registering you consent to this processing. Withdrawing consent ends your partnership; rewards already approved are still paid.']],
      ],
    },
    hi: {
      title: 'केयर पार्टनर के लिए प्राइवेसी नोटिस',
      sections: [
        ['1. हम कौन हैं', [`डिजिटल पर्सनल डेटा प्रोटेक्शन अधिनियम, 2023 के तहत आपके निजी डेटा के लिए ${CO_HI} डेटा फ़िड्यूशियरी है।`]],
        ['2. हम क्या लेते हैं, और क्यों', ['आपका मोबाइल नंबर, नाम, जन्म तिथि, शहर, राज्य, भाषा, ईमेल और वैकल्पिक व्यवसाय, और आपकी पात्रता घोषणाएँ — आपको रजिस्टर करने और साझेदारी चलाने के लिए।', 'आपकी ट्रेनिंग प्रगति, क्विज़ जवाब और नतीजे — आपको सर्टिफ़ाई करने के लिए।', 'हमें आपके भुगतान और इनवॉइस — हिसाब और टैक्स के लिए।', 'आपका PAN और बैंक विवरण — सिर्फ़ आपको भुगतान करने और टैक्स काटने के लिए। ये एन्क्रिप्ट रखे जाते हैं; सिर्फ़ आख़िरी चार अक्षर दिखते हैं, और पूरा सिर्फ़ अधिकृत वित्त कर्मचारी देख सकते हैं, हर बार रिकॉर्ड के साथ।', 'आपके रिज़र्व किए डॉक्टर: उनका नाम और उनके नंबर का एक-तरफ़ा कोडेड रूप, सिर्फ़ रिज़र्वेशन रहने तक।', 'आपके टिकट और मैसेज — आपकी मदद के लिए।']],
        ['3. हम कभी क्या नहीं लेते', ['आपका आधार नंबर, और मरीज़ों की कोई जानकारी।']],
        ['4. हम किसके साथ साझा करते हैं', ['हमारा भुगतान प्रोसेसर (Razorpay), हमारे ईमेल और मैसेजिंग प्रदाता, और बैंक — सिर्फ़ ऊपर के कामों के लिए ज़रूरी हद तक; कानून के अनुसार टैक्स अधिकारी और अन्य।', 'आपका जोड़ा व्यवसाय आपका पहला नाम, शहर और Partner ID देखता है। आपके सार्वजनिक जाँच पेज पर कोई भी आपका नाम, शहर और स्थिति देख सकता है।']],
        ['5. हम कितने समय तक रखते हैं', ['जब तक आप पार्टनर हैं, और उसके बाद सिर्फ़ जितना कानून कहे (वित्तीय और टैक्स रिकॉर्ड कानूनी अवधि तक)। डॉक्टर रिज़र्वेशन का विवरण रिज़र्वेशन खत्म होने पर हटा दिया जाता है।']],
        ['6. आपके अधिकार', ['आप अपने बारे में हमारा डेटा देख सकते हैं, सुधार करवा सकते हैं, सहमति वापस ले सकते हैं और हटाने को कह सकते हैं (हम सिर्फ़ कानूनी रूप से ज़रूरी रखते हैं), और इन अधिकारों के लिए किसी को नामित कर सकते हैं।', 'हमारे शिकायत अधिकारी को contact@sehatsandhi.com पर लिखें। हम 24 घंटे में पावती देते हैं और 15 दिन में निपटाते हैं। संतुष्ट न हों तो आप भारत के डेटा संरक्षण बोर्ड में शिकायत कर सकते हैं।']],
        ['7. सहमति', ['रजिस्टर करके आप इस प्रोसेसिंग के लिए सहमति देते हैं। सहमति वापस लेने से साझेदारी खत्म होती है; पहले से मंज़ूर रिवॉर्ड फिर भी मिलते हैं।']],
      ],
    },
  },
  {
    kind: 'fee_terms',
    en: {
      title: 'Partner Certification Fee — terms',
      sections: [
        ['1. The fee', ['₹100 plus GST (₹118 in all at 18%), paid online after you pass the final exam. A GST tax invoice is issued. Training and the exam are free.']],
        ['2. What it pays for', ['The assessment, your Partner ID and badge, your public verification page, and access to the Partner app and support for the 12-month validity of your Partner ID.']],
        ['3. What it is not', ['It is not a deposit, an investment or a joining fee for a scheme. No reward is ever paid on it, to you or anyone else. Paying it does not promise you any income.']],
        ['4. Refunds', ['The fee is not refundable once your Partner ID has been issued.', 'If you paid and your Partner ID was not issued, write to us within 7 days through a ticket or contact@sehatsandhi.com and the fee is refunded in full.']],
        ['5. Yearly renewal', ['Your Partner ID is valid for 12 months. To keep it, renew it every year: from 30 days before it ends, pass a refresher quiz in the app and pay the renewal fee of ₹100 plus GST. Your Partner ID stays the same and runs 12 more months; a GST invoice is issued. Nothing is charged automatically.', 'If it is not renewed within 30 days after it ends, your partnership ends. The renewal fee is not refundable once the renewal is done.']],
      ],
    },
    hi: {
      title: 'पार्टनर सर्टिफ़िकेशन फ़ीस — शर्तें',
      sections: [
        ['1. फ़ीस', ['₹100 + GST (18% पर कुल ₹118), फ़ाइनल परीक्षा पास करने के बाद ऑनलाइन। GST टैक्स इनवॉइस दिया जाता है। ट्रेनिंग और परीक्षा मुफ़्त हैं।']],
        ['2. इसमें क्या मिलता है', ['मूल्यांकन, आपका Partner ID और बैज, आपका सार्वजनिक जाँच पेज, और Partner ID की 12 महीने की वैधता तक पार्टनर ऐप और सहायता।']],
        ['3. यह क्या नहीं है', ['यह जमा राशि, निवेश या किसी स्कीम की जॉइनिंग फ़ीस नहीं है। इस पर कभी किसी को कोई रिवॉर्ड नहीं मिलता। इसे देने से किसी कमाई का वादा नहीं होता।']],
        ['4. रिफ़ंड', ['Partner ID जारी होने के बाद फ़ीस वापस नहीं होती।', 'अगर आपने भुगतान किया और Partner ID जारी नहीं हुआ, तो 7 दिन में टिकट या contact@sehatsandhi.com से लिखें, पूरी फ़ीस लौटा दी जाएगी।']],
        ['5. सालाना रिन्यूअल', ['आपका Partner ID 12 महीने वैध है। इसे बनाए रखने के लिए हर साल रिन्यू करें: खत्म होने से 30 दिन पहले से, ऐप में रिफ़्रेशर क्विज़ पास करें और ₹100 + GST रिन्यूअल फ़ीस दें। आपका Partner ID वही रहता है और 12 महीने और चलता है; GST इनवॉइस दिया जाता है। अपने-आप कुछ नहीं कटता।', 'खत्म होने के 30 दिन में रिन्यू न होने पर आपकी साझेदारी समाप्त हो जाती है। रिन्यूअल होने के बाद रिन्यूअल फ़ीस वापस नहीं होती।']],
      ],
    },
  },
]
