# Sehatsandhi — Google Play listing

Everything to paste into the Play Console once the developer account (organisation: NG Technologies) is verified.
Package: `com.sehatsandhi.app` · Icon: `store/icon-512.png` · Bundle: the latest `store` build on EAS.

## Store listing

**App name (30):** Sehatsandhi – Doctors & Clinics

**Short description (80)**

- English: Find doctors, labs and medicines near you. Clinics run OPD, bills and reports.
- Hindi: पास के डॉक्टर, लैब और दवाई खोजें। क्लिनिक के लिए ओपीडी, बिल और रिपोर्ट।

**Full description (English)**

Sehatsandhi connects patients with verified doctors, clinics, labs, pharmacies, ambulances and insurance advisors near them — and gives clinics one place to run their day.

FOR PATIENTS
• Find a doctor by speciality or by describing your problem in your own words, in Hindi or English
• Book an appointment at a time the doctor has open, and get reminders
• Book lab tests at the lab or as a home collection
• Order medicines with a photo of your prescription — a pharmacy tells you the total before anything is sent
• Alert ambulances near you in an emergency (always call 108 first)
• Ask a licensed insurance advisor to call you back
• Keep your prescriptions, bills and reports in one place, for the whole family
• Free health camps and offers near you

FOR CLINICS, HOSPITALS AND LABS
• Give tokens and run the OPD queue from the phone
• Write prescriptions and keep each patient's history
• Take payments, make bills and see the day's collections
• In-patient beds and stays
• Lab orders and report upload
• Send a prescription, bill or report to the patient on WhatsApp

Sehatsandhi does not give medical advice and is not a substitute for a doctor. In an emergency call 108.

**Full description (Hindi)**

Sehatsandhi मरीज़ों को उनके पास के वेरिफ़ाइड डॉक्टर, क्लिनिक, लैब, फ़ार्मेसी, एम्बुलेंस और बीमा सलाहकार से जोड़ता है — और क्लिनिक को अपना पूरा काम एक जगह चलाने देता है।

मरीज़ों के लिए
• बीमारी या तकलीफ़ अपने शब्दों में लिखकर सही डॉक्टर खोजें
• डॉक्टर के खाली समय पर अपॉइंटमेंट बुक करें और रिमाइंडर पाएं
• लैब टेस्ट बुक करें — लैब पर या घर से सैंपल
• पर्ची की फ़ोटो भेजकर दवाई मंगवाएं — फ़ार्मेसी पहले कुल कीमत बताती है
• इमरजेंसी में पास की एम्बुलेंस को अलर्ट करें (पहले 108 पर कॉल करें)
• लाइसेंस वाले बीमा सलाहकार से कॉल-बैक लें
• पूरे परिवार के पर्चे, बिल और रिपोर्ट एक जगह
• पास के मुफ़्त हेल्थ कैंप और ऑफ़र

क्लिनिक, अस्पताल और लैब के लिए
• फ़ोन से टोकन दें और ओपीडी की लाइन चलाएं
• पर्चा लिखें और हर मरीज़ का रिकॉर्ड रखें
• भुगतान लें, बिल बनाएं, दिन की वसूली देखें
• भर्ती मरीज़ और बेड
• लैब ऑर्डर और रिपोर्ट अपलोड

Sehatsandhi कोई चिकित्सा सलाह नहीं देता और डॉक्टर का विकल्प नहीं है। इमरजेंसी में 108 पर कॉल करें।

**Category:** Medical · **Tags:** health, doctors, clinic management
**Contact:** website https://sehatsandhi.com · email admin@sehatsandhi.com · phone (the company's public number)
**Privacy policy URL:** https://sehatsandhi.com/privacy

## Screenshots to capture (phone, portrait, at least 4)

1. Home, with the search box
2. Find a doctor — results with open times
3. A booking confirmed
4. My Sehatsandhi — records and requests
5. (Clinic side) the OPD queue
6. (Clinic side) a bill or the day's collections

Use the demo clinic and demo patient so no real patient's details appear.

## App content declarations

**Privacy policy:** https://sehatsandhi.com/privacy

**App access:** all or some functionality is restricted → give the reviewer the demo logins from migration 0206 (the "Play review" clinic and patient). Type the credentials into the Console only; do not store them here.

**Ads:** No ads.

**Content rating questionnaire:** category "Reference, News or Educational" / utility; no violence, sexual content, profanity, drugs, gambling. Users can interact (messages between a patient and their clinic) → Yes. Shares location → Yes (with the user's consent). Expected rating: Everyone / 3+.

**Target audience:** 18 and over. Not designed for children.

**Health apps declaration:** tick "Medical" → clinical / practice management, and "Healthcare services and management" (appointments, records, pharmacy and lab ordering). Not a medical device; does not diagnose or treat. The app shows a disclaimer and the emergency number 108.

**Government apps:** No. **Financial features:** none (payments to Sehatsandhi by businesses are on the website, not in the app). **News app:** No.

## Data safety form

Collected — and why:

| Data | Collected | Shared | Purpose | Required? |
|---|---|---|---|---|
| Name | Yes | With the clinic / lab / pharmacy the user chooses | App functionality, account | Required |
| Phone number | Yes | Same | App functionality, account | Required |
| Email (clinic staff) | Yes | No | Account | Required for businesses |
| Address | Yes | With the pharmacy / lab / ambulance for that request | App functionality | Optional |
| Health info (prescriptions, reports, visits, age) | Yes | With the user's own clinic | App functionality | Required for records |
| Photos (prescription photo) | Yes | With the pharmacy that takes the order | App functionality | Optional |
| Approximate and precise location | Yes | With an ambulance service for that request only | App functionality | Optional |
| Messages (patient ↔ clinic) | Yes | With that clinic | App functionality | Optional |
| Device ID / push token | Yes | No | Notifications | Optional |

- Data is **encrypted in transit**: Yes.
- Users can **request deletion**: Yes — in the app under Me → Privacy requests, or by writing to admin@sehatsandhi.com; also described at https://sehatsandhi.com/privacy.
- No data is sold. No data is used for advertising.
- **Account deletion URL** (Play asks for one): https://sehatsandhi.com/privacy — confirm this page tells a user how to ask for their account and data to be deleted before submitting.

## Permissions the app uses

Notifications (appointment and order updates) · Location (find doctors nearby; send a pickup point to an ambulance) · Camera (photo of a prescription).

## Release notes — 1.1.0

Take the OPD fee with the token. Find labs by the kind of test. Scans are booked at the centre. Print the OPD slip from the phone.
