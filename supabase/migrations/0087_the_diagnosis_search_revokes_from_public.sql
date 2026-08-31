-- ============================================================================
-- Sehatsandhi — 0086 made 0064's mistake again
--
-- Run AFTER 0086. Safe to re-run.
--
-- 0086 ended with the line this repo has written a hundred times:
--
--     revoke all on function sehat_search_by_diagnosis(...) from anon;
--
-- and, exactly as 0064 explained at length, it revoked nothing. Postgres grants
-- EXECUTE on every new function to PUBLIC, and `anon` is a member of PUBLIC, so
-- taking a grant away from anon leaves the inherited one in place. Measured
-- after 0086 shipped: has_function_privilege('anon', ..., 'execute') was TRUE
-- for both of its functions, on production and sandbox alike.
--
-- 0064 fixed the functions that existed then. It did not — could not — stop the
-- idiom being copied into every migration written since, which is what happened
-- here: the surrounding style was followed rather than the lesson.
--
-- ── WHAT WAS AND WAS NOT EXPOSED ────────────────────────────────────────────
-- No patient data was reachable. Both functions are SECURITY DEFINER and gate
-- on sehat_caller_is_clinical(business_id), which resolves through
-- sehat_caller_role() → auth.uid(). For an anon caller auth.uid() is null, the
-- role is null, the gate is false and every union arm returns nothing. The
-- audit helper likewise inserts nothing, because its where-clause is the same
-- predicate.
--
-- So this is defence in depth rather than a breach. It is still worth closing
-- on the day it is found: an anon-executable SECURITY DEFINER function is one
-- careless edit away from being a leak, and the whole point of 0064 was that
-- the seatbelt should not depend on the driver.
--
-- ── THE NAME SEARCH TOO ─────────────────────────────────────────────────────
-- sehat_search_patients has the same defect and is the direct sibling of the
-- function 0086 added — the two are offered side by side in the same UI, over
-- the same patient data. Fixing one and leaving the other would be arbitrary.
-- It is equally not a live leak: it scopes on sehat_caller_business_ids(),
-- which is empty for anon. Nothing anonymous calls it — searching the patient
-- register is a signed-in clinic feature by definition.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- 59 SECURITY DEFINER sehat_* functions on production are executable by anon
-- for this same reason. Sweeping all of them is the right thing to do and is
-- NOT done here: 0064 found that many refuse anyway because they check
-- ownership internally, a handful are genuinely meant to be anonymous (the
-- public document views, the booking bot, registration on the anon key), and
-- telling those apart needs the same case-by-case reading 0064 gave them.
-- Doing it blind in a migration appended to a feature branch would break the
-- anonymous paths. It wants its own change and its own testing.
-- ============================================================================

-- The functions 0086 added. `from public` is the operative word; the redundant
-- `from anon` is kept off deliberately so this file cannot be read as endorsing
-- the idiom that caused the problem.
revoke all on function sehat_search_by_diagnosis(text, uuid, date, date, boolean, integer) from public;
revoke all on function sehat_log_diagnosis_search(uuid, text) from public;

grant execute on function sehat_search_by_diagnosis(text, uuid, date, date, boolean, integer) to authenticated;
grant execute on function sehat_log_diagnosis_search(uuid, text) to authenticated;

-- The name search, for the reasons in the header.
revoke all on function sehat_search_patients(text, uuid) from public;
grant execute on function sehat_search_patients(text, uuid) to authenticated;

comment on function sehat_search_by_diagnosis is
  'Find patients by diagnosis, condition, ICD-10 code or procedure across OPD '
  'visits, the problem list, admissions, discharge summaries and prescriptions. '
  'Gated on sehat_caller_is_clinical per row — this enumerates people by '
  'disease, so it is not reception''s to run. Cancelled and superseded '
  'documents are excluded. EXECUTE revoked from PUBLIC by 0087, not merely '
  'from anon, which never worked — see 0064.';


notify pgrst, 'reload schema';
