-- ============================================================================
-- Sehatsandhi — the views stop running as their owner
--
-- Run AFTER 0073. Safe to re-run.
--
-- ── WHAT 0068 LEFT ──────────────────────────────────────────────────────────
-- 0068 closed six views that leaked by scoping them in their own WHERE, and
-- said plainly that security_invoker was the right end state and that it was
-- blocked on GRANTS rather than policies: `patients` carried no grant to
-- `authenticated` at all, so any view over it flipped to invoker would answer
-- "permission denied" instead of filtering. Its instruction was: grant the base
-- tables, re-probe, then flip, in that order. That is this migration.
--
-- Why it matters even though those thirty-odd views scope themselves correctly
-- today: they do it by convention. A `create or replace view` that forgets the
-- WHERE re-opens the hole silently, and nothing in the database objects. With
-- security_invoker the base table's RLS is underneath every one of them, so a
-- forgotten clause costs rows the caller cannot see rather than rows nobody
-- should.
--
-- ── WHAT MEASURING FOUND ON THE WAY ─────────────────────────────────────────
-- Three views are unscoped, run as owner, AND are granted to anon:
--
--     patient_documents_to_purge     business_id, storage_path, kind, title
--     consultation_audio_to_purge    business_id, audio_path
--     unmet_demand_summary           speciality and pin_code demand, all clinics
--
-- All three read 0 rows today, which is why the 0068 sweep did not flag them:
-- patient_documents holds one row and nothing has passed its retain_until yet,
-- consultation_recordings is empty, unmet_demand_log is empty. The moment a
-- document passes retention, anon — and the anon key is in the JavaScript
-- bundle — reads the storage path of every clinic's patient documents.
--
-- This is the exact shape 0068 warned about in its own closing note: a zero
-- that means "empty table", not "safe". appointment_detail read 0 for everyone
-- right up until the first booking armed it.
--
-- And one the probe caught in this migration's own first draft: giving
-- seed_clinics a public read policy so findable_clinics could keep working as an
-- invoker view exposed the table's other twelve columns — phone numbers and
-- import notes for 80 clinics — because anon held a table-wide grant. Fixed with
-- column-level privileges in section 2. Flipping a view to invoker moves the
-- question from "what does the view select" to "what may the caller read", and
-- those are not the same set.
--
-- They are cron and edge-function helpers. Nothing in src/ reads them. They are
-- revoked from anon AND authenticated below, and flipped, leaving service_role
-- — which holds BYPASSRLS and is what the purge functions run as.
--
-- ── THE POLICIES THAT HAD TO EXIST FIRST ────────────────────────────────────
-- Flipping a view to invoker turns "the view's WHERE" into "the base table's
-- RLS". Where a base table had no SELECT policy at all, that is a silent zero,
-- not a refusal — worse than a permission error, because a screen goes blank
-- and nothing says why. Five tables were in that state and are given the policy
-- the view was already applying by hand:
--
--     patients                    no grant AND no policy — the 0068 blocker
--     appointment_events          appointment_detail counts them
--     business_pricing_overrides  without it every clinic's discount vanishes
--     seed_clinics                findable_clinics is the public clinic finder
--     unmet_demand_log            admin-only, matching its view
--
-- and two more had a policy that admitted only admins, which is not who reads
-- the views over them:
--
--     site_events                 business_daily_stats, practitioner_daily_stats
--     camps_offers                free_camp_quota, offer_quota
--
-- ── WHAT IS NOT FLIPPED, AND WHY ────────────────────────────────────────────
-- purge_job_history reads cron.job and cron.job_run_details. `authenticated`
-- holds no grant in the cron schema, and granting one hands every logged-in
-- clinic the platform's whole job history. It keeps sehat_is_admin() in its own
-- WHERE and its revoke from anon, both from 0068.
--
-- patient_summary is measured, deliberate, and explained in the closing note.
-- ============================================================================


-- ── 1. patients: the grant 0068 was blocked on ──────────────────────────────
--
-- Nothing in src/ reads this table directly — every screen goes through
-- admission_detail, opd_board or patient_summary — which is how it kept no
-- grant for this long. anon is deliberately not included: there is no
-- anonymous path that needs a patient's phone number.
--
-- A patient is visible to a business that has seen them, which is what
-- business_patients records. Same shape as clinic_reads_members on
-- patient_members, one join further out.

grant select on patients to authenticated;

drop policy if exists clinic_reads_patients on patients;
create policy clinic_reads_patients on patients
  for select using (
    exists (
      select 1
        from patient_members m
        join business_patients bp on bp.patient_member_id = m.id
       where m.patient_id = patients.id
         and sehat_caller_owns_business(bp.business_id))
    or sehat_is_admin());

comment on policy clinic_reads_patients on patients is
  'Added in 0074. patients had no SELECT policy and no grant to authenticated, '
  'which is what blocked security_invoker on every view that joins it.';


-- ── 2. The other tables a flipped view would have read as zero ──────────────

-- appointment_detail counts these per appointment. Scoped through the
-- appointment, which is where the business lives.
drop policy if exists clinic_reads_appointment_events on appointment_events;
create policy clinic_reads_appointment_events on appointment_events
  for select using (
    exists (select 1 from appointments a
             where a.id = appointment_events.appointment_id
               and sehat_caller_owns_business(a.business_id)));

-- Without this, business_effective_pricing keeps its rows but loses its LEFT
-- JOIN: override_type, discount and valid_until all read null, and a discounted
-- clinic is quoted full price. A wrong number is worse than a missing row.
drop policy if exists clinic_reads_own_pricing_override on business_pricing_overrides;
create policy clinic_reads_own_pricing_override on business_pricing_overrides
  for select using (sehat_caller_owns_business(business_id));

-- findable_clinics is the public directory of clinics not yet on the platform.
-- The policy matches the view's own filter exactly, so flipping it changes
-- nothing about what is offered — 80 rows before and after.
drop policy if exists public_reads_findable_clinics on seed_clinics;
create policy public_reads_findable_clinics on seed_clinics
  for select using (status = any (array['unclaimed', 'contacted']));

-- And the column grant, which is the whole reason this needs care. An invoker
-- view reads the base table AS THE CALLER, so anon must hold SELECT on
-- seed_clinics for findable_clinics to return anything — and anon already did,
-- table-wide. Adding the policy above without this would have handed anon the
-- other twelve columns: `phone`, `notes`, `source_ref`, `claimed_by_business_id`
-- and the rest of the import pipeline's bookkeeping, for all 80 rows. The probe
-- caught it — seed_clinics appeared in anon's list at 80 rows where it had been
-- absent.
--
-- Column-level privileges are the exact tool: an invoker view needs SELECT on
-- the columns it actually reads, and no others. That is the five the view
-- projects PLUS `status`, which its WHERE tests — granting only the projected
-- five made findable_clinics answer "permission denied for table seed_clinics"
-- to anon, which is how the distinction announced itself. `status` discloses
-- nothing the view does not: being in it already means unclaimed or contacted.
-- registryLookup.ts:123 already says in a comment that this table must be read
-- through the view and never directly; this makes the database say it too.
revoke select on seed_clinics from anon, authenticated;
grant select (id, name, address, pincode, district, status)
  on seed_clinics to anon, authenticated;

-- site_events could only be read by admins, so a clinic's own analytics screens
-- would have gone blank. A business sees its own events; a practitioner sees
-- their own, at whichever business — which is what practitioner_daily_stats
-- says in its comment and could not previously enforce.
drop policy if exists clinic_reads_own_events on site_events;
create policy clinic_reads_own_events on site_events
  for select using (
    (business_id is not null and sehat_caller_owns_business(business_id))
    or (practitioner_id is not null
        and practitioner_id in (select sehat_caller_practitioner_ids())));

-- free_camp_quota and offer_quota count a clinic's own camps to enforce its
-- quota. public_read_approved_camps admits only 'approved' and only while
-- date_to is in the future, so a completed or expired camp would have stopped
-- counting and the quota would silently refill.
drop policy if exists clinic_reads_own_camps on camps_offers;
create policy clinic_reads_own_camps on camps_offers
  for select using (sehat_caller_owns_business(business_id));

-- unmet_demand_summary is an admin screen over a table anyone may write to.
drop policy if exists admins_read_demand on unmet_demand_log;
create policy admins_read_demand on unmet_demand_log
  for select using (sehat_is_admin());


-- ── 3. The second lock: anon keeps only the views meant for it ──────────────
--
-- Every view below is flipped in section 4, so RLS is underneath it either way.
-- Revoking as well means a future `create or replace view` that drops the
-- security_invoker option — CREATE OR REPLACE keeps reloptions, but a DROP and
-- recreate does not — cannot quietly re-open it.
--
-- What anon keeps: active_pricing_plan, findable_clinics, public_business_doctors,
-- public_practitioner_businesses, rating_aggregate, public_tax_display,
-- platform_daily_stats, visitors_by_area, visitors_live. The first six are the
-- public site; the last three are already invoker and read as zero for anon.

revoke select on admission_bed_history      from anon;
revoke select on admission_detail           from anon;
revoke select on business_appointment_list  from anon;
revoke select on business_bills_outstanding from anon;
revoke select on business_modules           from anon;
revoke select on business_outstanding       from anon;
revoke select on discharge_summary_detail   from anon;
revoke select on free_camp_quota            from anon;
revoke select on offer_quota                from anon;
revoke select on opd_board                  from anon;
revoke select on patient_account            from anon;
revoke select on patient_bill_detail        from anon;
revoke select on patient_summary            from anon;
revoke select on prescription_detail        from anon;
revoke select on visit_findings_detail      from anon;
revoke select on ward_occupancy             from anon;

-- The three that were unscoped, owner-run and anon-readable. Cron and edge
-- functions run as service_role; no browser session of any kind needs these.
revoke select on patient_documents_to_purge  from anon, authenticated;
revoke select on consultation_audio_to_purge from anon, authenticated;
revoke select on unmet_demand_summary        from anon, authenticated;


-- ── 4. security_invoker ─────────────────────────────────────────────────────
--
-- Set by name rather than by sweeping every view in the schema, so that adding
-- one does not silently opt it in and so this list is reviewable. Two views are
-- deliberately absent: purge_job_history and patient_summary, both explained at
-- the top and in the closing note.
--
-- `alter view ... set (security_invoker = true)` does not touch the definition,
-- so no column list changes and nothing that depends on these views is
-- invalidated.

do $$
declare
  v text;
  flip text[] := array[
    -- clinic-scoped, over base tables that now carry the matching policy
    'admission_bed_history', 'admission_detail', 'appointment_detail',
    'appointment_outcomes', 'business_appointment_list',
    'business_bills_outstanding', 'business_daily_stats',
    'business_effective_pricing', 'business_modules', 'business_outstanding',
    'discharge_summary_detail', 'opd_board', 'patient_account',
    'patient_bill_detail', 'practitioner_daily_stats', 'prescription_detail',
    'visit_findings_detail', 'ward_occupancy',
    -- public
    'active_pricing_plan', 'findable_clinics', 'free_camp_quota', 'offer_quota',
    'public_business_doctors', 'public_practitioner_businesses',
    'rating_aggregate',
    -- service_role and admin only; service_role holds BYPASSRLS, so these are
    -- unchanged in behaviour and closed to everyone else
    'admin_revenue_summary', 'consultation_audio_to_purge', 'demand_by_area',
    'invoice_monthly_summary', 'invoice_register', 'patient_documents_to_purge',
    'plan_enrolment', 'pricing_plan_status', 'subscription_renewals_due',
    'unmet_demand_summary'
  ];
begin
  foreach v in array flip loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = v and c.relkind = 'v') then
      execute format('alter view public.%I set (security_invoker = true)', v);
    else
      raise warning 'security_invoker: no such view %, skipped', v;
    end if;
  end loop;
end $$;


-- ============================================================================
-- NOT DONE HERE, AND THE REASON IS MEASURED
--
--   patient_summary is still SECURITY DEFINER. Flipping it works — every base
--   table it touches now has a policy — but it changes a number on a screen.
--   Its `visits_here` column counts patient_visits, whose policy is
--   clinic_reads_patient_visits, gated on sehat_caller_is_clinical(). A
--   receptionist is deliberately not clinical, so under invoker they would read
--   0 while the row beside it in Patients.tsx:185 shows business_patients.
--   visit_count — the same number, which they can read. Measured on sandbox:
--   reception sees visits_here=1 today and would see 0.
--
--   Two ways out, and both are somebody's decision rather than a repair:
--   let non-clinical staff of the owning business read patient_visits, which
--   0057 deliberately stopped; or make visits_here read bp.visit_count, which
--   is a maintained counter rather than a count and can drift. The view scopes
--   itself correctly today and the probe confirms anon and a second clinic both
--   read zero through it, so leaving it is safe, not merely convenient.
--
--   purge_job_history is still SECURITY DEFINER and cannot sensibly change:
--   granting `authenticated` anything in the cron schema hands every clinic the
--   platform's job history to get one admin screen working.
--
--   schema_migrations is readable by `authenticated` — 71 rows of migration
--   history with checksums. 0068 revoked it from anon and stopped there. It is
--   not a leak of anyone's data, but it is not a clinic's business either.
-- ============================================================================


-- Grants and view options both live in PostgREST's schema cache, and every view
-- above changed one or the other. Without this the API answers from the old
-- picture — see 0061.
notify pgrst, 'reload schema';
