# Treatment on EMI — Phase 1 plan

Status: 16 Nov 2026 — step 1 (database, 0326) built and applied to SANDBOX only, tested end to end. Not on prod.
21 Nov 2026 — step 2 (hospital EMI panel) built: `src/pages/doctor/EmiPanel.tsx`, `src/lib/financeApi.ts`, EMI tab in the
business dashboard (hospitals/clinics, only while `finance_enabled` is on), "EMI" button on occupied beds. No migration.
Tested as a hospital owner on sandbox in a rolled-back transaction.
21 Nov 2026 — step 3, part 1: patient page `/emi/<token>` (`src/pages/EmiTrack.tsx`: consent, choose 1–2 lenders,
tracking, withdraw; Hindi + English), hospital "Send on WhatsApp" / "Copy link" in the EMI panel, and the five EMI
templates in `docs/whatsapp-templates.md` (names: emi_request_link, emi_status, emi_hospital_action, emi_new_case,
emi_disbursed). Part 2 still to do: patient asks for EMI in My Sehatsandhi and the WhatsApp bot (needs a small
migration: hospitals offering EMI, my cases), and automatic sends once Meta approves the templates.
21 Nov 2026 — step 3, part 2: My Sehatsandhi → Treatment on EMI (`/my/emi`, `src/pages/my/MyEmi.tsx`: ask a
hospital — hospital, treatment, amount — and list my requests; tile only while EMI is on); WhatsApp bot: "🏦 इलाज EMI पर"
menu row and typed "EMI" / "loan" / "लोन" (same three questions, then the patient's link). Migrations 0327
(sehat_finance_hospitals, sehat_finance_my_cases) and 0328 (bot_emi_hospitals_json, bot_emi_request_json), applied to
SANDBOX only. Left in step 3: automatic WhatsApp sends once Meta approves the templates. No lender signed yet — build on staging/sandbox
with a test lender; turn on in production only after the first real lender agreement.

## Goal

A patient who can't pay up front gets an EMI loan from a regulated lender, and the money goes
**straight from the lender to the hospital**. Sehatsandhi connects the three parties and tracks
the case. Sehatsandhi is never the lender, never holds the money, never decides credit and never
collects repayments.

## The three parties and the finance case

One **finance case** per request, visible to each party in their own login.

- **Hospital / clinic** (existing business, vertical `clinic` or `hospital`): starts a case
  ("Offer EMI") or confirms one a patient started; confirms the treatment + estimate; confirms
  admission; sees the payment arrive.
- **Patient** (WhatsApp + My Sehatsandhi): starts a case or accepts the hospital's offer; gives
  consent; picks lender(s); does KYC and e-sign **in the lender's own journey**; tracks status.
- **Lender** (new vertical `lender`, logs in like any business): sees only cases a patient chose
  to share with it; approves the hospital as a payee the first time; posts offer / sanction /
  decline / disbursal.

Money moves only after: hospital confirmed → patient consented and accepted → lender sanctioned →
hospital confirmed admission/date → lender disburses to hospital.

### Statuses

`requested` → `hospital_confirmed` → `shared` (patient consented, sent to 1–2 lenders) →
`offered` → `sanctioned` (the patient's acceptance/e-sign happens inside the lender's journey) →
`disbursed` (lender, with UTR) → `closed` (hospital confirms the money arrived — that records the
`finance` payment, so lenders never write into a hospital's books); side exits `declined`,
`withdrawn` (patient or hospital), `expired` (no action in 15 days).

## What goes where (documents)

| Data | Path |
|---|---|
| Patient KYC / credit (Aadhaar, PAN, bank statement, selfie, mandate) | Patient → lender directly. **Never collected or stored by us.** |
| Treatment + estimate (type, amount, admission date, hospital confirmation) | Created in Sehatsandhi, shared with the chosen lender on patient consent. No medical records. |
| Hospital business details (name, registration, GSTIN, address, verified status) | From Sehatsandhi, shared once per lender with the hospital's one-click permission. |
| Hospital bank account | **Decision needed** (see below). |
| Lender ↔ hospital agreement | Lender's own e-sign; we record "agreement done" + date. |

## Database (one migration, `0326_finance_emi.sql`, sandbox first)

- `businesses.vertical` += `'lender'`.
- `lender_profiles` — business_id, legal entity type (bank / NBFC), RBI registration no.,
  grievance officer (name, email, phone), headline terms (interest range text, min/max amount,
  tenures), `pays_to` (`hospital` | `patient`), optional referral URL template, commission %
  (admin-set), status `pending | approved | suspended`, approved_by/at.
- `lender_hospital_links` — lender_id, business_id, status `requested | approved | rejected`,
  who asked, approved_at, `no_cost_emi` + subvention note (optional), agreement_done_at.
- `finance_cases` — case_no, business_id (hospital), patient_member_id, patient name + phone,
  treatment (text) + category, estimate_amount, requested_amount, planned date, started_by
  (`patient | hospital`), status, hospital_confirmed_at/by, links to admission / planned surgery /
  bill, closed_at, public_token (patient tracking page).
- `finance_case_lenders` — case_id, lender_id, shared_at, consent ref, lender status
  (`shared | offered | declined | sanctioned | disbursed | withdrawn`), lender_ref, offer summary
  (amount, tenure, EMI — info only, lender's numbers), disbursed_amount, disbursed_at, UTR.
  (Phase 1 allows up to 2 lenders per case.)
- `finance_case_events` — audit log: every status change, every view by a lender, who/when.
- `patient_consents` (exists) — one row per consent, with the exact consent text version and
  which lenders.
- `patient_payments.method` += `'finance'`; on `disbursed`, the hospital's bill gets a payment
  row "Finance — <lender>, ref <lender_ref>, UTR".
- `site_settings` switch `finance_enabled` (off by default, like the insurance switch) +
  per-hospital opt-in.

Access rules (RLS): hospital sees its own cases; lender sees **only** cases shared with it, through
a view/RPC exposing the minimal columns; patient sees own cases. No lender can list patients or
search the patient base.

## Screens

**Hospital dashboard — "EMI" panel**
- Case list by status; "Offer EMI" button on admission, planned surgery and bill.
- New case form: treatment, estimate amount, planned date (pre-filled from the admission /
  surgery where possible).
- Confirm / edit estimate on patient-started cases; confirm admission; see lender statuses.
- Lenders tab: lenders available, link status, request a lender; share business details.

**Patient — WhatsApp + My Sehatsandhi**
- Bot intent "EMI / loan for treatment": asks only hospital, treatment, amount (short, per bot
  rules); hospital gets a confirm request.
- Consent page (tokenised link): what is shared, with which lender, "Loan by <Lender>, an
  RBI-regulated <bank/NBFC>. Sehatsandhi is not a lender and charges you nothing."
- Choose up to 2 lenders → button opens the lender's own journey.
- Tracking page: Requested → … → Paid to hospital.

**Lender dashboard (new, vertical `lender`)**
- Inbox of shared cases; case detail (minimal fields + hospital confirmation).
- First case at a hospital: hospital business details + "Approve as payee".
- Post status: offer / declined (reason) / sanctioned / disbursed (amount, date, UTR).
- Hospitals: links, requests, invite a hospital already on Sehatsandhi.
- Reports: cases, approval rate, disbursed value, commission statement.

**Admin**
- Approve lenders (check RBI registration and that we are listed as their sourcing partner/LSP),
  set commission %, suspend.
- All cases, stuck-case list, monthly commission invoice to each lender (existing GST invoices).

## WhatsApp templates (Meta approval needed — a few days, utility category)

`emi_offer` (hospital → patient, with link), `emi_status` (patient updates),
`emi_hospital_confirm` (to hospital staff), `emi_new_case` (to lender), `emi_disbursed` (to
hospital + patient). Sent from the main number.

## Compliance built in

- No pass-through: lender pays hospital (or patient, for `pays_to = patient` lenders, shown as a
  fallback only). Sehatsandhi never receives loan money.
- Commission paid by the lender only; patients pay Sehatsandhi nothing.
- Lender disclaimer + grievance contact on every patient screen; lender shows its own Key Fact
  Statement.
- Consent before any sharing; data minimised; every lender view logged; patient can withdraw
  before sanction.
- Signed sourcing (LSP) agreement with each lender before it goes live; lawyer review of that
  agreement.
- We never do KYC, credit decisions or recovery.

## Build order (≈ 2–3 weeks on staging)

1. Migration + RLS + test lender in sandbox.
2. Hospital EMI panel + estimate/confirm flow.
3. Patient consent + tracking page (+ WhatsApp intent, templates submitted to Meta early).
4. Lender dashboard (inbox, payee approval, status posting).
5. Admin lender approval + commission report.
6. "Finance" payment on the bill at disbursal.
7. Test end to end on staging with the test lender; production stays switched off.

## Decisions (Nitin, 16 Nov 2026 — all as recommended)

1. Hospital bank account: **the lender collects it** in its own merchant onboarding.
2. **Hospitals + clinics only** at first.
3. Minimum **₹10,000**.
4. **Free for hospitals** at launch; we earn the lender's commission.
5. Lenders that pay the patient: **allowed as a fallback**, listed after hospital-paying lenders.
