-- ============================================================================
-- 0342 — lab_order_detail runs as whoever asks again
-- ============================================================================
-- AFTER 0341. Safe to re-run.
--
-- 0168 made lab_order_detail a security_invoker view. 0176, 0288 and 0290
-- rebuilt it with drop + create and lost the option, so since 0176 it has run
-- as its owner — bypassing the row security of lab_orders, patients,
-- patient_members, business_patients, lab_order_items and lab_reports — and,
-- by Supabase's default privileges, anon could select from it. Its own WHERE
-- sehat_caller_owns_business(o.business_id) still returned 0 rows to anon and
-- only the caller's own orders to staff, so nothing leaked; this puts the base
-- tables' rules back in front of it as well.
--
-- Checked on sandbox before writing (22 Nov 2026), in rolled-back transactions:
-- every lab login, including the lab with an order referred in from another
-- hospital, reads exactly the same rows, names and reports either way; anon is
-- refused outright.
--
-- Whoever rebuilds this view next: create it WITH (security_invoker = true).
-- ============================================================================

alter view lab_order_detail set (security_invoker = true);
revoke all on lab_order_detail from anon;
grant select on lab_order_detail to authenticated;

notify pgrst, 'reload schema';
