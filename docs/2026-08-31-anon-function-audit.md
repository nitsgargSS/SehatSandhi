# Which SECURITY DEFINER functions anon could call — the audit

**Date:** 2026-08-31 · **Migrations:** `0087`, `0088`, `0089`
**Scope:** every `sehat_*` SECURITY DEFINER function on production

## The short version

Production had **56** SECURITY DEFINER functions executable by `anon`
(11 trigger functions + 45 callable RPCs). After this audit, **18 remain
reachable and every one of them is deliberate.**

**No data was exposed.** All 27 functions closed here already refused an
anonymous caller — probed one by one on sandbox in rolled-back transactions.
This is defence in depth, not an incident. The refusals lived in 27 separate
function bodies; a privilege that was never granted cannot be edited away.

## Why every previous fix failed

Migrations here end with `revoke all on function … from anon`. That has never
worked, and 0064 said so in 2026. What 0064 also got right, and everything
since forgot, is that there are **two** grants:

| Grant | Where it comes from | Removed by |
|---|---|---|
| `PUBLIC` | Postgres grants EXECUTE on every new function to PUBLIC | `revoke … from public` |
| explicit `anon=X` | Supabase's `ALTER DEFAULT PRIVILEGES` on schema `public` | `revoke … from anon` |

Measured on production: all 56 were reachable through PUBLIC, and **39 also
carried the explicit anon grant**. Revoking one leaves the other. The only
correct form is:

```sql
revoke all on function foo(args) from public, anon;
```

## Why this is not a clean sweep

Nine functions are the helpers RLS policies are *written in terms of* —
`sehat_caller_owns_business` appears in **47** policies, `sehat_caller_is_clinical`
in 34, `sehat_is_admin` in 28. A policy calls them as the **querying role**, so
anon needs EXECUTE for an anonymous read to evaluate at all.

Measured, not assumed:

```
before revoke:  anon select from business_patients  →  0 rows
after  revoke:  anon select from business_patients  →  ERROR 42501
                permission denied for function sehat_caller_owns_business
```

A blind sweep would replace every silent, correct, empty result on the public
site with a hard error. **Those nine keep the grant, and their returning
`false` for anon is exactly what makes that safe: they are the gate, not a hole
in it.**

## What was closed (27)

| Group | Functions | Why it mattered |
|---|---|---|
| Document issuing | `issue_prescription`, `issue_patient_bill`, `issue_discharge_summary`, `issue_token` | mint clinical and statutory documents against a business |
| Money on an admission | `post_bed_charges`, `cancel_patient_bill`, `correct_bed_stay`, `undo_bed_move` | move money |
| Retention | `set_legal_hold`, `reapply_retention` | change what gets deleted |
| Auth state | `password_changed`, `require_password_change`, `password_expired`, `password_state`, `caller_password_expired` | touch or probe auth state |
| Business intelligence | `demand_report`, `platform_report` | platform-wide signups, revenue, demand by pincode |
| Roster / clinical ops | `admit_patient`, `call_next`, `attach_practitioner`, `detach_practitioner`, `set_primary_affiliation`, `set_token_status` | act on a clinic |
| Small disclosure oracles | `bed_stay_is_billed`, `business_has_module`, `business_doctor_count`, `caller_role` | answer questions about a business one id at a time |

`0089` adds two more from the unshipped launch-offer work: `queue_billing_notices`
(volatile, **writes**, ran as anon on sandbox — the cron's to call and nobody
else's) and `set_auto_renew`.

## What stays open, deliberately (18)

**RLS helpers (9)** — revoking breaks anonymous reads, as measured above:
`caller_owns_business`, `caller_is_clinical`, `is_admin`, `caller_business_ids`,
`caller_is_business`, `caller_manages_business`, `caller_practitioner_ids`,
`caller_may_set_hours`, `caller_may_edit_practitioner`

**Genuinely anonymous paths (9)** — unchanged from 0064's list:
registration on the anon key (`register_business`, `register_business_with_doctors`,
`register_practitioner`), the public directory (`search_practitioners`), visitor
analytics (`record_visitor_location`), slot display (`open_windows`,
`governing_windows`, `slot_end`), public pricing (`active_pricing_plan`).
Sandbox adds `plan_terms` / `plan_term_price` for the same reason.

**Not included:** the 11 trigger functions. They return `trigger`, so PostgREST
will not expose them and a direct call fails without trigger context; Postgres
does not check EXECUTE when firing a trigger, so revoking is a no-op with a
small chance of surprise.

## A trap worth naming

The first automated pass classified SQLSTATE **42501** as "the privilege system
refused". A function raising `using errcode = '42501'` produces the identical
code — so seven functions looked protected by grants when they were only
protected by their own guards. `has_function_privilege()` answers *may they call
it*; the exception only answers *what happens when they do*.

## Verification

- 27 closed functions: anon blocked, `authenticated` still permitted
- 18 kept functions: anon still permitted
- anonymous reads on `businesses`, `practitioners`, `service_areas`,
  `business_patients` all still evaluate (no 42501)
- over PostgREST: anonymous visitor can still read the directory, search
  practitioners and see pricing; is refused on `issue_prescription`,
  `platform_report`, `demand_report`, `queue_billing_notices`, `caller_role`
- signed-in doctor: role lookup, password state, patient search, diagnosis
  search and patient reads all still work
- full suite: 274 checks

One suite assertion changed: `anon gets no role` expected `null` and now sees a
refusal. It accepts either, since being refused is the stronger guarantee and
`getMyRole()` already treats an error as "no role".
