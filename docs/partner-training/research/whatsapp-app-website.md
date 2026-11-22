# Research notes — WhatsApp bot, ranking, mobile app, patient website (22 Nov 2026)

bot.ts = supabase/functions/_shared/bot.ts; inbound = supabase/functions/whatsapp-inbound/index.ts.

## WhatsApp bot
1. "Hi" (HELLO, NAMASTE, DOCTOR, LAB…) or a QR → Hindi menu with English: Doctor, Diagnostic lab, Order medicine, Ambulance, Camps & Offers, "type your problem" (insurance row removed).
2. Doctor: speciality from 3 list pages (~26) or free text ("घुटने में दर्द", "दांत का डॉक्टर जगाधरी") matched by sehat_free_text_whatsapp.
3. Area: city or 6-digit PIN or shared location; last PIN remembered ("📍 PIN" + "दूसरा एरिया").
4. Results: up to 8 doctors as a list — name, ✓ verified registration, clinic, rating "(4.5★, N समीक्षाएँ)" or "(नया)", town if in district, fee (discount struck through), profile link. One match → straight to times.
5. Time: up to 10 open slots over 7 days, not sooner than 30 minutes.
6. Name and age ("Sunita, 34"); last patient offered as a button.
7. Confirmation: doctor, clinic, date/time, address, arrive 10 minutes early, rate after visit; "⭐ रेटिंग दें" button; sometimes an app invite.
8. Lab: test type → area → labs doing that kind → tests/packages → at lab or home collection (fee shown) → slot within 7 days → name → confirmation. Scans at centre only.
9. Medicine: Rx photo or names → address with PIN → all pharmacies delivering there alerted → first to accept quotes → patient approves on order link. Expires 30 min if none accept.
10. Ambulance: "call 108 first" → now/booking → location → all services alerted, first to accept calls back; emergency unaccepted 10 min expires.
11. Clinic QR / clinic line: code SS-XXXXX → that clinic's menu: Book / Get updates / All doctors.
Rules: idle 1 h restarts (area and name remembered); STOP/START.

## Ranking (bot_bookable, M/0221)
1 Nearness (own PIN or coverage list = 0; same district = 1; further excluded) → 2 speciality fit → 3 Top Rated (avg ≥ 4.5 and ≥ 10 reviews) → 4 higher average rating (unrated last) → 5 newer listing. Limit 8. Only ACTIVE (paid) listings. Plan level / premium slots: NOT used.
Ratings belong to the clinic/business. No minimum to be listed. Recency not used.
Website /my/book and app Find: nearness, fit, then name A–Z (ratings not used). Labs: same as bot, with ★ and lab offer.
After booking: clinic gets email + app push (no WhatsApp alert). Patient gets WhatsApp (SMS fallback) when the clinic cancels/reschedules/confirms. NO automatic appointment reminder.
WhatsApp Pro automatic: welcome; visit summary (Rx + bill); thank-you rating 120 min after visit (30–1440); follow-up reminder day before; quiet 9 pm–8 am; app push instead if the patient has the app.
Demo: /business/booking-demo.

## Mobile app (com.sehatsandhi.app, v1.1.0) — patients AND businesses
Patient: Home text box + tiles (Doctor, Lab test, Medicines, Ambulance, Camps); Find (chat-style: speciality, area, doctors with times today/tomorrow/day after; book in app); login WhatsApp code (search needs none); My: records (Rx, reports, bills, family), requests, rate, chat with clinic, order, ambulance; emergency 108; camps.
Business: login email code / password / WhatsApp code (same as /business/login). Tabs by type: Queue, Bookings, Patients, Messages, Lab, Beds, Orders, Trips, Me; also token, consult, pharmacy bill, stock, collections, team, doctors/fees/hours, plan. No payments in app (website only).
Store listing caveats: still mentions insurance and "reminders" — fix before quoting it.

## Patient website
/: Book on WhatsApp, 108, tiles, WhatsApp QR. /browse: speciality cards → WhatsApp.
/my/book: speciality or lab test → PIN or location → day (3 days) → up to 20 results × 8 times → sign in (WhatsApp code) → name, age → booked.
/doctor/:slug: verified tick, Top Rated, stars, clinics with fees, latest 10 reviews, Book → WhatsApp.
/my, /my/records, /my/requests, /my/rate, /my/chat/:business, /my/order, /my/ambulance, /camps. Links /rx, /lab, /lab/file, /bill, /ds; tracking /o, /a, /c.
