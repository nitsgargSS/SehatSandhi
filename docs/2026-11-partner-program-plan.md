# Care Partner Program — build plan (for approval)

Status: 22 Nov 2026 — plan approved; Phase 1 built (uncommitted until Nitin says).
Phase 1 = migration 0331 (applied to SANDBOX only) + function partner-otp (not deployed yet) + pages /partner,
/partner/how-it-works, /partner/login, /partner/register, /partner/learn, /partner/help + Admin → Care Partners
(Partners, Modules, FAQ, Contracts, Settings). Tables are named care_partner_* (care_modules already exists: it is
the clinic's OPD/IPD module list). For Phase 2's migration: revoke anon on care_partner* tables (anon gets 0 rows
today, not an error), and change synonym 'paisa' from fee to payout. (Both done in 0332.)
Phase 2 built 22 Nov: 0332 (sandbox only) — care_partner_questions (answer key readable by admins only), care_partner_attempts,
sehat_care_quiz_start/submit/state, server grading, waits (48 h; 7 days after every 3rd fail), an attempt left open past
60 min counts as a fail, module publish needs enough active questions, final pass → quiz_passed. Pages /partner/quiz/:slug,
/partner/exam; Learn shows quiz state and the final exam; Admin → Care Partners → Questions (editor + CSV import,
template docs/partner-quiz-questions-template.csv). For Phase 3's migration: in sehat_care_quiz_wait order the last attempt
by started_at, not submitted_at (robustness; real use is already correct). (Done in 0333.)
Phase 3 built 22 Nov: 0333 (sandbox only) — payments.type 'partner_fee' + care_partner_id; marketing_partners kind 'care';
sehat_care_fee_prepare (₹ fee all-taxes-included, GST backed out, IGST across states) → function partner-fee-order →
razorpay-verify/webhook → fulfilPayment (new partner_fee branch) → sehat_care_fee_paid: Partner ID SP-XXXXXX, the
marketing_partners row, the fee invoice (same series, B2C, SAC setting partner_fee_sac 999293 — CHECK with CA), valid 12 months,
receipt email. /verify/<ID> (public). care_partner_acceptances + sehat_care_accept (all current contracts, WhatsApp code) →
active; a new current version asks again. Tickets (care_partner_tickets/_messages) for partner and admin.
Pages: /partner/certify (+ /partner/pay), /partner/agreement, /partner/dashboard (badge PNG with QR), /partner/tickets,
/verify/:code. Admin → Care Partners → Tickets. Deploy to sandbox: partner-otp, partner-fee-order, razorpay-verify,
razorpay-webhook (fulfilment changed).
Phase 4 built 22 Nov: 0334 (sandbox only) — care_partner_leads (keyed phone hash, key in Vault 'care_lead_pepper'; name +
last 2 digits wiped when the lock ends), lead cap (10 → 25 → 50 → none at Senior), lockable = not a business/practitioner/
partner number (generic refusal), 0255 credits: status 'care_pending' + care_* columns, trigger: an active lock on a new
business's number → care_pending (agency kept as fallback), Yes → approved (automatic), No/expiry → 0255 rule, typed Partner ID
before first payment (self-referral refused), admin claim within partner_claim_days, care_partner_reports, nightly cron
'care-leads-expiry'. Wizard: Partner ID box + Referred-by question before payment (quiet on any failure); dashboard card
(question / introduced by / Report). Partner dashboard: reserved doctors + businesses introduced. Admin: Reports + Claim.
Fixed before commit: sehat_care_owner_only let a stranger through (null-unsafe check) — now coalesce(...); sandbox ledger
checksum for 0334 updated to the fixed file.
Phase 5 built 22 Nov: 0335 (sandbox only) — payments.refunded_amount/refunded_at/razorpay_refund_ids; refund.processed in
razorpay-webhook + admin record refund; 0255 agency lines now include online refunds. care_partner_rewards (start 15/20/25 % by
level within 12 months of confirmation, cap ₹15,000 per business; renewal 10 % unless lapse > grace; only period_months = 12;
pending → approved nightly after the refund window → paid with the statement; refunds reverse/scale pending, clawback approved).
Care statements use 0255: lines = approved, unstated rewards (carried forward); BEFORE INSERT checks KYC verified, current
contracts accepted, min payout, and sets TDS (partner_tds_rate 2 %, threshold ₹20,000 per FY — CHECK with CA); AFTER triggers
mark rewards on the statement / paid. KYC: PAN + bank JSON in Vault ('care_kyc_<partner id>'), keyed hashes unique (no shared
PAN/bank), last 4 in the table; full values + payout export only for admin role 'owner', logged. Nightly cron
'care-rewards-nightly' (approvals + levels: senior 10, elite 30 active businesses; no move up with an open report).
fulfilPayment calls sehat_care_reward_for_payment. UI: partner dashboard Rewards, PAN/bank, statements; Admin → Care Partners
→ Payouts (owed, KYC queue, statements, bank CSV, record refund). Razorpay dashboard: subscribe the webhook to refund.processed.
Payout month (Nitin, 22 Nov): monthly payouts; payment on or before the 15th (partner_payout_cutoff_day) → that month's payout,
after → next month's; approval 15 days after the payment (Nitin changed 14 → 15 to match the cut-off); clawbacks in the refund's month. care_partner_rewards.payout_month.
Added to 0335 before commit; sandbox re-run and ledger checksum updated.
Decisions (Nitin, 22 Nov): 1 fix online refunds — yes; 2 confirmed Care Partner credit approved automatically, admin can override; 3 new Care Partners tab for operations, money in Partners — OK; 6 active = paid term not ended — OK. Not answered yet: 4 (active field/agency partners — needed before Phase 4), 5 (production order vs EMI — default: partner migrations independent of 0330), 7 (who uploads videos/PDFs — CMS built either way). Brief: https://claude.ai/artifact/Wc4MJ5dGZBzQeATsbtyJKj
(v2, consolidated; `Sehatsandhi_Partner_Program_Claude_Code_Brief.md` + `Sehatsandhi_Partner_FAQ_Seed.csv`).
Built on staging / sandbox only, behind `site_settings` switch `partner_program_enabled` (off).

## 1. What already exists and is reused

| Need in the brief | Existing piece | How it is used |
|---|---|---|
| Partner money system | 0255: `marketing_partners` (kind online/field, code), `marketing_partner_rates`, `business_partner_credits` (business_id is the PK → one partner per business), `marketing_statements` (draft → final → paid, paid_reference), `marketing_statement_exclusions`; Admin → Partners | Care Partners become a third `kind = 'care'` row in `marketing_partners` (code = `SP-XXXXXX`), created when the Partner ID is issued. Same credits table, same statements, same "mark paid with reference" screen. |
| One partner per business | `business_partner_credits.business_id` PK | Already enforced. Add statuses for Care Partners (below). |
| Agency proposal | trigger `businesses_partner_proposed` (after insert on businesses) | Changed: if an active Care lock matches the new business's phone, the credit is `care_pending` (not proposed to the agency) until Yes / No / lock expiry. |
| Login | `patient-otp` (WhatsApp code, `login_codes`, synthetic email, magic-link session) | New `partner-otp` copied from it: `@partner.sehatsandhi.in` emails, own echo flag and rate limits; `login_codes` gets an `audience` column so codes never cross between logins. Same approved `login_code` template. |
| Settings + switches | `site_settings` + `sehat_*_enabled()` + hook pattern (`useInsurance.ts`) | All OPEN values become `site_settings` keys (`partner_*`); `sehat_partner_program_enabled()`. |
| Audit | `staff_activity` + `sehat_log_staff_action()` | Every admin and money action. |
| Admin | `admin_users`, `sehat_is_admin()`, Dashboard tabs | New tab **Care Partners** (program operations). Money stays in the existing **Partners** tab. |
| Payments | `razorpay-order/verify/webhook`, `fulfilPayment` | Certification fee = a new payment `type 'partner_fee'` through its own small order function; fulfilment issues the Partner ID. Rewards hook after `sehat_redeem_coupon` in `fulfilPayment`, idempotent on payment id. |
| Invoices | `invoices`, number series, `/invoice/<token>`, GST export | Certification fee invoice to the partner (B2C, no GSTIN) in the same series. |
| Email | ZeptoMail `_shared/email.ts` | Receipts, statements, notices (Hindi + English, plain text). |
| Encrypted values | Supabase Vault (already used for clinic WhatsApp tokens, 0261) | PAN and bank details as Vault secrets per partner; table keeps hash + last 4 + verified flag only. |
| Private files | private buckets + `createSignedUrl` (lab files) | New private bucket `partner-content` for module PDFs and contracts. |
| Public pages | `src/prerender.tsx` | `/partner` landing and how-it-works prerendered; `/verify/:id` a normal app page. |
| Tests | `scripts/test-suite.mjs` style (live sandbox, rolled back) | New `scripts/test-partners.mjs` covering the brief's acceptance checks. |
| Sandbox purge | `scripts/gen-purge-manifest.mjs` | New tables added to the manifest. |

Names: "partner" is already used three ways (0255 marketing partners, metric "partners" = businesses, international partners). New tables use the prefix **`care_partner_`** (plus `care_partners`); routes `/partner/*` are free.

## 2. Conflicts and gaps found in the code

1. **Online refunds are never recorded.** `payments.status` is only pending/paid/failed; `razorpay-webhook` ignores refund events; 0255 claws back only offline refunds. The brief needs refunded payments to reverse rewards. Fix (also fixes the agency scheme): `payments.refunded_amount / refunded_at`, handle Razorpay `refund.processed` in the webhook, and an admin "record refund" action.
2. **12-month detection.** Every add-on order is stored with `period_months` = the plan's term (often 12) and `subscription_amount = 0`, charged pro rata. Rule used: a plan or renewal payment counts when `subscription_amount > 0` and `period_months = 12`; an add-on (`subscription_amount = 0`) counts when the business's current term is 12 months (brief §2). WhatsApp wallet top-ups never reach the hook.
3. **0255 computes lines live each month** and has no per-payment state. Care Partners need pending → approved → paid → reversed, Start vs Renewal rates, a cap and levels. Plan: a persisted **`care_reward_lines`** ledger (one row per eligible payment, plus clawback rows); the monthly statement for a `care` partner is built from its approved lines, finalised and marked paid exactly like today. The agency's live calculation stays unchanged.
4. **Phone at sign-up is not verified** (`PHONE_VERIFY_ENABLED` is off). The "Referred by…? Yes/No" step trusts the typed number. Acceptable because a real payment follows, but worth knowing.
5. **EMI migration 0330 changes `invoices`** (`invoice_kind`). It is on sandbox only. If the Partner Program reaches production before EMI, its migrations must not depend on 0330 — see question 5.
6. **Doctor vs staff check.** "Block numbers of doctors and business owners" = `businesses.phone`, and `practitioners` whose role at any business is `doctor`. Other staff (receptionist, manager, nurse…) may register, never for their own business.

## 3. Migrations (one per phase, numbers from 0331, sandbox only)

- **0331 Phase 1 — core and learning:** settings keys + `sehat_partner_program_enabled()`; `login_codes.audience`; `care_partners` (status machine, eligibility answers, DOB, language, `marketing_partner_id`); `care_modules`, `care_module_progress`; `care_contracts`, `care_contract_acceptances`; `care_faq`, `care_faq_synonyms` (Help Center); bucket `partner-content`; RPCs: register (eligibility checks), my status / next step, progress marking, admin CMS. Seed: 10 modules (unpublished), 29 FAQs, contract placeholders, settings.
- **0332 Phase 2 — quizzes:** `care_quiz_questions` (correct answers never exposed), `care_quiz_attempts`; RPCs start / submit (server grading, retake waits, 3-fail rule), CSV import.
- **0333 Phase 3 — certification:** payment `type 'partner_fee'`; Partner ID issue on payment (creates the `marketing_partners` kind `care` row); `/verify` RPC; agreement acceptance with WhatsApp code; `care_tickets`, `care_ticket_messages`; fee invoice.
- **0334 Phase 4 — attribution:** `care_leads` (keyed phone hash, name, last 2 digits; deleted when the lock ends); lead cap; `business_partner_credits` statuses `care_pending` / `care_confirmed` / `care_declined`; changed proposal trigger; wizard/checkout Partner ID + Yes/No RPCs; do-not-contact and report.
- **0335 Phase 5 — rewards and payouts:** payments refund columns + webhook refund handling; `care_reward_lines`; `create_reward_for_payment()`; nightly approve job; statement build for care partners; PAN/bank in Vault, verify, payout export (owner only, logged); TDS fields on statements.

New Edge Functions: `partner-otp`, `partner-fee-order` (verification reuses `razorpay-verify`/webhook → `fulfilPayment`). Changed: `fulfilPayment`, `razorpay-webhook` (refunds).

## 4. Questions for Nitin (answers go into the brief / this file)

1. Fix the online refund gap as part of this (it also corrects the agency partner statements)?
2. Should a confirmed Care Partner credit still need admin approval (like agency credits today), or be approved automatically with admin able to override? Recommended: automatic, admin can override.
3. Admin: new "Care Partners" tab for operations (partners, training CMS, quizzes, contracts, tickets, settings), money in the existing "Partners" tab — OK?
4. Are there any active **field** partners today, and is the online agency active? (Decides how careful the trigger change must be.)
5. Production order: will EMI (0326–0330) go to production before the Partner Program? If not sure, I keep the partner migrations independent of 0330 (the fee invoice then uses the existing invoice columns only).
6. Level "active businesses" = businesses with a paid term that has not ended. OK?
7. Videos: hosted on a Sehatsandhi YouTube channel as unlisted videos? Who uploads them and the PDFs (admin CMS is built either way)?
