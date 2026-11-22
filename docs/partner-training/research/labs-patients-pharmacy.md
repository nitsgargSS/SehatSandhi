# Research notes — labs, referrals, patients, pharmacy, full hospital flow (22 Nov 2026)

Source for the product-track training modules. From the code; file references are
relative to the repo (D = src/pages/doctor/Dashboard.tsx, P = src/pages/doctor/Patients.tsx,
M/ = supabase/migrations/). Staff dashboard: /business/dashboard; staff login /business/login.

## Doctor → lab referral
1. Patients tab → patient → Lab tests pane (P:985-986).
2. In-house lab: Order lab tests → tests/packages, visit, note, Urgent → Send to lab (P:1109-1151); charge to patient's account (M/0168).
3. Another Sehatsandhi lab: Send to another lab (P:1128) → pick lab/diagnostic centre (same city/PIN first) → that lab's tests at its prices → who pays: patient (at the lab) or hospital (on the bill / IPD stay) (M/0290; ReferTests.tsx).
4. Patient added to the lab's list (source referral); lab Accepts (collecting = accepting) or Declines with a reason, doctor told (M/0288:160-195; M/0290:157-195).
5. Lab technicians get a push notification per new order (M/0288:187-195).
6. Doctor can withdraw only before sample collection and before billing (M/0290:159-180).
7. Signed report → ordering doctor push "Report ready — N out of range", Reports ready on Today tab, and under patient's Lab tests; corrections notify again (M/0288:240-262; ReportsReady.tsx).
Money (M/0291): business↔business only, never to a doctor. Terms proposed/accepted: B2B discount 0–60% (hospital-paid tests); service fee 0–40% lab→hospital on patient-paid tests (disclosed); weekly/monthly statements; default screen 10% discount, 0% fee, monthly. Ledger line at report signing. Owner/manager only. Only clinical staff can send tests out (M/0180).
Not found: message to the patient when tests are ordered; WhatsApp report to referring doctor (in-app only).

## Lab flow
Orders from: lab desk (New order, free-text "Referred by"), doctor, patient app / /my/book, WhatsApp bot, referral.
Home collection: address, slot, collector, fee; Home collections list with map link.
Sample collected (who). Enter results per parameter, High/Low flagged vs range (female range), last value shown; imaging uses text templates.
Approve & send report (owner/doctor only) → numbered report, sent at once on WhatsApp (email fallback) (lab-report-send). Corrections = new version.
Report /lab/:token: banner, High/Low in words, signer name + qualification + time, A4, link 1 year. No image signature/stamp.
Uploaded files (PDF/photo) sent as-is /lab/file/:token, kept 365 days.
Follow-ups: approval schedules next test (sooner if abnormal); due/overdue/abnormal lists + one-tap WhatsApp reminders.
Roles: lab technician (only Lab tab + My account; cannot sign); approve = owner/doctor (pathologists/radiologists added as doctors).
Settings: home collection fee, 60-char offer line; banner PNG/JPG/WebP <2 MB also on OPD slips, bills, prescriptions, discharge summaries.
Kinds: pathology, radiology, cardiology; Diagnostic Centre also gets OPD; ~260 tests + packages (prices editable, ranges per lab).
Lab tab: Orders / New order / Home collections / Follow-ups / Uploaded reports / Tests / Packages / Settings.

## Patient flow
Registration: Patients → New patient (name, mobile, relation, age, gender, blood group, file no., address). One phone = household; same person = same phone + same name; "who has come?" picker.
Search: name, phone (3+ digits), file number; diagnosis/keyword search.
Consent: WhatsApp updates on per clinic until STOP. (Recording feature off.)
Patient receives links (no login): /rx/:token (90 days), /bill/:token, /lab/:token, /ds/:token — via Send menu (WhatsApp/email).
WhatsApp Pro automatic messages (on by default, owner can switch off): welcome; visit_summary 15 min after visit done; thank_you with 1–5 rating (max once/30 days); follow_up 10 am day before; app push instead if patient has the app; quiet 9 pm–8 am.
Patient login /my or the app (WhatsApp code): /my/records (family, visits, prescriptions, reports, bills, discharge summaries), /my/chat/:business, /my/book, /my/order, /my/ambulance. Records per clinic only.

## Pharmacy
In-house: OPD prescription → "waiting" + pharmacist push; Prescriptions waiting (7 days) → Dispense / Not needed; bill marks dispensed.
New bill (patient or walk-in): prices from batch; discount needs reason; split payments, credit.
Stock: medicines → purchases (batch, expiry, MRP, units/strips) → ledger; returns, reorder, expiry lists, stock report.
GST only with own GSTIN: tax out of MRP, CGST/SGST, Tax invoice with HSN; else plain bill. Print /business/print/pharmacy/:id (not a patient link).
IPD ward requests issue to the stay.
Patient medicine orders (standalone pharmacies): WhatsApp or /my/order with Rx photo → PIN pharmacies, first to accept → price → patient approves /o/:token → packed → out → delivered. 30 min accept / 1 h price / 24 h approve limits.

## Full hospital flow (M/0288–0291)
1 Orders reach pharmacy and lab automatically; reports back to doctor. 2 Planned surgery (Operations pane, 7-day list on Today, message plans −30…+90 days, WhatsApp Pro, 8 am–9 pm). 3 Tests to other labs. 4 Partner terms, ledger, statements.
