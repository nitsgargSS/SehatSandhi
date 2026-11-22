# Research notes — OPD, IPD, doctor-to-billing, roles and reports (22 Nov 2026)

P = src/pages/doctor/Patients.tsx, D = src/pages/doctor/Dashboard.tsx, M/ = supabase/migrations/.
Screens: staff log in at /business/login → /business/dashboard. Tabs are clicked in the side menu (only plan, whatsapp, bills, website, social, international open by ?tab=).

## OPD
1. Booking (optional): app, WhatsApp bot, clinic website; desk booking in Appointments → "Book an appointment" (respects slots and leave).
2. Arrival: Today → "Mark arrived" (token WITHOUT fee — add fee from Billing); walk-in Queue → "Give a token"; self check-in reception QR /c/:code → "Registered themselves at reception".
3. Registration: search name/phone/file no.; returning patient shows "Seen here before (n)" and preselects the last doctor; new patient: name, mobile, age, gender, PIN (full form adds relation, file no., address). Identity = phone + family member; file no. never overwritten; merges by Sehatsandhi admin.
4. Token and fee in one step: doctor → Full fee / Discount / Free (reason needed below fee) → payment split up to 6 ways (cash, UPI, credit/debit card, net banking) or unpaid; "See out of turn" with reason; "Give token & add fee"; "Print OPD slip" /business/print/opd/:id.
5. Vitals: Queue → "Record vitals" (BP, pulse, temperature, SpO₂, weight); others see "✓ Vitals", numbers for doctor/nurse only.
6. Doctor: "Call next" → "Consult" → visit card (complaint, diagnosis, advice, follow-up date, speciality exam form; warns if no diagnosis) + Prescriptions tab ("Write a prescription": diagnosis, medicines suggested from stock, dose, duration, advice, "Come back on"; allergies in red; issued Rx can't be edited, only cancelled and replaced; doctor login only); Lab tests tab; "Refer to doctor" (fee/different/free, add to their queue today).
7. Billing at reception (Patients → patient → Billing).
8. Documents: "Send to patient" (Rx, bill, discharge summary, lab report) by WhatsApp (₹0.50 from wallet, WhatsApp add-on), email (free) or own email app; link expires 90 days. WhatsApp Pro automatic: welcome, Rx + bill ~15 min after completion, thank-you after 120 min, follow-up reminder day before; quiet 9 pm–8 am.
Reception never sees Consult or the medical record.

## IPD
1. Beds tab → "Wards & beds": owner/manager set wards, beds, daily charge; later changes by a manager need owner approval.
2. Admit: Patients → patient → Admissions → "Admit": bed (or none yet), attending doctor, reason, admitting diagnosis, expected discharge. "Bed history" for moves/corrections.
3. Stay: "Ward notes"; "Drug chart" (doctor orders, nurse records doses); deposit "Take deposit & print receipt" — Deposit / Used / Left, warning below deposit_low_at (₹2,000 default, owner sets); ward medicine requests → pharmacy issues earliest-expiry-first → on the stay bill; lab tests during stay → on the stay.
4. Bed charges: "Post bed charge" in Billing (NOT automatic); part day = full day at the rate of each bed; re-post replaces; refused after a bill is issued.
5. Discharge (clinical staff) → "Discharge summary" (doctor writes, issues, send as link).
6. Final bill: Billing → "Issue a bill" scoped to the admission; deposits count as paid. Medicines statement /business/print/ipd-medicines/:id.
IPD add-on "IPD + Pharmacy" ₹2,000/month with 20 beds included, ₹100/bed/month beyond (admin settings).

## Doctor → bill (automatic lines)
OPD fee: yes (token from Queue/Patients). Referral fee: yes. Lab tests/packages + home-visit fee: yes when ordered. Bed days: only on "Post bed charge". IPD medicines from pharmacy: yes. OPD prescription: not billed — goes to pharmacy "Prescriptions waiting"; pharmacy bill marks dispensed. Procedures/operations: manual ("Add a charge" or counter-invoice price list).
Billing screen: Charged / Paid / Balance due ("In advance"); Counter invoice (price list, optional GST per line, numbered bill + payment in one step); Add a charge (Consultation, Bed, Procedure, Medicine, Test, Consumable, Optical/products, Other); Record a payment (split); Issue a bill (freezes charges; discount and round-off).
Rules: discount reasons enforced everywhere (consultation, bill, counter invoice, pharmacy) and shown in "Discounts given"; payment methods cash, UPI, credit card, debit card, net banking, cheque, other — each records who took it; only owner/manager edit or delete payments (logged); refunds owner/manager/doctor.
Collections tab: every payment by person and method (clinic + pharmacy), charged vs collected, change log, CSV; owner/manager see all, others their own.
GST: patient bills no GST except counter-invoice lines with a rate; pharmacy bills own series, GST only with pharmacy_gstin (out of MRP). No clinic GST export.
Pharmacy tab: New bill, Ward requests, Bills, Dues, Stock; Purchases, Stock report, Summary (managers); Settings (owner/manager). FEFO. Counter staff can't type a price. Pharmacy bills printed, not sent.

## Roles
Owner: everything (Plan, Bills, WhatsApp, Website, leave). Manager: reception + nurse work for all patients, staff, stock, Clinic and Doctors tabs; reads record, can't prescribe; no Plan/WhatsApp. Doctor: full record for own patients (until referred/booked), prescribes, Reports, Patient report, My practice. Nurse: registration, queue, vitals, ward charts for linked doctors; can't prescribe. Reception: Today, Queue, Appointments, Patients (register + bill), Beds, Collections; no medical notes or reports. Lab technician: Lab tab only. Pharmacist/delivery: pharmacy listings.
Staff added in Clinic → "Your team" (confirmed by a code emailed to the person making the change).
Multi-clinic: one doctor login across clinics (invitation); a booking at one clinic blocks the slot at the others; leave entered once applies everywhere (or one clinic only); bookings on leave listed for rescheduling.
Reports: Patient report (owner/manager/doctor) — patients, new, returning, follow-ups due/missed; by city/PIN, age, gender, source, doctor, diagnoses, busiest times; "Patients to invite back" (6–18 months). Reports (owner/doctor): reach, bookings, areas, billing. Doctors (owner/manager): side by side with patients, earnings, discounts. Collections.
