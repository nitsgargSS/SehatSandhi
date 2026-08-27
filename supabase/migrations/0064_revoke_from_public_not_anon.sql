-- ============================================================================
-- Sehatsandhi — every "revoke from anon" in this repo has done nothing
--
-- Run AFTER 0063. Safe to re-run.
--
-- ── THE MISTAKE ─────────────────────────────────────────────────────────────
-- Migrations here end with lines like:
--
--     revoke all on function sehat_register_patient(...) from anon;
--
-- and they have never revoked anything. Postgres grants EXECUTE on every new
-- function to PUBLIC, and `anon` is a member of PUBLIC — so taking the grant
-- away from anon leaves the inherited one untouched. The privilege has to be
-- revoked from PUBLIC.
--
-- Measured on production before writing this: 64 of 66 SECURITY DEFINER
-- functions were executable by anon. 26 of those refuse anyway because they
-- check ownership internally; 21 are callable and check nothing.
--
-- ── WHAT WAS ACTUALLY REACHABLE ─────────────────────────────────────────────
-- Not theoretical, and worth naming so nobody re-opens it:
--
--   sehat_link_patient_to_business(member, business, ...)
--     Attach ANY patient to ANY clinic. An attacker with a listing of their own
--     could link a patient_member id to it and then read that person's record
--     through perfectly ordinary RLS, because being on the clinic's list IS the
--     permission. The worst of these by a distance.
--
--   sehat_next_invoice_number / _bill_ / _prescription_ / _discharge_ / _admission_
--     Burn a clinic's statutory numbering. Each call advances the counter, so a
--     loop leaves permanent gaps in a GST invoice series that has to be
--     explained to an auditor and cannot be repaired.
--
--   sehat_purge_old_site_events(0), sehat_purge_login_codes(),
--   sehat_purge_stale_visitor_locations(0)
--     Unauthenticated deletion. Anyone could empty the analytics log.
--
--   sehat_issue_invoice(payment_id)   — mint a GST document for any payment
--   sehat_open_bed_stay / sehat_close_bed_stay  — rewrite what a stay bills
--   sehat_mark_audio_deleted / sehat_mark_document_purged — mark records gone
--
-- ── WHAT STAYS PUBLIC, DELIBERATELY ─────────────────────────────────────────
-- Some of this genuinely has to run before anybody has a session:
--   sehat_register_business_with_doctors, sehat_register_practitioner — signup
--   sehat_open_windows, sehat_governing_windows — a patient picking a slot
--   sehat_search_practitioners — the public directory
--   sehat_record_visitor_location — analytics from anonymous visitors
-- Those are left alone. Narrowing them would break the front of the site.
--
-- ── WHY NOT REVOKE FROM PUBLIC EVERYWHERE ───────────────────────────────────
-- Because it would break the app in ways that only show at runtime. The right
-- unit is one function at a time, with its callers checked. This migration does
-- the twelve that are both reachable and harmful; the rest are listed at the
-- foot for whoever picks this up next.
-- ============================================================================

do $$
declare
  fn text;
  sig text;
begin
  -- name(identity args) pairs, because several of these are overloaded and a
  -- bare name would be ambiguous.
  for fn, sig in
    select * from (values
      ('sehat_link_patient_to_business', '(uuid, uuid, text, text)'),
      ('sehat_next_admission_number',    '(uuid, date)'),
      ('sehat_next_bill_number',         '(uuid, date)'),
      ('sehat_next_discharge_number',    '(uuid, date)'),
      ('sehat_next_prescription_number', '(uuid, date)'),
      ('sehat_issue_invoice',            '(uuid)'),
      ('sehat_open_bed_stay',            '(uuid, uuid, uuid, timestamptz)'),
      ('sehat_close_bed_stay',           '(uuid, timestamptz)'),
      ('sehat_mark_audio_deleted',       '(uuid)'),
      ('sehat_mark_document_purged',     '(uuid)'),
      ('sehat_purge_login_codes',        '()'),
      ('sehat_purge_old_site_events',    '(integer)'),
      ('sehat_purge_stale_visitor_locations', '(integer)')
    ) as t(fn, sig)
  loop
    begin
      execute format('revoke all on function public.%I%s from public, anon', fn, sig);
    exception when undefined_function then
      raise notice 'skipped % — not present', fn;
    end;
  end loop;
end $$;

-- Put back what actually calls them.
--
-- The triggers and the issuing RPCs reach these from inside SECURITY DEFINER
-- functions owned by postgres, so they need no grant at all — that is why
-- revoking is safe here and would not be for something the browser calls.
--
-- The edge functions do need it: they connect with the service role, which is
-- not a superuser and does not inherit through PUBLIC any more.
grant execute on function sehat_mark_audio_deleted(uuid)                to service_role;
grant execute on function sehat_mark_document_purged(uuid)              to service_role;
grant execute on function sehat_issue_invoice(uuid)                     to service_role;
grant execute on function sehat_purge_old_site_events(integer)          to service_role;
grant execute on function sehat_purge_stale_visitor_locations(integer)  to service_role;
grant execute on function sehat_purge_login_codes()                     to service_role;

-- sehat_has_consent is read by the dashboard through patient_summary and
-- directly by the recording pane, so authenticated keeps it — but PUBLIC does
-- not. Whether a named person consented to being recorded is not a fact the
-- open internet should be able to probe one member id at a time.
revoke all on function sehat_has_consent(uuid, text, uuid) from public, anon;
grant execute on function sehat_has_consent(uuid, text, uuid) to authenticated, service_role;

-- Same shape: the front desk reads it, nobody else needs to.
revoke all on function sehat_retention_years(uuid, text) from public, anon;
grant execute on function sehat_retention_years(uuid, text) to authenticated;

-- And the one that started this. 0063 revoked it from anon and therefore not
-- at all; the ownership check inside was the only thing stopping a stranger
-- writing rows into patients and patient_members.
revoke all on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text) from public, anon;
grant execute on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text) to authenticated;


-- ============================================================================
-- NOT DONE HERE, AND WORTH DOING
--
-- Every other SECURITY DEFINER function still carries the PUBLIC grant. The 26
-- that check ownership internally refuse anon already, so the exposure is
-- shallow — but it is one forgotten check away from not being, and the
-- defence-in-depth belongs there too.
--
-- The reason it is not in this migration: each one needs its callers traced
-- (browser, edge function, trigger, cron) before its grant can be narrowed, and
-- getting that wrong produces a runtime failure in a path nobody exercises
-- until a patient is standing at a desk. Twelve at a time, verified, is the
-- right pace.
--
-- The standing rule for anything written from here on:
--     revoke all on function <name>(<args>) from public, anon;
-- `from anon` alone is a no-op and always has been.
-- ============================================================================
