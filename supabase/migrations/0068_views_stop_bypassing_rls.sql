-- ============================================================================
-- Sehatsandhi — the views that answer to nobody
--
-- Run AFTER 0067. Safe to re-run.
--
-- ── WHAT WAS MEASURED ───────────────────────────────────────────────────────
-- 0067 noted that medication_due had no `security_invoker` and that 31 other
-- views shared the omission. This is the sweep it deferred, but narrowed to
-- what was actually shown to leak rather than everything that theoretically
-- could. A view without security_invoker runs as its owner and so skips the RLS
-- on its base tables; whether that matters depends entirely on whether the view
-- scopes itself in its own WHERE. Most here do. Six did not.
--
-- Measured on sandbox with one appointment present, reading as anon, as the
-- clinic that owns the row, and as a second unrelated clinic:
--
--   appointment_detail          anon: 1 row   -> {"patient_name":"Sunita Rao",
--                                                 "patient_phone":"9812345678",
--                                                 "patient_age":52}
--   appointment_outcomes        anon: 1 row   every clinic's completed/no-show counts
--   business_effective_pricing  anon: 7 rows  every clinic's negotiated price and discount
--   practitioner_daily_stats    anon: 2 rows  per-doctor impressions and profile views
--   business_daily_stats        (same shape, empty only because sandbox has few events)
--   purge_job_history           anon: 84 rows cron run details, including return_message
--
-- The competing clinic saw all of it too. The anon key is in the JavaScript
-- bundle, so "anon" here means anybody at all.
--
-- Nothing had leaked in production, because production has no appointments and
-- no patients yet. appointment_detail is the one that mattered: it has no WHERE
-- of any kind, so it arms itself the moment somebody books.
--
-- ── THE OTHER HALF: A TABLE NOBODY COULD READ ───────────────────────────────
-- The same probe found the opposite failure. `appointments` had exactly three
-- policies — insert for anyone, select and update for admins — and no policy for
-- the clinic the appointment belongs to. Dashboard.tsx:153 reads
-- `from('appointments')` directly, so a doctor's appointment list has always
-- returned zero rows. It was never noticed because no appointment has ever been
-- booked in either database, and because appointment_detail — bypassing RLS —
-- would have shown the rows anyway.
--
-- Fixing that first is what makes the rest safe: scoping the views is only
-- correct once the underlying table can be read by the people who own the rows.
--
-- ── WHY SCOPE THE VIEWS RATHER THAN FLIP security_invoker ───────────────────
-- security_invoker is the better mechanism and remains the goal. It is not what
-- this migration does, because it would break screens today: `patients` carries
-- no grant to `authenticated` at all (every persona probed returns "permission
-- denied for table patients"), so every view over it would start refusing
-- instead of filtering. Granting across the base tables is a larger change that
-- needs its own verification pass.
--
-- What this does instead is give the six unscoped views the same self-scoping
-- WHERE the other thirty-one already have — the pattern this schema has already
-- proved works, and which the probe confirms holds across two clinics.
-- ============================================================================


-- ── 1. The appointment list a clinic is supposed to see ─────────────────────
--
-- sehat_caller_owns_business() already returns true for an admin, so the
-- existing admin policies are redundant once these exist. They are left alone:
-- permissive policies OR together, and removing them is not this migration's
-- job.

drop policy if exists clinic_reads_appointments on appointments;
create policy clinic_reads_appointments on appointments
  for select using (sehat_caller_owns_business(business_id));

drop policy if exists clinic_updates_appointments on appointments;
create policy clinic_updates_appointments on appointments
  for update using (sehat_caller_owns_business(business_id))
          with check (sehat_caller_owns_business(business_id));

comment on policy clinic_reads_appointments on appointments is
  'Added in 0068. Without it a clinic could not read its own appointments and '
  'the dashboard list was permanently empty; the RLS-bypassing appointment_detail '
  'view was hiding the gap.';


-- ── 2. The six views that scoped themselves to nobody ───────────────────────
--
-- Column lists are unchanged, so `create or replace` keeps dependents intact.
-- Each gains the scoping clause it should always have had.

-- Patient name, phone and age of every appointment in the system.
create or replace view appointment_detail as
 select id,
    patient_phone,
    patient_name,
    patient_age,
    business_id,
    practitioner_id,
    slot_datetime,
    status,
    booked_via,
    confirmation_sent,
    reminder_sent,
    created_at,
    confirmed_at,
    completed_at,
    cancelled_at,
    cancelled_by,
    cancel_reason,
    previous_slot_datetime,
    rescheduled_at,
    rescheduled_by,
    reschedule_count,
    no_show_at,
    updated_at,
    last_actor,
    last_actor_detail,
    reschedule_count > 0 as was_rescheduled,
    ( select count(*) as count
        from appointment_events e
       where e.appointment_id = a.id) as event_count,
    ( select count(*) as count
        from appointments x
       where x.patient_phone = a.patient_phone and x.status = 'no_show'::text) as patient_no_shows
   from appointments a
  where sehat_caller_owns_business(a.business_id);

-- Note the sub-select on patient_no_shows counts across ALL clinics by phone
-- number. That is deliberate — a no-show history is the point — and it leaks
-- nothing identifying, only a count, and only for a patient the caller can
-- already see.

create or replace view appointment_outcomes as
 select business_id,
    count(*) as total,
    count(*) filter (where status = 'completed'::text) as completed,
    count(*) filter (where status = 'no_show'::text) as no_shows,
    count(*) filter (where status = 'cancelled'::text and cancelled_by = 'patient'::text) as cancelled_by_patient,
    count(*) filter (where status = 'cancelled'::text and cancelled_by = 'clinic'::text) as cancelled_by_clinic,
    count(*) filter (where reschedule_count > 0) as rescheduled
   from appointments
  where sehat_caller_owns_business(business_id)
  group by business_id;

create or replace view business_daily_stats as
 select business_id,
    date_trunc('day'::text, created_at)::date as day,
    count(*) filter (where event_type = 'doctor_impression'::text) as times_listed,
    count(*) filter (where event_type = 'doctor_view'::text) as profile_views,
    count(*) filter (where event_type = 'whatsapp_click'::text) as whatsapp_clicks,
    count(*) filter (where event_type = 'call_click'::text) as call_clicks,
    count(distinct session_id) as unique_visitors
   from site_events e
  where business_id is not null
    and sehat_caller_owns_business(business_id)
  group by business_id, (date_trunc('day'::text, created_at)::date);

-- A practitioner's own numbers follow the practitioner, not the clinic: a doctor
-- affiliated to two businesses should see their own impressions at both, and a
-- clinic should see the doctors on its own list.
create or replace view practitioner_daily_stats as
 select practitioner_id,
    date_trunc('day'::text, created_at)::date as day,
    count(*) filter (where event_type = 'doctor_impression'::text) as times_listed,
    count(*) filter (where event_type = 'doctor_view'::text) as profile_views,
    count(*) filter (where event_type = 'whatsapp_click'::text) as whatsapp_clicks,
    count(distinct session_id) as unique_visitors
   from site_events e
  where practitioner_id is not null
    and (
      practitioner_id in (select sehat_caller_practitioner_ids())
      or exists (
        select 1 from business_practitioners bp
         where bp.practitioner_id = e.practitioner_id
           and sehat_caller_owns_business(bp.business_id))
    )
  group by practitioner_id, (date_trunc('day'::text, created_at)::date);

-- What each clinic negotiated. Commercially sensitive between clinics, never
-- mind to the open internet.
create or replace view business_effective_pricing as
 select b.id as business_id,
    b.name,
    b.pin_codes,
    coalesce(sum(pt.monthly_price), 0::bigint) as base_monthly_price,
    bpo.override_type,
    bpo.discount_percentage,
    bpo.discount_amount,
    bpo.custom_monthly_price,
    bpo.valid_until,
    bpo.reason,
    bpo.category,
        case
            when bpo.override_type = 'free'::text then 0::numeric
            when bpo.override_type = 'discount_pct'::text then round(coalesce(sum(pt.monthly_price), 0::bigint)::numeric * (1::numeric - bpo.discount_percentage::numeric / 100::numeric))
            when bpo.override_type = 'discount_fixed'::text then greatest(0::bigint, coalesce(sum(pt.monthly_price), 0::bigint) - bpo.discount_amount)::numeric
            when bpo.override_type = 'custom_price'::text then bpo.custom_monthly_price::numeric
            when bpo.override_type = 'trial'::text then 0::numeric
            else coalesce(sum(pt.monthly_price), 0::bigint)::numeric
        end as effective_monthly_price,
        case
            when bpo.override_type = any (array['free'::text, 'trial'::text]) then true
            when bpo.override_type = 'discount_pct'::text and bpo.discount_percentage = 100 then true
            else false
        end as is_free,
    bpo.is_active as has_override
   from businesses b
     left join service_areas sa on (sa.pin_code = any (b.pin_codes)) and sa.is_active = true
     left join pricing_tiers pt on pt.tier_number = sa.tier_number
     left join business_pricing_overrides bpo on bpo.business_id = b.id and bpo.is_active = true and (bpo.valid_until is null or bpo.valid_until >= current_date)
  where sehat_caller_owns_business(b.id)
  group by b.id, b.name, b.pin_codes, bpo.override_type, bpo.discount_percentage, bpo.discount_amount, bpo.custom_monthly_price, bpo.valid_until, bpo.reason, bpo.category, bpo.is_active;

-- Cron internals. There is no business to scope this to, and return_message
-- carries whatever the failing request said — today that is the vault-secret
-- error, tomorrow it could be a signed URL. Admins only.
create or replace view purge_job_history as
 select j.jobname,
    r.status,
    r.return_message,
    r.start_time,
    r.end_time
   from cron.job j
     join cron.job_run_details r on r.jobid = j.jobid
  where j.jobname = any (array['purge-patient-documents'::text, 'purge-consultation-audio'::text])
    and sehat_is_admin()
  order by r.start_time desc;


-- ── 3. anon keeps only the writes it is actually meant to make ──────────────
--
-- Supabase's default privileges grant anon full DML — insert, update, delete
-- AND truncate — on every new table and view. RLS is the only thing that has
-- been stopping it, which means one forgotten policy is the whole distance
-- between safe and not. Measured before writing: 68 tables and 34 views.
--
-- The keep-list is not a guess. It is every policy in the schema whose INSERT
-- check an unauthenticated caller can actually satisfy:
--
--   appointments         a patient booking without an account — the whole point
--   site_events          analytics from anonymous visitors
--   site_visits          the same
--   unmet_demand_log     "no doctor for this speciality here" on the landing page
--   ratings              a patient leaving a review
--   review_flags         reporting one
--   opt_outs             unsubscribing, which must work without a login
--   discount_code_usage  redeeming a coupon during a booking
--
-- Everything else the browser does after login runs as `authenticated`, and the
-- edge functions run as `service_role`. Neither is touched here.

do $$
declare
  r record;
  keep text[] := array[
    'appointments', 'site_events', 'site_visits', 'unmet_demand_log',
    'ratings', 'review_flags', 'opt_outs', 'discount_code_usage'
  ];
begin
  for r in
    select c.relname, c.relkind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'v')
       and array_to_string(c.relacl, ',') like '%anon=%'
  loop
    if r.relname = any (keep) then
      -- Leave INSERT, take the rest. Nothing anonymous should update or delete.
      execute format('revoke update, delete, truncate on public.%I from anon', r.relname);
    else
      execute format('revoke insert, update, delete, truncate on public.%I from anon', r.relname);
    end if;
  end loop;
end $$;

-- And the reads that were never meant to be public. The WHERE clauses above
-- already close these; revoking as well means a future `create or replace view`
-- that forgets the clause does not silently re-open them.
revoke select on appointment_detail         from anon;
revoke select on appointment_outcomes       from anon;
revoke select on business_daily_stats       from anon;
revoke select on practitioner_daily_stats   from anon;
revoke select on business_effective_pricing from anon;
-- authenticated keeps the grant; the sehat_is_admin() in the view's WHERE is
-- what gates it. Revoking from authenticated as well locks out the admins it
-- was just rewritten to admit — which is what the first draft of this migration
-- did, and what the probe caught.
revoke select on purge_job_history          from anon;
grant  select on purge_job_history           to authenticated, service_role;

-- The migration runner's own bookkeeping. RLS is off on it by design — it is
-- written by the runner as postgres — but that also means anon could read the
-- entire migration history, checksums included.
revoke select on schema_migrations from anon;


-- ── 4. Anyone could mint a discount code ────────────────────────────────────
--
-- allow_write_coupons was `for all using (true) with check (true)`, and anon
-- held the DML grant to go with it. A stranger with the anon key could create a
-- hundred-percent-off code, or delete every code the business relies on. The
-- read side is deliberately public — the booking page has to price a coupon
-- before anyone logs in — and is left as it is.

drop policy if exists allow_write_coupons  on discount_codes;
drop policy if exists admins_write_coupons on discount_codes;
create policy admins_write_coupons on discount_codes
  for all using (sehat_is_admin()) with check (sehat_is_admin());

comment on policy admins_write_coupons on discount_codes is
  'Replaced allow_write_coupons in 0068, which was using(true) and so let anyone '
  'holding the published anon key mint or delete coupons.';


-- ============================================================================
-- NOT DONE HERE, AND WORTH DOING
--
--   security_invoker on the remaining views. Still the right end state, still
--   blocked on base-table grants: `patients` has no grant to authenticated at
--   all, so flipping the views over it turns a filter into a refusal. Grant the
--   base tables, re-probe, then flip — in that order.
--
--   The 31 views that scope themselves correctly today do so by convention, not
--   by enforcement. scripts/rls-probe.mjs is the check: baseline, change,
--   compare. A clinic's own count falling to zero is a broken screen; anon's
--   count rising above zero is a leak.
--
--   appointments still carries admins_read_appointments and
--   admins_update_appointments, now redundant against the clinic policies.
--   Harmless, but they should go when someone is next in this file.
-- ============================================================================
