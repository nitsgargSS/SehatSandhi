-- ============================================================================
-- 0225 — Returning patients counted as people who came back; an invoice at the
--        counter for tests and things sold; the day's billing by head
-- ============================================================================
-- AFTER 0224. Safe to re-run.
--
-- From a hospital's first fortnight on the system (10 Oct 2026):
--
-- 1. RETURNING PATIENTS. The patient report counted as "returning" only someone
--    first registered BEFORE the period being looked at. A clinic that joined
--    this month, looking at this month, saw none — though people had come two
--    and three times. Now: a patient who came, in the period, on a day after
--    their first visit here. The register behind the tile lists the same people.
--    (So a patient can be new and returning in the same month; the two no
--    longer add up to "patients in this period".)
--
-- 2. AN INVOICE AT THE COUNTER. The ledger could already hold any charge, a
--    payment and a bill, as three separate steps inside the patient's record;
--    in practice only the automatic OPD fee and the pharmacy counter were used.
--    An eye hospital also does tests (OCT, perimetry) and sells spectacles.
--      • clinic_price_items — the clinic's own price list, so a test is picked,
--        not typed. Owner and manager keep it.
--      • category 'product' — things sold (opticals), beside the existing heads.
--        The revenue report shows it under Other.
--      • sehat_counter_invoice — lines, discount, and the money taken, in one
--        step: the charges, a numbered bill, and the payment against it.
--
-- 3. THE DAY BY HEAD. sehat_day_heads — what was charged in a period, by head
--    (consultation, tests, procedures, things sold, pharmacy…), for the
--    collections screen to set beside what was actually collected.
--
-- 4. DELETING A MEDICINE. A medicine entered into the pharmacy stock by mistake
--    (a wrong name) could only be renamed or marked "not stocked". Now the
--    owner, a manager or a doctor can delete it — only when none is in hand
--    (count it down to zero first). One that is on a bill is never erased: it
--    is marked not stocked and stays for those records.
-- ============================================================================

-- ── 1. Returning patients ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sehat_patient_report(p_business uuid, p_from date, p_to date, p_grain text DEFAULT 'month'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_from date := coalesce(p_from, v_today - 29);
  v_to date := least(coalesce(p_to, v_today), v_today);
  v_len integer;
  v_prev_from date;
  v_prev_to date;
  v_grain text := case when lower(coalesce(p_grain, '')) in ('day','week','month','quarter','year') then lower(p_grain) else 'month' end;
  v jsonb;
begin
  if not (sehat_is_admin() or coalesce(sehat_caller_role(p_business) in ('owner', 'manager', 'doctor'), false)) then
    raise exception 'Only the owner, a manager or a doctor can read the patient report.' using errcode = '42501';
  end if;
  if v_from > v_to then v_from := v_to; end if;
  v_len := v_to - v_from + 1;
  v_prev_to := v_from - 1;
  v_prev_from := v_from - v_len;

  create temporary table if not exists _pr_enc (member uuid, d date, doc uuid, kind text) on commit drop;
  create temporary table if not exists _pr_pat (member uuid primary key, first_seen date, source text, doc uuid,
                                                last_seen date, visits integer, gender text, age integer,
                                                pin text, district text, state text, city text, name text, phone text) on commit drop;
  truncate _pr_enc; truncate _pr_pat;

  -- Every visit day, all time (the win-back list and "returning" need history).
  insert into _pr_enc
  select distinct on (member, d) member, d, doc, kind from (
    select v.patient_member_id as member, v.visit_date as d, v.practitioner_id as doc, 'opd' as kind, 1 as pri
      from patient_visits v
     where v.business_id = p_business and v.patient_member_id is not null and v.visit_date is not null
    union all
    select q.patient_member_id, q.queue_date, q.practitioner_id, 'opd', 2
      from opd_queue q
     where q.business_id = p_business and q.visit_id is null and q.status not in ('skipped', 'left')
    union all
    select a.patient_member_id, (a.admitted_at at time zone 'Asia/Kolkata')::date, a.attending_practitioner_id, 'ipd', 0
      from admissions a
     where a.business_id = p_business
  ) x
  order by member, d, pri;

  insert into _pr_pat
  select bp.patient_member_id,
         (bp.first_seen_at at time zone 'Asia/Kolkata')::date,
         bp.source,
         coalesce(bp.primary_practitioner_id,
                  (select e.doc from _pr_enc e where e.member = bp.patient_member_id and e.doc is not null order by e.d limit 1)),
         greatest((bp.last_seen_at at time zone 'Asia/Kolkata')::date, (select max(e.d) from _pr_enc e where e.member = bp.patient_member_id)),
         (select count(*) from _pr_enc e where e.member = bp.patient_member_id)::integer,
         pm.gender,
         coalesce(date_part('year', age(v_today, pm.date_of_birth))::integer, pm.age_years),
         pa.pin_code,
         coalesce(pd.district, nullif(btrim(pa.district), '')),
         coalesce(pd.state, nullif(btrim(pa.state), '')),
         nullif(btrim(pa.city), ''),
         pm.full_name,
         pa.phone
    from business_patients bp
    join patient_members pm on pm.id = bp.patient_member_id
    join patients pa on pa.id = pm.patient_id
    left join pincode_directory pd on pd.pin_code = pa.pin_code
   where bp.business_id = p_business and pm.status = 'active';

  -- "All time" starts at the clinic's first patient, not at whatever early
  -- date the screen sent — the trend has a row per period in between.
  v_from := greatest(v_from, coalesce(least((select min(first_seen) from _pr_pat), (select min(d) from _pr_enc)), v_from));
  if v_from > v_to then v_from := v_to; end if;

  with
  seen as (   -- everyone at the clinic in the period, and the new ones even if no visit was written
    select distinct member from _pr_enc where d between v_from and v_to
    union
    select member from _pr_pat where first_seen between v_from and v_to
  ),
  prev_seen as (
    select distinct member from _pr_enc where d between v_prev_from and v_prev_to
    union
    select member from _pr_pat where first_seen between v_prev_from and v_prev_to
  ),
  sp as (select p.* from _pr_pat p join seen s on s.member = p.member),
  periods as (
    select distinct sehat_period_start(g::date, v_grain) as p
      from generate_series(v_from, v_to, interval '1 day') g
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'grain', v_grain,

    'totals', jsonb_build_object(
      'all_time', (select count(*) from _pr_pat),
      'active_12m', (select count(*) from _pr_pat where last_seen >= v_today - 365 or first_seen >= v_today - 365),
      'seen', (select count(*) from seen),
      'new', (select count(*) from _pr_pat where first_seen between v_from and v_to),
      -- 0225: came in the period on a day after their first visit here — whenever that first visit was.
      'returning', (select count(distinct e.member) from _pr_enc e join _pr_pat p on p.member = e.member
                     where e.d between v_from and v_to
                       and e.d > (select min(x.d) from _pr_enc x where x.member = e.member)),
      'visits', (select count(*) from _pr_enc where d between v_from and v_to),
      'admissions', (select count(*) from _pr_enc where kind = 'ipd' and d between v_from and v_to),
      'prev_seen', (select count(*) from prev_seen),
      'prev_new', (select count(*) from _pr_pat where first_seen between v_prev_from and v_prev_to),
      'prev_visits', (select count(*) from _pr_enc where d between v_prev_from and v_prev_to),
      'revenue', (select coalesce(sum(c.amount), 0) from patient_charges c
                   where c.business_id = p_business and c.charged_on between v_from and v_to),
      'unknown_area', (select count(*) from sp where pin is null and city is null and district is null)
    ),

    'trend', (select coalesce(jsonb_agg(t order by t.period), '[]'::jsonb) from (
      select pr.p as period,
             (select count(*) from _pr_pat where sehat_period_start(first_seen, v_grain) = pr.p and first_seen between v_from and v_to) as new,
             (select count(distinct member) from _pr_enc where sehat_period_start(d, v_grain) = pr.p and d between v_from and v_to) as seen,
             (select count(*) from _pr_enc where sehat_period_start(d, v_grain) = pr.p and d between v_from and v_to) as visits,
             (select count(*) from _pr_enc where kind = 'ipd' and sehat_period_start(d, v_grain) = pr.p and d between v_from and v_to) as admissions
        from periods pr) t),

    'by_pincode', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select pin as pin_code, max(district) as district, max(state) as state, count(*) as patients,
             count(*) filter (where first_seen between v_from and v_to) as new
        from sp where pin is not null group by pin order by count(*) desc limit 50) t),

    'by_city', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select coalesce(district, initcap(city)) as city, max(state) as state, count(*) as patients,
             count(*) filter (where first_seen between v_from and v_to) as new
        from sp where coalesce(district, city) is not null
       group by coalesce(district, initcap(city)) order by count(*) desc limit 30) t),

    'by_state', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select state, count(*) as patients from sp where state is not null group by state order by count(*) desc) t),

    'by_gender', (select coalesce(jsonb_object_agg(g, n), '{}'::jsonb) from (
      select coalesce(gender, 'not_recorded') as g, count(*) as n from sp group by 1) t),

    'by_age', (select coalesce(jsonb_agg(t order by t.sort), '[]'::jsonb) from (
      select case when age is null then 'Not recorded' when age < 13 then '0–12' when age < 18 then '13–17'
                  when age < 31 then '18–30' when age < 46 then '31–45' when age < 61 then '46–60' else '60+' end as band,
             case when age is null then 9 when age < 13 then 1 when age < 18 then 2 when age < 31 then 3
                  when age < 46 then 4 when age < 61 then 5 else 6 end as sort,
             count(*) as patients
        from sp group by 1, 2) t),

    'by_source', (select coalesce(jsonb_agg(t order by t.patients desc), '[]'::jsonb) from (
      select source, count(*) as patients from _pr_pat
       where first_seen between v_from and v_to group by source) t),

    'by_doctor', (select coalesce(jsonb_agg(t order by t.visits desc), '[]'::jsonb) from (
      select coalesce(pr.full_name, 'Not recorded') as doctor,
             count(distinct e.member) as patients, count(*) as visits,
             (select count(*) from _pr_pat p where p.doc is not distinct from e.doc and p.first_seen between v_from and v_to) as new
        from _pr_enc e left join practitioners pr on pr.id = e.doc
       where e.d between v_from and v_to
       group by e.doc, pr.full_name) t),

    'top_diagnoses', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select max(coalesce(nullif(btrim(v.diagnosis), ''), v.icd10_code)) as diagnosis, max(v.icd10_code) as icd10,
             count(*) as visits, count(distinct v.patient_member_id) as patients
        from patient_visits v
       where v.business_id = p_business and v.visit_date between v_from and v_to
         and coalesce(nullif(btrim(v.diagnosis), ''), v.icd10_code) is not null
       group by coalesce(v.icd10_code, lower(btrim(v.diagnosis)))
       order by count(*) desc limit 15) t),

    'busiest', jsonb_build_object(
      'weekday', (select coalesce(jsonb_object_agg(dow, n), '{}'::jsonb) from (
                   select extract(isodow from d)::integer as dow, count(*) as n
                     from _pr_enc where d between v_from and v_to group by 1) t),
      'hour', (select coalesce(jsonb_object_agg(h, n), '{}'::jsonb) from (
                select extract(hour from q.arrived_at at time zone 'Asia/Kolkata')::integer as h, count(*) as n
                  from opd_queue q
                 where q.business_id = p_business and q.queue_date between v_from and v_to
                   and q.status not in ('skipped', 'left')
                 group by 1) t)),

    'follow_ups', jsonb_build_object(
      'due_7d', (select count(*) from patient_visits v
                  where v.business_id = p_business and v.follow_up_due between v_today and v_today + 7),
      'overdue', (select count(*) from patient_visits v
                   where v.business_id = p_business and v.follow_up_due between v_today - 60 and v_today - 1
                     and not exists (select 1 from _pr_enc e where e.member = v.patient_member_id and e.d > v.visit_date))),

    -- Seen before, not for 6 to 18 months: the people to invite back.
    'lapsed_count', (select count(*) from _pr_pat where last_seen between v_today - 548 and v_today - 183),
    'lapsed', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select name, phone, last_seen, visits, pin as pin_code, coalesce(district, city) as city
        from _pr_pat where last_seen between v_today - 548 and v_today - 183
       order by visits desc, last_seen desc limit 300) t)
  ) into v;

  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.sehat_visit_register(p_business uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_doctor uuid DEFAULT NULL::uuid, p_query text DEFAULT NULL::text, p_kind text DEFAULT 'visits'::text)
 RETURNS TABLE(on_date date, kind text, patient_member_id uuid, full_name text, phone text, mrn text, age_years integer, gender text, pin_code text, city text, practitioner_id uuid, doctor text, visit_id uuid, chief_complaint text, diagnosis text, follow_up_due date, first_seen date, visits_total integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_from date := coalesce(p_from, v_today);
  v_to date := coalesce(p_to, v_today);
  v_kind text := lower(coalesce(p_kind, 'visits'));
  v_clin boolean;
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
begin
  if not (sehat_is_admin() or coalesce(sehat_caller_role(p_business) in ('owner', 'manager', 'doctor', 'nurse'), false)) then
    raise exception 'Only the owner, a manager, a doctor or a nurse can open the register.' using errcode = '42501';
  end if;
  v_clin := sehat_is_admin() or sehat_caller_is_clinical(p_business);
  if v_from > v_to then v_from := v_to; end if;

  return query
  with enc as (   -- 0161's encounters: every visit day, a token without a visit, an admission
    select distinct on (x.member, x.d) x.member, x.d, x.doc, x.k, x.visit
      from (
        select v.patient_member_id member, v.visit_date d, v.practitioner_id doc, 'opd'::text k, v.id visit, 1 pri
          from patient_visits v
         where v.business_id = p_business and v.patient_member_id is not null and v.visit_date is not null
        union all
        select q.patient_member_id, q.queue_date, q.practitioner_id, 'opd', null::uuid, 2
          from opd_queue q
         where q.business_id = p_business and q.visit_id is null and q.status not in ('skipped', 'left')
        union all
        select a.patient_member_id, (a.admitted_at at time zone 'Asia/Kolkata')::date, a.attending_practitioner_id, 'ipd', null::uuid, 0
          from admissions a where a.business_id = p_business
      ) x
     order by x.member, x.d, x.pri
  ),
  pat as (
    select bp.patient_member_id member, (bp.first_seen_at at time zone 'Asia/Kolkata')::date first_seen,
           bp.mrn, bp.primary_practitioner_id prim,
           (select count(*) from enc e where e.member = bp.patient_member_id)::integer n,
           pm.full_name, pa.phone, coalesce(date_part('year', age(v_today, pm.date_of_birth))::integer, pm.age_years) age,
           pm.gender, pa.pin_code, nullif(btrim(pa.city), '') city
      from business_patients bp
      join patient_members pm on pm.id = bp.patient_member_id
      join patients pa on pa.id = pm.patient_id
     where bp.business_id = p_business and pm.status = 'active'
  ),
  rows as (
    -- visits / admissions: one row per encounter day
    select e.d, e.k, e.member, e.doc, e.visit from enc e
     where v_kind in ('visits', 'admissions') and e.d between v_from and v_to
       and (v_kind = 'visits' or e.k = 'ipd')
       and (p_doctor is null or e.doc = p_doctor)
    union all
    -- patients seen / returning: one row per person, their latest day in range
    select s.d, s.k, s.member, s.doc, s.visit from (
      select distinct on (e.member) e.d, e.k, e.member, e.doc, e.visit
        from enc e where e.d between v_from and v_to and (p_doctor is null or e.doc = p_doctor)
       order by e.member, e.d desc
    ) s
     where v_kind in ('patients', 'returning')
       -- 0225: returning = this visit is not their first here.
       and (v_kind = 'patients' or s.d > (select min(e2.d) from enc e2 where e2.member = s.member))
    union all
    -- new patients counted on registration day even with no visit written (as 0161)
    select p.first_seen, 'new', p.member, coalesce(p.prim, (select e.doc from enc e where e.member = p.member and e.doc is not null order by e.d limit 1)), null
      from pat p
     where v_kind in ('new', 'patients') and p.first_seen between v_from and v_to
       and not exists (select 1 from enc e where e.member = p.member and e.d between v_from and v_to)
       and (p_doctor is null or p.prim = p_doctor or exists (select 1 from enc e where e.member = p.member and e.doc = p_doctor))
    union all
    select p.first_seen, 'new', p.member, coalesce(p.prim, (select e.doc from enc e where e.member = p.member and e.doc is not null order by e.d limit 1)), null
      from pat p
     where v_kind = 'new' and p.first_seen between v_from and v_to
       and exists (select 1 from enc e where e.member = p.member and e.d between v_from and v_to)
       and (p_doctor is null or p.prim = p_doctor or exists (select 1 from enc e where e.member = p.member and e.doc = p_doctor))
    union all
    -- follow-ups due in range (0161 counts today..+7) / missed (due, no later visit)
    select v.follow_up_due, 'follow_up', v.patient_member_id, v.practitioner_id, v.id
      from patient_visits v
     where v.business_id = p_business and v_kind in ('follow_ups', 'missed')
       and v.follow_up_due between v_from and v_to
       and (v_kind = 'follow_ups'
            or (v.follow_up_due < v_today and not exists (select 1 from enc e where e.member = v.patient_member_id and e.d > v.visit_date)))
       and (p_doctor is null or v.practitioner_id = p_doctor)
    union all
    -- everyone registered here
    select (select max(e.d) from enc e where e.member = p.member), 'patient', p.member, p.prim, null
      from pat p
     where v_kind = 'all'
       and (p_doctor is null or p.prim = p_doctor or exists (select 1 from enc e where e.member = p.member and e.doc = p_doctor))
  )
  select r.d, r.k, r.member, p.full_name, p.phone, p.mrn, p.age, p.gender, p.pin_code, p.city,
         r.doc, pr.full_name,
         coalesce(r.visit, (select v.id from patient_visits v where v.business_id = p_business and v.patient_member_id = r.member
                                and v.visit_date = r.d order by v.created_at desc limit 1)),
         case when v_clin then pv.chief_complaint end,
         case when v_clin then pv.diagnosis end,
         pv.follow_up_due, p.first_seen, p.n
    from rows r
    join pat p on p.member = r.member
    left join practitioners pr on pr.id = r.doc
    left join lateral (
      select v.chief_complaint, v.diagnosis, v.follow_up_due from patient_visits v
       where v.business_id = p_business and v.patient_member_id = r.member
         and v.id = coalesce(r.visit, (select v2.id from patient_visits v2 where v2.business_id = p_business and v2.patient_member_id = r.member
                                        and v2.visit_date = r.d order by v2.created_at desc limit 1))
    ) pv on true
   where v_q is null
      or p.full_name ilike '%' || v_q || '%'
      or (length(v_digits) >= 3 and p.phone like '%' || v_digits || '%')
      or (length(v_digits) >= 3 and exists (select 1 from patient_phones x where x.patient_member_id = r.member and x.phone like '%' || v_digits || '%'))
      or upper(coalesce(p.mrn, '')) = upper(v_q)
      or p.pin_code = v_q
      or (v_clin and (pv.diagnosis ilike '%' || v_q || '%' or pv.chief_complaint ilike '%' || v_q || '%'))
   order by r.d desc nulls last, p.full_name
   limit 2000;
end $function$;

-- ── 2. The price list ───────────────────────────────────────────────────────
alter table patient_charges drop constraint if exists patient_charges_category_check;
alter table patient_charges add constraint patient_charges_category_check
  check (category in ('consultation', 'bed', 'procedure', 'medicine', 'lab', 'consumable', 'product', 'other'));

create table if not exists clinic_price_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  category text not null default 'lab'
    check (category in ('consultation', 'procedure', 'medicine', 'lab', 'consumable', 'product', 'other')),
  price numeric(12,2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clinic_price_items_business_idx on clinic_price_items (business_id) where is_active;
create unique index if not exists clinic_price_items_name_idx on clinic_price_items (business_id, lower(btrim(name))) where is_active;
alter table clinic_price_items enable row level security;
revoke all on clinic_price_items from anon;
grant select, insert, update on clinic_price_items to authenticated;

drop policy if exists clinic_reads_price_items on clinic_price_items;
create policy clinic_reads_price_items on clinic_price_items for select to authenticated
  using (sehat_caller_owns_business(business_id));
drop policy if exists manager_adds_price_items on clinic_price_items;
create policy manager_adds_price_items on clinic_price_items for insert to authenticated
  with check (sehat_is_admin() or sehat_caller_is_business(business_id));
drop policy if exists manager_changes_price_items on clinic_price_items;
create policy manager_changes_price_items on clinic_price_items for update to authenticated
  using (sehat_is_admin() or sehat_caller_is_business(business_id))
  with check (sehat_is_admin() or sehat_caller_is_business(business_id));

-- The revenue report: things sold are shown under Other.
CREATE OR REPLACE FUNCTION public.sehat_revenue_report(p_business uuid, p_grain text DEFAULT 'month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_practitioner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(period_start date, period_end date, consultation numeric, bed numeric, medicine numeric, procedure_ numeric, lab numeric, consumable numeric, other numeric, billed_total numeric, collected numeric, bills_issued integer, patients_seen integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_grain text := lower(coalesce(p_grain, 'month'));
  v_from  date;
  v_to    date;
  -- 0121: one doctor's figures. A doctor is always held to their own.
  v_doc   uuid := p_practitioner;
  v_one   boolean := p_practitioner is not null;
begin
  if not sehat_caller_is_business(p_business)
     and coalesce(sehat_caller_role(p_business), '') <> 'doctor' then
    raise exception 'Only an owner, manager or doctor can read the revenue report'
      using errcode = '42501';
  end if;
  if not sehat_caller_is_business(p_business) then
    v_doc := sehat_caller_practitioner_id();
    v_one := true;
    if v_doc is null then raise exception 'No doctor profile is linked to this login.' using errcode = '42501'; end if;
  end if;

  if v_grain not in ('day','week','month','quarter','half','year') then
    v_grain := 'month';
  end if;

  -- Default window: wide enough to be useful at every grain, and bounded so a
  -- clinic with years of history does not get a thousand rows by accident.
  v_to   := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from := coalesce(p_from, case v_grain
                       when 'day'     then v_to - 30
                       when 'week'    then v_to - 182
                       when 'month'   then (v_to - interval '11 months')::date
                       when 'quarter' then (v_to - interval '2 years')::date
                       when 'half'    then (v_to - interval '3 years')::date
                       else                (v_to - interval '5 years')::date
                     end);
  -- A backwards range is a caller mistake, not a reason to return nothing odd.
  if v_from > v_to then
    declare v_swap date := v_from; begin v_from := v_to; v_to := v_swap; end;
  end if;

  return query
  with charges as (
    select sehat_period_start(ch.charged_on, v_grain) as p,
           ch.category,
           ch.amount,
           ch.patient_member_id
      from patient_charges ch
      -- A withdrawn document is not revenue. An unbilled charge still is.
      left join patient_bills b on b.id = ch.bill_id
     where ch.business_id = p_business
       and (not v_one or ch.practitioner_id = v_doc)
       and ch.charged_on between v_from and v_to
       and (ch.bill_id is null
            or (b.status <> 'cancelled' and b.superseded_by is null))
  ),
  paid as (
    select sehat_period_start(pm.received_on, v_grain) as p,
           sum(pm.amount) as amount
      from patient_payments pm
     where pm.business_id = p_business
       and (not v_one or pm.practitioner_id = v_doc)
       and pm.received_on between v_from and v_to
     group by 1
  ),
  bills as (
    select sehat_period_start(bi.issued_at::date, v_grain) as p,
           count(*)::integer as n
      from patient_bills bi
     where bi.business_id = p_business
       and (not v_one or exists (select 1 from patient_charges c2 where c2.bill_id = bi.id and c2.practitioner_id = v_doc))
       and bi.issued_at is not null
       and bi.issued_at::date between v_from and v_to
       and bi.status <> 'cancelled'
       and bi.superseded_by is null
     group by 1
  ),
  -- Every period that has any activity at all, so a month with collections but
  -- no new charges still appears rather than silently vanishing.
  periods as (
    select p from charges union
    select p from paid    union
    select p from bills
  )
  select
    pr.p,
    sehat_period_end(pr.p, v_grain),
    coalesce(sum(c.amount) filter (where c.category = 'consultation'), 0),
    coalesce(sum(c.amount) filter (where c.category = 'bed'),          0),
    coalesce(sum(c.amount) filter (where c.category = 'medicine'),     0),
    coalesce(sum(c.amount) filter (where c.category = 'procedure'),    0),
    coalesce(sum(c.amount) filter (where c.category = 'lab'),          0),
    coalesce(sum(c.amount) filter (where c.category = 'consumable'),   0),
    coalesce(sum(c.amount) filter (where c.category in ('other', 'product')),        0),
    coalesce(sum(c.amount), 0),
    coalesce(max(pd.amount), 0),
    coalesce(max(bl.n), 0),
    count(distinct c.patient_member_id)::integer
    from periods pr
    left join charges c  on c.p  = pr.p
    left join paid    pd on pd.p = pr.p
    left join bills   bl on bl.p = pr.p
   group by pr.p
   order by pr.p desc;
end;
$function$;

-- ── The invoice at the counter ──────────────────────────────────────────────
-- p_lines: [{ category, description, quantity, unit_price }]. p_charge_ids:
-- charges already on the patient's account and not yet billed (the day's OPD
-- fee, say) to put on the same invoice. Never a stay's charges: those belong
-- to the IPD bill. Everything happens or nothing does.
create or replace function sehat_counter_invoice(
  p_business uuid, p_member uuid, p_lines jsonb,
  p_charge_ids uuid[] default '{}',
  p_discount numeric default 0, p_discount_reason text default null, p_round_off numeric default 0,
  p_paid numeric default 0, p_method text default 'cash', p_reference text default null,
  p_recorded_by uuid default null, p_doctor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_qty numeric;
  v_rate numeric;
  v_desc text;
  v_cat text;
  v_subtotal numeric(12,2);
  v_net numeric(12,2);
  v_bill uuid;
  v_no text;
  v_token text;
  m record;
  b record;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = p_member) then
    raise exception 'Register the patient here first.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 60 then
    raise exception 'An invoice takes up to 60 lines.' using errcode = '22023';
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_desc := left(btrim(coalesce(l ->> 'description', '')), 200);
    v_cat := coalesce(nullif(l ->> 'category', ''), 'other');
    v_qty := coalesce(nullif(l ->> 'quantity', '')::numeric, 1);
    v_rate := coalesce(nullif(l ->> 'unit_price', '')::numeric, 0);
    if v_desc = '' then raise exception 'Every line needs to say what it is for.' using errcode = '22023'; end if;
    if v_cat not in ('consultation', 'procedure', 'medicine', 'lab', 'consumable', 'product', 'other') then
      raise exception 'Unknown kind of charge: %', v_cat using errcode = '22023';
    end if;
    if v_qty <= 0 or v_qty > 9999 or v_rate < 0 or v_rate > 9999999 then
      raise exception 'Check the quantity and rate of "%".', v_desc using errcode = '22023';
    end if;
    insert into patient_charges (business_id, patient_member_id, category, description, quantity, unit_price, amount, recorded_by, practitioner_id)
    values (p_business, p_member, v_cat, v_desc, v_qty, v_rate, round(v_qty * v_rate, 2), p_recorded_by, p_doctor)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Charges already there, if asked for and still free to bill.
  select v_ids || coalesce(array_agg(c.id), '{}') into v_ids
    from patient_charges c
   where c.id = any(coalesce(p_charge_ids, '{}')) and c.business_id = p_business and c.patient_member_id = p_member
     and c.bill_id is null and c.admission_id is null;

  if cardinality(v_ids) = 0 then
    raise exception 'There is nothing to put on this invoice.' using errcode = '22023';
  end if;

  select coalesce(sum(c.amount), 0) into v_subtotal from patient_charges c where c.id = any(v_ids);
  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_subtotal then
    raise exception 'The discount is more than the invoice.' using errcode = '22023';
  end if;
  if coalesce(p_discount, 0) > 0 and btrim(coalesce(p_discount_reason, '')) = '' then
    raise exception 'Say why the discount is given.' using errcode = '22023';
  end if;
  if abs(coalesce(p_round_off, 0)) >= 1 then
    raise exception 'Rounding is less than a rupee.' using errcode = '22023';
  end if;
  v_net := v_subtotal - coalesce(p_discount, 0) + coalesce(p_round_off, 0);
  if coalesce(p_paid, 0) < 0 or coalesce(p_paid, 0) > v_net then
    raise exception 'The payment is more than the invoice (%).', v_net using errcode = '22023';
  end if;

  select mm.full_name, mm.age_years, mm.gender, pa.phone into m
    from patient_members mm join patients pa on pa.id = mm.patient_id where mm.id = p_member;
  select bb.name, bb.address, bb.phone, bb.gstin into b from businesses bb where bb.id = p_business;

  insert into patient_bills (
    bill_no, business_id, patient_member_id, bill_type,
    patient_name, patient_age, patient_gender, patient_phone, mrn,
    clinic_name, clinic_address, clinic_phone, clinic_gstin,
    subtotal, discount_amount, discount_reason, round_off, net_payable, issued_by)
  values (
    sehat_next_bill_number(p_business), p_business, p_member, 'account',
    m.full_name, m.age_years, m.gender, m.phone,
    (select bp.mrn from business_patients bp where bp.patient_member_id = p_member and bp.business_id = p_business),
    b.name, b.address, b.phone, b.gstin,
    v_subtotal, coalesce(p_discount, 0), nullif(btrim(coalesce(p_discount_reason, '')), ''), coalesce(p_round_off, 0), v_net, p_recorded_by)
  returning id, bill_no, public_token::text into v_bill, v_no, v_token;

  insert into patient_bill_items (bill_id, charge_id, category, description, quantity, unit_price, amount, charged_on, sort_order)
  select v_bill, c.id, c.category, c.description, c.quantity, c.unit_price, c.amount, c.charged_on,
         (row_number() over (order by c.charged_on, c.created_at, c.id))::integer
    from patient_charges c where c.id = any(v_ids);
  update patient_charges set bill_id = v_bill where id = any(v_ids);

  if coalesce(p_paid, 0) > 0 then
    insert into patient_payments (business_id, patient_member_id, amount, method, reference, bill_id, recorded_by)
    values (p_business, p_member, p_paid, coalesce(nullif(p_method, ''), 'cash'), nullif(btrim(coalesce(p_reference, '')), ''), v_bill, p_recorded_by);
  end if;

  return jsonb_build_object('bill_id', v_bill, 'bill_no', v_no, 'token', v_token, 'net', v_net, 'paid', coalesce(p_paid, 0));
end $$;
revoke all on function sehat_counter_invoice(uuid, uuid, jsonb, uuid[], numeric, text, numeric, numeric, text, text, uuid, uuid) from public, anon;
grant execute on function sehat_counter_invoice(uuid, uuid, jsonb, uuid[], numeric, text, numeric, numeric, text, text, uuid, uuid) to authenticated;

-- ── 3. The day by head ──────────────────────────────────────────────────────
-- What was charged in the period, by head. Owner and manager (the people who
-- see everybody's collections); anyone else gets nothing.
create or replace function sehat_day_heads(p_business uuid, p_from date, p_to date)
returns table (head text, lines integer, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_business)) then return; end if;
  return query
    select c.category, count(*)::integer, coalesce(sum(c.amount), 0)::numeric
      from patient_charges c
     where c.business_id = p_business and c.charged_on between p_from and p_to
     group by c.category
    union all
    select 'pharmacy', count(*)::integer, coalesce(sum(pb.net_payable), 0)::numeric
      from pharmacy_bills pb
     where pb.business_id = p_business and pb.status = 'issued'
       and (pb.issued_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    having count(*) > 0;
end $$;
revoke all on function sehat_day_heads(uuid, date, date) from public, anon;
grant execute on function sehat_day_heads(uuid, date, date) to authenticated;

-- ── 4. Deleting a medicine ──────────────────────────────────────────────────
create or replace function sehat_pharmacy_delete_item(p_item uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i pharmacy_items;
  v_in_hand integer;
  v_bills integer;
begin
  select * into i from pharmacy_items where id = p_item for update;
  if i.id is null then raise exception 'That medicine is not there any more.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(i.business_id, true);

  select coalesce(sum(b.qty_in_hand), 0) into v_in_hand from pharmacy_batches b where b.item_id = i.id;
  if v_in_hand <> 0 then
    raise exception '% still has % in hand (expired stock counts). Correct each batch''s count to 0 first, then delete.', i.name, v_in_hand
      using errcode = 'P0001';
  end if;

  select count(distinct bi.bill_id) into v_bills from pharmacy_bill_items bi where bi.item_id = i.id;
  if v_bills > 0 then
    -- Sold before: the bills and the stock history must keep pointing at it.
    update pharmacy_items set is_active = false, updated_at = now() where id = i.id;
    return jsonb_build_object('deleted', false, 'kept_for_bills', v_bills, 'name', i.name);
  end if;

  delete from pharmacy_items where id = i.id;      -- its empty batches and their history go with it
  perform sehat_log_staff_action('pharmacy_item_deleted', 'business', i.business_id, i.name, jsonb_build_object('item', i.id));
  return jsonb_build_object('deleted', true, 'name', i.name);
end $$;
revoke all on function sehat_pharmacy_delete_item(uuid) from public, anon;
grant execute on function sehat_pharmacy_delete_item(uuid) to authenticated;

notify pgrst, 'reload schema';
