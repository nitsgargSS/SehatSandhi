// Care Partner Program — PRODUCT TRACK: how Sehatsandhi works, with screenshots.
// Replaces Module 2 ("Product demo"). DRAFT, English first (22 Nov 2026): Nitin
// reviews the English, then it is translated to Hindi.
//
// Written from the code (docs/partner-training/research/*.md), not from plans.
// Screenshots: docs/partner-training/shots/<name>.png, taken on STAGING from the
// demo "Sehatsandhi Training Hospital" (fake patients) by scripts/training-shots.mjs.
//
// Rules for this text: describe only what the product does today; no income or
// "more patients" promises; no insurance, no EMI; never "government/ABDM approved".
//
// A section item is a sentence, or { img, cap, phone } for a screenshot.

export const PRODUCT_VERSION = 'draft-1 (English) · 22 Nov 2026'

const shot = (img, cap, phone = false) => ({ img, cap, phone })

export const PRODUCT_MODULES = [
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-whatsapp-booking',
    title_en: 'How patients find a doctor on WhatsApp',
    title_hi: 'मरीज़ WhatsApp पर डॉक्टर कैसे ढूँढते हैं',
    sections: [
      ['The idea', [
        'Most families already use WhatsApp. So patients do not need to download anything or learn a new website: they send "Hi" to Sehatsandhi\'s WhatsApp number and a bot helps them in Hindi or English, any time of day.',
        'The bot can find a doctor, a lab test, medicines from a nearby pharmacy, or an ambulance. This module is about doctors.',
      ]],
      ['Step by step', [
        '1. The patient sends "Hi" (or "Namaste", "Doctor"…) or scans a clinic\'s QR poster. The bot shows a menu: Doctor, Diagnostic lab, Order medicine, Ambulance, Camps & offers — or "type your problem".',
        '2. The patient picks a speciality from a list, or simply types the problem in their own words, like "घुटने में दर्द" or "दांत का डॉक्टर जगाधरी".',
        '3. The bot asks for the area: a city, a 6-digit PIN code, or the patient shares their location. It remembers the PIN for next time.',
        '4. The bot shows up to 8 doctors near that PIN. Each line shows the doctor, a ✓ if their registration is verified, the clinic, the rating (for example 4.6★, 23 reviews — or "new"), the fee, and a link to the profile.',
        '5. The patient picks a doctor and a time: the bot offers up to 10 open slots in the next 7 days, from the doctor\'s real calendar.',
        '6. The patient gives the name and age of the person who will come ("Sunita, 34"). Done.',
        '7. The bot confirms: doctor, clinic, date, time, address, "please arrive 10 minutes early". After the visit the patient can rate it from the same chat.',
      ]],
      shot && ['See it', [
        shot('wa-booking-demo', 'Our booking demo page walks through the whole WhatsApp journey on a phone — use it when you show a doctor (sehatsandhi.com/business/booking-demo).', true),
      ]],
      ['What the clinic sees', [
        'The booking appears at once in the clinic\'s Appointments and Today screens, and the doctor and owner get an app notification and an email.',
        'If the clinic confirms, changes or cancels the time, the patient gets a WhatsApp message about it.',
      ]],
      ['Clinic QR and the clinic\'s own WhatsApp', [
        'Every clinic gets a Booking QR poster. A patient who scans it lands straight in that clinic\'s own menu: book an appointment, get updates, see its doctors.',
        'With WhatsApp Pro (an add-on) the clinic can connect its own WhatsApp number, so patients book by messaging the clinic itself. Printed posters keep working after the switch.',
      ]],
      ['What to say — and what not to say', [
        'Say: "Patients near you can find and book you on WhatsApp, in Hindi or English, without calling."',
        'Do not say: "You will get more patients" or "you will be at the top". Who appears first depends on distance, speciality and patients\' reviews (Module on reviews and ranking).',
        'Only clinics with an active (paid) listing appear in the bot.',
      ]],
    ].filter(Boolean),
    questions: [
      ['single', 'How does a patient start a booking on WhatsApp?', [['Downloads a special app first', 'Sends "Hi" to Sehatsandhi\'s WhatsApp number (or scans a clinic QR)', 'Calls the clinic', 'Fills a paper form']], ['b'], 'No download needed.'],
      ['truefalse', 'A patient can type the problem in their own words, like "knee pain", instead of choosing a speciality.', null, ['t'], 'The bot understands free text in Hindi or English.'],
      ['single', 'How many doctors does the bot show at most for one search?', [['3', '8', '20', 'All doctors in India']], ['b'], 'Up to 8, nearest first.'],
      ['single', 'Which clinics appear in the WhatsApp bot?', [['Every clinic in the city', 'Only clinics with an active, paid listing', 'Only government hospitals', 'Only clinics with 100 reviews']], ['b'], 'An active listing is needed.'],
      ['truefalse', 'You can promise a doctor they will be shown first.', null, ['f'], 'Order depends on distance, speciality and reviews.'],
      ['single', 'What does a clinic\'s Booking QR poster do?', [['Opens that clinic\'s own WhatsApp menu to book', 'Pays the bill', 'Shows the doctor\'s salary', 'Nothing']], ['a'], 'Scan → that clinic\'s menu.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-reviews-ranking',
    title_en: 'Reviews, the QR posters and how clinics are ranked',
    title_hi: 'रिव्यू, QR पोस्टर और क्लिनिक की रैंकिंग',
    sections: [
      ['Why reviews matter', [
        'When patients compare doctors on WhatsApp, they see each clinic\'s star rating and number of reviews. In the WhatsApp search, a clinic with good reviews from real patients is shown above others at the same distance.',
      ]],
      ['Reviews come only from real visits', [
        'Sehatsandhi does not accept reviews from just anyone. A patient can rate a clinic only if they actually visited it:',
        'After a WhatsApp booking: the confirmation has a "⭐ रेटिंग दें" (give rating) button that works after the visit time.',
        'Walk-in patients: the clinic puts up its Review QR poster. The patient scans it and rates on WhatsApp — allowed only if the clinic has a visit for that number in the last 30 days, and once per 30 days.',
        'The clinic can ask: from the visit register, "Ask for review" sends a WhatsApp request to patients seen in the last 60 days (not asked in the last 30 days).',
        'With WhatsApp Pro, a "thank you, please rate us 1–5" message goes out automatically a couple of hours after the visit.',
        'In the app or on the website, a patient can rate their own booking once.',
      ]],
      ['See it', [
        shot('qr-codes', 'Clinic & team → QR codes: the Booking, Reception and Review QR posters, ready to print.'),
        shot('qr-review-poster', 'The printed Review QR poster for walk-in patients.'),
      ]],
      ['Fair for everyone', [
        'The clinic cannot edit or delete a review. Abusive words are held back (the stars still count).',
        'After a patient rates on WhatsApp, the thank-you message includes the clinic\'s Google review link (if the clinic gave it at registration) — for good and bad ratings alike.',
        '"Top Rated" badge: an average of 4.5★ or more with at least 10 reviews.',
      ]],
      ['How the WhatsApp search orders clinics', [
        '1. Nearness: the patient\'s own PIN code (or clinics that serve it) first, then the rest of the district.',
        '2. The right speciality for what the patient asked.',
        '3. Top Rated clinics (4.5★ and 10+ reviews).',
        '4. Higher average rating (clinics with no ratings yet come after).',
        '5. Newer listings.',
        'There is no paid way to be shown higher, and the plan a clinic buys does not change its position. The website\'s booking page orders by nearness and speciality only.',
      ]],
      ['What to tell a doctor', [
        '"Ask every patient to rate you — the Review QR at the reception makes it easy. Good reviews from real patients help nearby patients choose you on WhatsApp."',
        'Never promise a position, a number of reviews or a number of patients.',
      ]],
    ],
    questions: [
      ['single', 'Who can leave a review for a clinic?', [['Anyone on the internet', 'Only patients who actually visited (booking, QR within 30 days of a visit, or asked by the clinic)', 'Only the doctor\'s friends', 'Only Care Partners']], ['b'], 'Reviews come from real visits.'],
      ['truefalse', 'A clinic can delete a bad review.', null, ['f'], 'Reviews cannot be edited or deleted by the clinic.'],
      ['single', 'What is needed for the "Top Rated" badge?', [['Paying extra', '4.5★ or more with at least 10 reviews', '1 review', 'A government certificate']], ['b'], '4.5★ average and 10+ reviews.'],
      ['multi', 'What decides the order on the WhatsApp search? (choose all that are right)', [['Nearness to the patient\'s PIN', 'The right speciality', 'Ratings and reviews', 'How much the clinic paid']], ['a', 'b', 'c'], 'There is no paid boost.'],
      ['single', 'A walk-in patient wants to rate the clinic. What helps?', [['The Review QR poster at reception', 'Calling Sehatsandhi', 'Writing on paper', 'Nothing']], ['a'], 'Scan → rate on WhatsApp.'],
      ['truefalse', 'You may promise a doctor that they will reach the top of the list.', null, ['f'], 'Never promise a position.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-patient-app-website',
    title_en: 'The Sehatsandhi app and website for patients',
    title_hi: 'मरीज़ों के लिए सेहतसंधि ऐप और वेबसाइट',
    sections: [
      ['One app for patients and clinics', [
        '"Sehatsandhi: Doctors & Clinics" is on the Google Play Store (Android). The same app has two sides: patients book and see their records; clinic staff run their queue, patients, lab, beds and bills.',
        'The website sehatsandhi.com does the same in any browser. Nothing has to be installed by the clinic.',
      ]],
      ['What a patient can do', [
        'Find a doctor, lab test, medicines or ambulance — type the problem or pick a tile.',
        'Book a doctor: speciality → area (PIN or location) → day → time → name and age.',
        'Sign in with a 6-digit code on WhatsApp (no password) to see "My Sehatsandhi": the family members on that number, visits, prescriptions, lab reports, bills and discharge summaries from Sehatsandhi clinics, and chat with a clinic.',
        'Each clinic\'s records stay with that clinic: one clinic cannot read another clinic\'s notes.',
      ]],
      ['See it', [
        shot('web-home', 'Home page: book on WhatsApp, ambulance (108 first), and what you need.', true),
        shot('web-book', 'Book an appointment on the website: what you need, PIN or location, day.', true),
        shot('web-doctor-profile', 'A doctor\'s public profile: speciality, clinic, fee, area served, reviews, and "Book on WhatsApp".', true),
      ]],
      ['For the clinic\'s staff', [
        'Staff sign in to the same app with their email code, password, or a WhatsApp code. They see tabs for their job: queue, bookings, patients, messages, lab, beds, pharmacy orders.',
        'Plans and payments are done on the website, not in the app.',
      ]],
      ['What to say', [
        '"Your patients get their prescription, bill and reports on their phone, and can book you again in two taps. Your staff can work from a phone too."',
        'Do not promise appointment reminders: today the automatic reminder is for the doctor\'s follow-up date, with WhatsApp Pro (see the patient journey module).',
      ]],
    ],
    questions: [
      ['single', 'How does a patient sign in to see their records?', [['With a password', 'With a 6-digit code on WhatsApp', 'With Aadhaar', 'They cannot']], ['b'], 'WhatsApp code, no password.'],
      ['truefalse', 'One clinic can read another clinic\'s notes about the same patient.', null, ['f'], 'Records stay with each clinic.'],
      ['single', 'Where does a clinic pay for its plan?', [['In the app', 'On the website', 'In cash to the partner', 'At a bank']], ['b'], 'Payments are on the website.'],
      ['truefalse', 'The clinic must install special software on its computers.', null, ['f'], 'App or any browser.'],
      ['multi', 'What can a patient see in "My Sehatsandhi"? (choose all that are right)', [['Prescriptions', 'Lab reports', 'Bills', 'Other patients\' records']], ['a', 'b', 'c'], 'Only their own family\'s records.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-patient-journey',
    title_en: 'The patient journey: registration, records and messages',
    title_hi: 'मरीज़ की यात्रा: रजिस्ट्रेशन, रिकॉर्ड और मैसेज',
    sections: [
      ['One phone, one family', [
        'In India one phone often serves a whole family. Sehatsandhi keeps each person as a separate member under the phone number, with their own history.',
        'Reception finds a patient by name, phone number or file number. If the number is already there, the screen asks "who has come?" — or adds a new member. Returning patients show "seen here before".',
      ]],
      ['The record', [
        'Each patient has: visits (complaint, diagnosis, advice, follow-up date), vitals, prescriptions, medical history (allergies in red, long-term conditions), documents, admissions, operations, lab tests and billing.',
      ]],
      ['See it', [
        shot('patient-visits', 'A patient\'s record: the tabs, and visits with complaint, diagnosis, advice and follow-up date.'),
        shot('patient-history', 'Medical history: allergies and long-term conditions, always visible.'),
      ]],
      ['What the patient receives', [
        'Prescriptions, bills, lab reports and discharge summaries are sent to the patient as a link (by WhatsApp or email) that opens on any phone — no app, no login needed.',
        'WhatsApp sending is part of the WhatsApp add-on; email is free.',
      ]],
      ['See it', [
        shot('link-prescription', 'The prescription link as the patient sees it on the phone.', true),
        shot('link-bill', 'The bill link: items, payments, and what is due.', true),
      ]],
      ['Automatic messages (WhatsApp Pro)', [
        'With WhatsApp Pro the clinic\'s WhatsApp sends these by itself (the owner can switch each off):',
        'A welcome message when a patient is registered.',
        'The prescription and bill, about 15 minutes after the visit is completed.',
        'A thank-you with a 1–5 rating request after the visit.',
        'A follow-up reminder the day before the follow-up date the doctor wrote.',
        'Nothing is sent between 9 pm and 8 am. A patient who replies STOP gets no more messages from that clinic.',
      ]],
    ],
    questions: [
      ['single', 'One phone number is used by a whole family. How does Sehatsandhi handle it?', [['Only one person per phone', 'Each family member is kept separately under the same number', 'The family must buy new phones', 'Records are mixed together']], ['b'], 'One phone, many members.'],
      ['single', 'How does a patient receive a prescription?', [['Only on paper', 'As a link that opens on any phone', 'By post', 'They cannot']], ['b'], 'A link by WhatsApp or email.'],
      ['truefalse', 'Automatic WhatsApp messages are sent at night too.', null, ['f'], 'Quiet hours 9 pm–8 am.'],
      ['single', 'Which automatic reminder does WhatsApp Pro send?', [['A reminder the day before the doctor\'s follow-up date', 'A daily health tip forever', 'A payment demand', 'None']], ['a'], 'Follow-up reminder.'],
      ['truefalse', 'A patient can reply STOP to stop messages from a clinic.', null, ['t'], 'Their choice is respected.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-opd',
    title_en: 'OPD: from arrival to prescription',
    title_hi: 'OPD: आने से पर्ची तक',
    sections: [
      ['The day at a glance', [
        'The Today screen shows the owner the whole day: OPD queue, beds, lab, pharmacy sales and money collected — with warnings such as low deposits.',
        shot('today-cards', 'Today: queue, wards, lab, pharmacy and money in one place.'),
      ]],
      ['1. Arrival and token', [
        'A booked patient is marked "arrived". A walk-in gets a token at the desk: search the patient (or register new: name, mobile, age, gender, PIN), choose the doctor, and take the fee — full, discounted or free. A discount needs a reason.',
        'The fee can be paid by cash, UPI or card, even split, or left unpaid. One click gives the token, adds the fee to the bill and records the payment. The OPD slip can be printed.',
        'Patients can also register themselves: they scan the Reception QR with their phone and fill in their details.',
        shot('queue-give-token', 'Queue → Give a token: who is it for, and the waiting line.'),
      ]],
      ['2. The queue', [
        'Everyone sees the line: waiting, with the doctor, seen today, and how long the last person has waited. A patient can be seen out of turn, with a reason.',
        shot('queue', 'The OPD queue with Consult, Record vitals, Slip and Done.'),
      ]],
      ['3. Vitals', [
        'The nurse or desk records BP, pulse, temperature, SpO₂ and weight. Only the doctor and nurse see the numbers; others just see "✓ Vitals".',
        shot('patient-vitals', 'Vitals in the patient\'s record.'),
      ]],
      ['4. The doctor', [
        'The doctor presses "Call next", then "Consult". The record opens at today\'s visit: complaint, diagnosis, advice, follow-up date and an examination form for their speciality.',
        'Prescription: medicines are suggested from the pharmacy\'s stock; dose, duration, advice and "come back on" date. Allergies show in red. An issued prescription cannot be changed — only cancelled and replaced — so the record stays honest. Only a doctor\'s login can issue one.',
        'The doctor can order lab tests, or refer the patient to another doctor in the clinic (with that doctor\'s fee, a different fee or free).',
        shot('patient-prescriptions', 'Prescriptions: write, send to the patient, or cancel.'),
      ]],
      ['5. After the visit', [
        'The prescription goes to the in-house pharmacy as "waiting", and the bill is ready at reception. The patient gets the prescription and bill as links.',
      ]],
      ['Appointments and many clinics', [
        'Reception can book patients for later from the Appointments screen; leave and holidays are respected.',
        'A doctor who works at several clinics has one login and one calendar: a booking at one clinic blocks that time at the others, and leave entered once applies everywhere.',
        shot('appointments', 'Appointments: book for later.'),
      ]],
    ],
    questions: [
      ['single', 'What is needed when the OPD fee is reduced?', [['Nothing', 'A reason', 'The patient\'s Aadhaar', 'A partner\'s approval']], ['b'], 'Every discount needs a reason.'],
      ['truefalse', 'Patients can register themselves by scanning the Reception QR.', null, ['t'], 'They fill in their own details.'],
      ['single', 'Who sees the actual vitals numbers?', [['Everyone', 'Only the doctor and nurse', 'Only reception', 'The patient\'s neighbours']], ['b'], 'Others see "✓ Vitals".'],
      ['truefalse', 'An issued prescription can be quietly edited later.', null, ['f'], 'Only cancelled and replaced.'],
      ['single', 'A doctor works at two clinics. A patient books 10 am at clinic A. What happens at clinic B?', [['10 am stays open there', '10 am is blocked there too', 'Both clinics are closed', 'The doctor is charged twice']], ['b'], 'One calendar across clinics.'],
      ['multi', 'What can happen in one step when a token is given? (choose all that are right)', [['Token created', 'Fee added to the bill', 'Payment recorded', 'Doctor\'s salary paid']], ['a', 'b', 'c'], 'Token, fee and payment together.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-billing',
    title_en: 'Billing and collections: every rupee accounted for',
    title_hi: 'बिलिंग और कलेक्शन: हर रुपये का हिसाब',
    sections: [
      ['What goes on the bill by itself', [
        'The OPD fee — when the token is given.',
        'Referral fees to another doctor in the clinic.',
        'Lab tests and packages (and the home-collection fee) — when they are ordered.',
        'Medicines issued to an admitted patient by the pharmacy.',
        'Bed charges for admitted patients — when "Post bed charge" is pressed (not automatically).',
        'Procedures and other items are added by reception: from the clinic\'s price list (counter invoice) or "Add a charge".',
      ]],
      ['The billing screen', [
        'Reception sees, for each patient: charged, paid and balance due. They can make a counter invoice from the price list, add a charge, record a payment (split between cash, UPI, cards, net banking or cheque), and issue a numbered bill.',
        shot('patient-billing', 'A patient\'s Billing: charged, paid, balance due, new invoice, payments.'),
        shot('link-bill', 'The bill the patient receives.', true),
      ]],
      ['Rules that stop leakage', [
        'Every discount needs a reason — on the OPD fee, the bill, a counter invoice or a pharmacy bill. Discounts show in the doctors\' "discounts given" report.',
        'Every payment records who took it and how.',
        'Only the owner or a manager can change or delete a payment, and every change is logged.',
      ]],
      ['Collections: tally the cash drawer', [
        'The Collections screen shows every payment in a period, by person and by method (cash, UPI, card), for the clinic and the pharmacy together — so the evening cash count matches. Owners and managers see everyone; other staff see only their own.',
        shot('collections', 'Collections: who took how much, by method.'),
      ]],
      ['Reports for the owner', [
        'Patient report: new and returning patients, follow-ups due and missed, by area and PIN code, age, gender, doctor, diagnosis and busiest times — and patients to invite back.',
        'Doctors: every doctor side by side with patients, earnings and discounts.',
        shot('patient-report', 'Patient report.'),
        shot('doctors', 'Doctors side by side.'),
      ]],
      ['What to say', [
        '"Every rupee is recorded with who took it and how. Discounts need a reason. At night your cash count matches the screen."',
      ]],
    ],
    questions: [
      ['single', 'Which of these is NOT added to the bill automatically?', [['The OPD fee at token time', 'Lab tests when ordered', 'Bed charges (posted by pressing a button)', 'Medicines issued to an admitted patient']], ['c'], 'Bed charges are posted by pressing "Post bed charge".'],
      ['truefalse', 'Every payment records the name of the person who took it.', null, ['t'], 'And the method.'],
      ['single', 'Who can change or delete a payment?', [['Anyone', 'Only the owner or a manager, and it is logged', 'The patient', 'Nobody ever']], ['b'], 'Changes are logged.'],
      ['single', 'What is the Collections screen for?', [['Booking patients', 'Tallying payments by person and method', 'Writing prescriptions', 'Ordering medicines']], ['b'], 'Cash drawer tally.'],
      ['truefalse', 'A discount can be given without a reason.', null, ['f'], 'A reason is always needed.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-ipd',
    title_en: 'IPD: from admission to discharge',
    title_hi: 'IPD: भर्ती से डिस्चार्ज तक',
    sections: [
      ['Wards and beds', [
        'The owner or manager sets up wards and beds with each bed\'s daily charge. The Beds screen shows every bed: free, or which patient is in it, the day of the stay, the doctor, and whether the deposit is running low.',
        shot('ipd-beds', 'Beds: occupied and free beds by ward, with deposit warnings.'),
      ]],
      ['1. Admission', [
        'From the patient\'s record: Admissions → Admit. Choose a bed, the attending doctor, the reason, the admitting diagnosis and the expected discharge date.',
        shot('ipd-admission', 'An admitted patient: bed, doctor, diagnosis, deposit used and left, ward notes, bed history, drug chart.'),
      ]],
      ['2. During the stay', [
        'Ward notes, and a drug chart: the doctor orders, the nurse records each dose.',
        'Deposit: take a deposit and print a receipt. The screen shows deposit, used and left, and warns when it runs low.',
        'Medicines: the ward requests them; the pharmacy issues them (earliest expiry first) and they go straight onto the patient\'s stay bill.',
        'Lab tests ordered during the stay also go onto the stay bill.',
      ]],
      ['3. Operations', [
        'Planned surgeries are recorded with procedure, date, OT, surgeon and notes. The next 7 days show on the Today screen. With WhatsApp Pro, the hospital can send the patient instructions before and after the operation automatically.',
        shot('ipd-operations', 'Operations: the procedure, surgeon, findings and post-op instructions.'),
      ]],
      ['4. Bill and discharge', [
        'Bed charges are posted with one button ("Post bed charge"): part of a day counts as a full day, at each bed\'s rate. Deposits count as already paid on the final bill.',
        'Discharge is done by clinical staff. The doctor writes the discharge summary, issues it, and it is sent to the patient as a link.',
        shot('ipd-billing', 'The stay\'s billing.'),
        shot('link-discharge', 'The discharge summary as the patient receives it.', true),
      ]],
      ['The IPD add-on', [
        'IPD comes as the "IPD + Pharmacy" add-on (see the plans module for today\'s price and how many beds are included).',
      ]],
    ],
    questions: [
      ['single', 'Where does a patient get admitted?', [['On paper only', 'From the patient\'s record: Admissions → Admit', 'In the pharmacy', 'On the website\'s home page']], ['b'], 'Admissions → Admit.'],
      ['truefalse', 'Medicines issued to an admitted patient go straight onto their stay bill.', null, ['t'], 'Issued by the pharmacy, billed to the stay.'],
      ['single', 'How are bed charges added?', [['Automatically every hour', 'By pressing "Post bed charge"', 'The patient adds them', 'They are free']], ['b'], 'One button; part day = full day.'],
      ['single', 'How does the patient receive the discharge summary?', [['As a link on the phone', 'Only by post', 'They cannot', 'From a partner']], ['a'], 'Sent as a link.'],
      ['truefalse', 'The Beds screen warns when a patient\'s deposit is running low.', null, ['t'], 'So the hospital collects in time.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-labs',
    title_en: 'Labs and referrals: tests and reports back to the doctor',
    title_hi: 'लैब और रेफ़रल: टेस्ट और रिपोर्ट डॉक्टर तक',
    sections: [
      ['Ordering tests', [
        'From the patient\'s record, the doctor orders tests or packages ("Order lab tests") — to the clinic\'s own lab — or "Send to another lab" on Sehatsandhi: same city or PIN first, with that lab\'s own tests and prices, and who pays (the patient at the lab, or the hospital on its bill).',
        shot('patient-lab-tests', 'A patient\'s lab tests: order, send to another lab, and reports.'),
      ]],
      ['The lab\'s side', [
        'The lab sees new orders and accepts them (or declines with a reason, which the doctor is told). Lab technicians get a phone notification for each new order.',
        'Home collection: address, time slot, collector and fee; the day\'s round has a map link.',
        'Sample collected → results entered test by test. Values outside the normal range are flagged High or Low, and the patient\'s last value is shown.',
        'Only a doctor (for example the pathologist) approves and signs the report. It is then sent to the patient at once on WhatsApp (or email). A correction is issued as a new version.',
        shot('lab-orders', 'The Lab screen: orders to collect, results to enter, reports to approve.'),
      ]],
      ['Back to the doctor', [
        'When the report is signed, the ordering doctor gets a notification ("Report ready — 2 out of range") and sees it under "Reports ready" on the Today screen and in the patient\'s record.',
        shot('link-lab-report', 'The lab report as the patient receives it.', true),
      ]],
      ['Follow-ups', [
        'Approving a result can schedule the next test (sooner if a value was abnormal). The lab sees due and overdue patients and can remind them with one tap on WhatsApp.',
      ]],
      ['Labs and diagnostic centres as businesses', [
        'Pathology labs, diagnostic centres (imaging, ECG…) and both together can use Sehatsandhi: about 260 tests and packages are ready to use, with prices and normal ranges the lab sets. A diagnostic centre also gets an OPD for its doctors.',
        'Patients can book a lab test on WhatsApp too, at the lab or with home collection.',
      ]],
      ['Money between businesses', [
        'When a hospital sends tests to another lab, the two businesses can agree a discount or service fee, with weekly or monthly statements. This money is only ever between businesses — never paid to a doctor.',
      ]],
    ],
    questions: [
      ['single', 'Who can approve and sign a lab report?', [['Any staff member', 'A doctor (e.g. the pathologist)', 'The patient', 'A Care Partner']], ['b'], 'Technicians enter results; a doctor signs.'],
      ['truefalse', 'Values outside the normal range are flagged High or Low.', null, ['t'], 'And the last value is shown.'],
      ['single', 'How does the ordering doctor learn the report is ready?', [['A notification and "Reports ready" on the Today screen', 'They must phone the lab', 'By post', 'They are not told']], ['a'], 'Notification + Reports ready.'],
      ['truefalse', 'Referral money between a hospital and a lab can be paid to the doctor personally.', null, ['f'], 'Business to business only.'],
      ['single', 'Can a patient book a lab test on WhatsApp?', [['No', 'Yes — at the lab or with home collection', 'Only in English', 'Only for ambulances']], ['b'], 'Lab booking is in the bot.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-pharmacy',
    title_en: 'Pharmacy: prescriptions, stock and bills',
    title_hi: 'फ़ार्मेसी: पर्ची, स्टॉक और बिल',
    sections: [
      ['In a clinic or hospital', [
        'When the doctor issues a prescription and the clinic has a pharmacy, it appears in the pharmacy\'s "Prescriptions waiting" list and the pharmacist gets a notification. "Dispense" makes the bill; "Not needed" clears it.',
        shot('pharmacy', 'Pharmacy: prescriptions waiting, new bill, ward requests, stock.'),
      ]],
      ['Stock by batch and expiry', [
        'Purchases are entered with batch, expiry and MRP (in units or strips). Sales use the batch that expires first. Reorder, expiring and stock reports keep the shelf in order.',
        'Counter staff cannot type a price — it comes from the batch. A discount needs a reason. Payments can be split, or given on credit.',
      ]],
      ['GST', [
        'If the pharmacy has its own GSTIN, bills are GST tax invoices (GST included in the MRP, split into CGST and SGST, with HSN codes). Without a GSTIN they print as plain bills.',
      ]],
      ['Admitted patients', [
        'The ward requests medicines for an admitted patient; the pharmacy issues them and they go onto the patient\'s stay bill — nothing to collect at the counter.',
      ]],
      ['Standalone pharmacies: medicine orders from patients', [
        'A patient can send a prescription photo or medicine names on WhatsApp (or in the app) with an address. Every pharmacy delivering to that PIN code is alerted; the first to accept quotes a price; the patient approves it on a link before anything is packed and delivered.',
      ]],
    ],
    questions: [
      ['single', 'A doctor issues a prescription in a clinic with a pharmacy. What happens?', [['Nothing', 'It appears in "Prescriptions waiting" at the pharmacy', 'It is posted to the patient', 'The partner is told']], ['b'], 'Pharmacist is notified.'],
      ['truefalse', 'Counter staff can type any price they like.', null, ['f'], 'The price comes from the batch.'],
      ['single', 'Which batch is sold first?', [['The newest', 'The one that expires first', 'Any', 'The most expensive']], ['b'], 'Earliest expiry first.'],
      ['single', 'When does a pharmacy bill show GST?', [['Always', 'When the pharmacy has its own GSTIN', 'Never', 'Only on Sundays']], ['b'], 'GST invoice with a GSTIN.'],
      ['single', 'A patient orders medicines on WhatsApp from a standalone pharmacy. When is the order packed?', [['Immediately', 'After the patient approves the price on a link', 'Never', 'When the partner pays']], ['b'], 'The patient approves the quoted price first.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-plans-team',
    title_en: 'Joining Sehatsandhi: plans, paid trial, team and add-ons',
    title_hi: 'सेहतसंधि से जुड़ना: प्लान, पेड ट्रायल, टीम और ऐड-ऑन',
    sections: [
      ['How a business joins', [
        'The doctor (or owner) signs up at sehatsandhi.com/business: type of business → details (verified email and password) → choose the plan and add-ons → pay online. With an online payment the listing goes live straight away.',
        'There is a box for your Partner ID on this page — on the paid trial too.',
        shot('register', 'Sign-up at sehatsandhi.com/business/register.'),
      ]],
      ['Plans (check the live page for today\'s prices)', [
        'The price depends on the size of the practice — Clinic, Polyclinic, Multi-speciality, Hospital — and on labs, diagnostic centres and pharmacies.',
        'Start with a 1-month paid trial, then go yearly: 12 months for the price of 9.',
        'Add-ons: IPD + Pharmacy, Pathology, Diagnostics, Pharmacy, and Social media & website. Two add-ons get a discount, three or more a bigger one.',
        shot('pricing', 'The live pricing page — always show this, never quote from memory.'),
      ]],
      ['The team and their screens', [
        'Each person signs in with their own login and sees only what their job needs: owner (everything), manager, doctor (their own patients, prescriptions), nurse, reception (no medical notes), lab technician (lab only), pharmacist.',
        shot('team', 'Clinic & team: QR codes, print banner, surgery messages, partner labs and the team.'),
      ]],
      ['WhatsApp Basic and WhatsApp Pro', [
        'Basic: documents and messages to patients from Sehatsandhi\'s WhatsApp.',
        'Pro: the clinic\'s own WhatsApp number connected to Sehatsandhi, its own booking menu, and automatic messages (welcome, visit summary, thank-you, follow-up reminder). The clinic pays Meta\'s message charges.',
        shot('whatsapp', 'The WhatsApp screen.'),
      ]],
      ['Website and social media add-on', [
        'Every business gets a free one-page website. The Social media & website add-on gives a full website (all sections, articles, own domain) and daily social-media posts for the clinic\'s Facebook and Instagram, previewed on WhatsApp first.',
        shot('website', 'The Website screen.'),
      ]],
      ['The Plan screen', [
        'The owner sees the current plan, when it ends, and renews or adds add-ons here.',
        shot('plan', 'Plan.'),
      ]],
    ],
    questions: [
      ['single', 'How should a doctor start if they want to try Sehatsandhi first?', [['A free year', 'The 1-month paid trial', 'Pay you in cash', 'Wait for an invitation']], ['b'], 'Then the yearly plan.'],
      ['truefalse', 'The doctor can type your Partner ID even on the paid trial.', null, ['t'], 'You stay linked.'],
      ['single', 'Where do you find today\'s prices?', [['From memory', 'On the live pricing page sehatsandhi.com/business', 'From another partner', 'From the doctor']], ['b'], 'Never quote from memory.'],
      ['single', 'What does reception NOT see?', [['The queue', 'Billing', 'Medical notes', 'Appointments']], ['c'], 'Each role sees what their job needs.'],
      ['single', 'What does WhatsApp Pro add?', [['The clinic\'s own WhatsApp number and automatic messages', 'Free medicines', 'Insurance', 'A government licence']], ['a'], 'Own number + automatic messages.'],
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  {
    slug: 'p-international',
    title_en: 'International patients (for hospitals)',
    title_hi: 'अंतरराष्ट्रीय मरीज़ (अस्पतालों के लिए)',
    sections: [
      ['What it is', [
        'Sehatsandhi International helps patients from abroad (the Gulf, Nepal, Africa, the UK, USA and NRIs) compare Indian hospitals and ask for quotes. Joining is free for the hospital; Sehatsandhi adds its service fee on top of the hospital\'s price, only when a patient comes through it.',
        'Only hospitals (or businesses with IPD) can apply, and only the owner or a manager.',
      ]],
      ['How a hospital gets listed', [
        'International screen: hospital details → checklist and documents (licences, accreditations, facilities, photos) → photos and videos (each checked) → prices per procedure → agreement.',
        'Sehatsandhi lists the hospital only when the documents are verified, the video walkthrough is checked and the agreement is accepted. If a document expires, the listing pauses until it is renewed.',
        shot('international', 'International: the steps to get listed.'),
      ]],
      ['How a patient request works', [
        'The patient compares hospitals and asks for a quote with the procedure or problem. Sehatsandhi sends the request to hospitals; the hospital answers with its opinion, plan, price and what is included — without seeing the patient\'s phone or email. The patient receives the quote in three parts: hospital price, Sehatsandhi fee, and travel and stay.',
        shot('intl-compare', 'Patients compare hospitals at sehatsandhi.com/international.'),
      ]],
      ['The hospital\'s promises', [
        'The same price as its own international rate; no dealing around Sehatsandhi for 12 months; reply within 24 hours and quote within 48 hours of receiving reports; the final bill within 10% of the quote unless there is a written medical reason.',
      ]],
      ['What to say', [
        'Mention it only to hospitals. Never promise international patients or a number of them.',
      ]],
    ],
    questions: [
      ['single', 'Who can apply for Sehatsandhi International?', [['Any clinic', 'Hospitals (or businesses with IPD)', 'Pharmacies', 'Care Partners']], ['b'], 'Hospitals only.'],
      ['truefalse', 'Joining International is free for the hospital.', null, ['t'], 'A service fee is added only when a patient comes.'],
      ['single', 'Does the hospital see the patient\'s phone number when quoting?', [['Yes', 'No', 'Only on weekends', 'Only for NRIs']], ['b'], 'Contact details stay with Sehatsandhi.'],
      ['truefalse', 'You may promise a hospital a number of international patients.', null, ['f'], 'Never promise patients.'],
      ['single', 'What does the patient\'s quote show?', [['Only one total', 'Hospital price, Sehatsandhi fee, and travel and stay', 'The doctor\'s salary', 'Nothing until they arrive']], ['b'], 'Three clear parts.'],
    ],
  },
]
