-- ============================================================================
-- Sehatsandhi — the audit 0087 asked for: 27 functions closed, 18 left open
--
-- Run AFTER 0087. Safe to re-run.
--
-- 0064 revoked twelve dangerous functions from PUBLIC and listed the rest for
-- "whoever picks this up next". 0087 found the idiom had been copied into every
-- migration since and left 56 SECURITY DEFINER functions callable by anon on
-- production. This is that audit, done one function at a time as 0064 said it
-- had to be.
--
-- ── TWO GRANTS, NOT ONE ─────────────────────────────────────────────────────
-- Worth stating plainly because 0087 got it half right by luck. Supabase sets
-- ALTER DEFAULT PRIVILEGES on schema public granting EXECUTE to anon:
--
--   defaclobjtype=f  acl={postgres=X/…,anon=X/…,authenticated=X/…,service_role=X/…}
--
-- So a new function carries TWO grants that reach anon — the PUBLIC one every
-- Postgres function gets, and an explicit anon=X from that default. Measured on
-- production: all 56 were reachable through PUBLIC, and 39 also had the explicit
-- grant. `revoke from public` alone leaves the second; `revoke from anon` alone
-- leaves the first. Both are needed, which is what 0064 wrote and what every
-- migration since has forgotten. Every statement below revokes from both.
--
-- ── WHY THIS IS NOT A CLEAN SWEEP ───────────────────────────────────────────
-- Nine of the 56 are the helpers RLS policies are written in terms of:
-- sehat_caller_owns_business appears in 47 policies, sehat_caller_is_clinical in
-- 34, sehat_is_admin in 28. A policy calls them as the QUERYING role, so anon
-- needs EXECUTE for an anonymous read to evaluate at all. Revoking does not
-- return fewer rows — it raises. Measured, not assumed:
--
--   before:  anon select from business_patients  →  0 rows
--   after:   anon select from business_patients  →  ERROR 42501
--            permission denied for function sehat_caller_owns_business
--
-- A clean sweep would therefore replace every silent, correct, empty result on
-- the public site with a hard error. Those nine keep the grant, and their
-- returning false for anon is exactly what makes that safe: they are the gate,
-- not a hole in it.
--
-- Nine more are the genuinely anonymous paths, unchanged from 0064's list:
-- registration on the anon key (three), the public practitioner directory, the
-- visitor-location analytics, the slot windows and the public pricing plan.
--
-- ── WHAT THE 27 BELOW HAD IN COMMON ─────────────────────────────────────────
-- Every one of them already refuses an anonymous caller — probed on sandbox in
-- rolled-back transactions, all 27 either raised on an ownership check ("not
-- your business", "no such admission") or returned null/false/zero. So this is
-- defence in depth and not an incident. It is still worth doing: the refusals
-- live in 27 separate function bodies, and one careless edit to any of them is
-- the difference between a check and a hole. A privilege that was never granted
-- cannot be forgotten.
--
-- The ones whose refusal was doing real work, had the grant not been there:
--   sehat_issue_prescription / _patient_bill / _discharge_summary / _token
--     mint clinical and statutory documents against a business
--   sehat_post_bed_charges, sehat_cancel_patient_bill, sehat_correct_bed_stay,
--   sehat_undo_bed_move   move money on an admission
--   sehat_set_legal_hold, sehat_reapply_retention   change what gets deleted
--   sehat_password_changed, sehat_require_password_change   touch auth state
--   sehat_demand_report, sehat_platform_report   whole-platform business
--     intelligence: signups, revenue and demand by pincode
--
-- ── NOT INCLUDED ────────────────────────────────────────────────────────────
-- The 11 trigger functions. They return `trigger`, so PostgREST will not expose
-- them and a direct call fails without trigger context; and Postgres does not
-- check EXECUTE when firing a trigger, so revoking would be a no-op with a
-- small chance of surprise. Left alone deliberately rather than overlooked.
-- ============================================================================


revoke all on function sehat_admit_patient(p_patient_member_id uuid, p_business_id uuid, p_bed_id uuid, p_attending_practitioner_id uuid, p_reason text, p_admitting_diagnosis text, p_expected_discharge date) from public, anon;
revoke all on function sehat_attach_practitioner(p_business_id uuid, p_practitioner_id uuid, p_role text, p_is_primary boolean, p_consultation_fee integer) from public, anon;
revoke all on function sehat_bed_stay_is_billed(p_admission_id uuid) from public, anon;
revoke all on function sehat_business_doctor_count(p_business_id uuid) from public, anon;
revoke all on function sehat_business_has_module(p_business uuid, p_code text) from public, anon;
revoke all on function sehat_call_next(p_business_id uuid, p_practitioner_id uuid) from public, anon;
revoke all on function sehat_caller_password_expired() from public, anon;
revoke all on function sehat_caller_role(p_business uuid) from public, anon;
revoke all on function sehat_cancel_patient_bill(p_bill_id uuid, p_reason text) from public, anon;
revoke all on function sehat_correct_bed_stay(p_stay_id uuid, p_reason text, p_from_at timestamp with time zone, p_to_at timestamp with time zone, p_bed_id uuid, p_corrected_by uuid) from public, anon;
revoke all on function sehat_demand_report(p_days integer) from public, anon;
revoke all on function sehat_detach_practitioner(p_business_id uuid, p_practitioner_id uuid) from public, anon;
revoke all on function sehat_issue_discharge_summary(p_admission_id uuid, p_practitioner_id uuid, p_course_in_hospital text, p_investigations text, p_procedures text, p_advice text, p_diet_advice text, p_activity_advice text, p_warning_signs text, p_follow_up_with text, p_prescription_id uuid, p_supersedes uuid) from public, anon;
revoke all on function sehat_issue_patient_bill(p_patient_member_id uuid, p_business_id uuid, p_admission_id uuid, p_visit_id uuid, p_discount numeric, p_discount_reason text, p_round_off numeric, p_issued_by uuid, p_supersedes uuid) from public, anon;
revoke all on function sehat_issue_prescription(p_patient_member_id uuid, p_business_id uuid, p_practitioner_id uuid, p_items jsonb, p_visit_id uuid, p_diagnosis text, p_advice text, p_follow_up date, p_source_recording_id uuid, p_supersedes uuid) from public, anon;
revoke all on function sehat_issue_token(p_patient_member_id uuid, p_business_id uuid, p_practitioner_id uuid, p_reason text, p_appointment_id uuid, p_priority integer, p_priority_reason text, p_created_by uuid) from public, anon;
revoke all on function sehat_password_changed() from public, anon;
revoke all on function sehat_password_expired(p_auth_uid uuid) from public, anon;
revoke all on function sehat_password_state() from public, anon;
revoke all on function sehat_platform_report(p_days integer) from public, anon;
revoke all on function sehat_post_bed_charges(p_admission_id uuid) from public, anon;
revoke all on function sehat_reapply_retention(p_business uuid) from public, anon;
revoke all on function sehat_require_password_change(p_auth_uid uuid, p_reason text) from public, anon;
revoke all on function sehat_set_legal_hold(p_document_id uuid, p_hold boolean, p_reason text) from public, anon;
revoke all on function sehat_set_primary_affiliation(p_practitioner_id uuid, p_business_id uuid) from public, anon;
revoke all on function sehat_set_token_status(p_token_id uuid, p_status text, p_visit_id uuid) from public, anon;
revoke all on function sehat_undo_bed_move(p_stay_id uuid, p_reason text, p_corrected_by uuid) from public, anon;

grant execute on function sehat_admit_patient(p_patient_member_id uuid, p_business_id uuid, p_bed_id uuid, p_attending_practitioner_id uuid, p_reason text, p_admitting_diagnosis text, p_expected_discharge date) to authenticated;
grant execute on function sehat_attach_practitioner(p_business_id uuid, p_practitioner_id uuid, p_role text, p_is_primary boolean, p_consultation_fee integer) to authenticated;
grant execute on function sehat_bed_stay_is_billed(p_admission_id uuid) to authenticated;
grant execute on function sehat_business_doctor_count(p_business_id uuid) to authenticated, service_role;
grant execute on function sehat_business_has_module(p_business uuid, p_code text) to authenticated;
grant execute on function sehat_call_next(p_business_id uuid, p_practitioner_id uuid) to authenticated;
grant execute on function sehat_caller_password_expired() to authenticated;
grant execute on function sehat_caller_role(p_business uuid) to authenticated;
grant execute on function sehat_cancel_patient_bill(p_bill_id uuid, p_reason text) to authenticated;
grant execute on function sehat_correct_bed_stay(p_stay_id uuid, p_reason text, p_from_at timestamp with time zone, p_to_at timestamp with time zone, p_bed_id uuid, p_corrected_by uuid) to authenticated;
grant execute on function sehat_demand_report(p_days integer) to authenticated;
grant execute on function sehat_detach_practitioner(p_business_id uuid, p_practitioner_id uuid) to authenticated;
grant execute on function sehat_issue_discharge_summary(p_admission_id uuid, p_practitioner_id uuid, p_course_in_hospital text, p_investigations text, p_procedures text, p_advice text, p_diet_advice text, p_activity_advice text, p_warning_signs text, p_follow_up_with text, p_prescription_id uuid, p_supersedes uuid) to authenticated;
grant execute on function sehat_issue_patient_bill(p_patient_member_id uuid, p_business_id uuid, p_admission_id uuid, p_visit_id uuid, p_discount numeric, p_discount_reason text, p_round_off numeric, p_issued_by uuid, p_supersedes uuid) to authenticated;
grant execute on function sehat_issue_prescription(p_patient_member_id uuid, p_business_id uuid, p_practitioner_id uuid, p_items jsonb, p_visit_id uuid, p_diagnosis text, p_advice text, p_follow_up date, p_source_recording_id uuid, p_supersedes uuid) to authenticated;
grant execute on function sehat_issue_token(p_patient_member_id uuid, p_business_id uuid, p_practitioner_id uuid, p_reason text, p_appointment_id uuid, p_priority integer, p_priority_reason text, p_created_by uuid) to authenticated;
grant execute on function sehat_password_changed() to authenticated;
grant execute on function sehat_password_expired(p_auth_uid uuid) to authenticated;
grant execute on function sehat_password_state() to authenticated;
grant execute on function sehat_platform_report(p_days integer) to authenticated;
grant execute on function sehat_post_bed_charges(p_admission_id uuid) to authenticated;
grant execute on function sehat_reapply_retention(p_business uuid) to authenticated, service_role;
grant execute on function sehat_require_password_change(p_auth_uid uuid, p_reason text) to authenticated, service_role;
grant execute on function sehat_set_legal_hold(p_document_id uuid, p_hold boolean, p_reason text) to authenticated;
grant execute on function sehat_set_primary_affiliation(p_practitioner_id uuid, p_business_id uuid) to authenticated;
grant execute on function sehat_set_token_status(p_token_id uuid, p_status text, p_visit_id uuid) to authenticated;
grant execute on function sehat_undo_bed_move(p_stay_id uuid, p_reason text, p_corrected_by uuid) to authenticated;

notify pgrst, 'reload schema';
