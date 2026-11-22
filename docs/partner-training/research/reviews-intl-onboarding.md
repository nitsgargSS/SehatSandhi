# Research notes — reviews & QR, international patients, onboarding, staging logins (22 Nov 2026)

## Reviews and QR codes
- Each business has a short code SS-XXXXX (M/0141). Dashboard → Clinic tab → "QR codes" (ClinicQrCard.tsx): three QRs —
  Booking (opens WhatsApp "Hi SS-… I want to book"), Reception (self check-in form /c/:code, M/0251), Review (WhatsApp "Review SS-…").
  WhatsApp goes to Sehatsandhi's bot, or the clinic's own number once WhatsApp Pro is connected; printed posters keep working.
- Print: /business/print/qr/:id (?kind=review | reception); Download QR image.
- Ways a patient reviews: Review QR (walk-ins; bot asks stars then words; free to the clinic, M/0254); "Ask for review" in Patients → visit register (paid from wallet, M/0232); ⭐ button on the bot's booking confirmation (24 h, after visit time); app /my/rate (own booking, once).
- WhatsApp Pro: automatic "thank you, rate 1–5" after the visit (M/0262) — note the older automatic 3-hour request (messaging_settings.rating_sending_enabled) is OFF by default.
- After a WhatsApp rating the thank-you includes the clinic's Google review link when google_place_id is set (M/0306).
- Rules: every review must come from a real visit — Review QR needs a token/visit/admission in the last 30 days, once per clinic per 30 days; clinic asks only patients seen in 60 days, not asked/rated in 30, not STOP.
- Clinic cannot edit or hide reviews. Abusive words are held back (stars kept, M/0256). Admin can hide (no admin screen found). Replies: not built.
- "Top Rated" badge: average ≥ 4.5 with ≥ 10 reviews. Separate "Verified" registration badge.
- Screens: Clinic tab → QR codes (owner); print page; Today → "Patient reviews" card; Patients → visit register; public /doctor/:slug and /s/:slug.

## International patients (M/0312–0325)
Hospital side: only hospitals or IPD businesses; owner/manager; Today invite card; Dashboard → International: Your hospital / Checklist & documents (A–G: licences, NABH, facilities, comfort, ≥5 photos) / Photos & videos (checked) / Prices per procedure (valid 6 months) / Agreement. Status draft → submitted → reviewing → listed (paused/rejected). Listed only with agreement + verified documents + checked video walkthrough. Document expiry reminders 30 and 7 days; auto-pause on expiry.
Patient side: /international/compare (shortlist up to 3) → /international/quote (phone with country code, procedure/problem, consent + estimate acknowledgement; 5/day per contact). Admin alerted; patient gets WhatsApp at each status with /international/track/:token. Admin sends to hospitals → hospital answers in International → Patient requests (opinion, plan, price, inclusions) without seeing patient's phone/email → admin adds travel and shares: A hospital price, B Sehatsandhi fee, C travel & stay.
Fee 10% on top, rounded up to ₹100 (intl_fee_pct); joining free. Agreement: same price as own international rate; no going around Sehatsandhi for 12 months; reply 24 h, quote 48 h after reports; final bill within 10% of quote unless written medical reason.

## Business onboarding
/business → /business/register: Service type → Business details (email code, password, WhatsApp verify if enabled) → Review & pay: Clinic software + listing or Marketing only; term (now 1-month paid trial or 12 months, 0340); WhatsApp Basic ₹500/m or Pro ₹1,000/m; coupon; add-ons (IPD ₹2,000, Pathology ₹1,500, Diagnostics ₹3,000, Pharmacy ₹1,000, Social media & website ₹1,000; 2 → 10% off, 3+ → 20%; social never discounted); tiers by doctors (Clinic ≤2 ₹2,000, Polyclinic ≤4 ₹3,000, Multi ≤8 ₹5,000, Hospital ≤15 ₹8,000). Partner ID field on any paid term.
Payment by Razorpay → listing active at once; WhatsApp/commission route → admin approval.
Website: free one-page site /s/<slug>; social add-on → full site, articles, own domain (Website tab). Social posts: daily AI post, 7 PM WhatsApp preview, 10 AM publish to Facebook/Instagram (preview/ask/auto). WhatsApp Pro: own number via Meta Embedded Signup (number not already on WhatsApp), automatic messages, quiet hours 9 pm–8 am.

## Staging logins (sandbox)
- Staff: /business/login (email code, email+password, WhatsApp code). Patient: /my (WhatsApp code). Admin: hidden route — never in partner material.
- Echo codes when sending fails: CLINIC_OTP_ECHO, PATIENT_OTP_ECHO, PARTNER_OTP_ECHO (sandbox only).
- scripts/seed-sandbox-accounts.mjs: shared password in the script; sandbox-doctor@sehatsandhi.test ("[SEED] Sandbox Test Clinic"), sandbox-paid@ ("[SEED] Paid Multi-Speciality"), staff sandbox-reception@ / -staffdoc@ / -nurse@ / -manager@; "[SEED] Test Patient". Re-run after a sandbox purge. No lab-tech login seeded.
- scripts/seed-demo-hospital.mjs: full hospital (10 doctors, lab, pharmacy, ~30 patients on fake 9000x numbers, OPD/IPD/bills); owner signs in by WhatsApp code.
- scripts/create-demo-hospital.mjs: "Sehatsandhi Demo Hospital" (slug demohospital).
- scripts/seed-sandbox-bot.mjs: bot test businesses in PIN 135001.
- Do NOT use the Play-review demo clinic (real mailbox/SIM).
