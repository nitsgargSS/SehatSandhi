-- ============================================================================
-- Sehatsandhi — the patient report: how many, how often, from where, who
--
-- Run AFTER 0140 on production (or after 0160 on sandbox). Reads only tables
-- from 0047–0110 and nothing from 0141–0160, so it can go to production on its
-- own. Safe to re-run.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- A clinic growing its practice asks: how many patients have we had in all?
-- How many new ones this week, this month, this year — and how many came
-- back? Which towns and pincodes do they come from, and which not? Who are
-- they (age, gender), how did they find us, which doctor saw them, what did
-- they come with, whose follow-up is due, who has stopped coming? The existing
-- reports answer pieces (0019 listing views and bookings, 0112 patients by
-- pincode, 0091 money); nothing answered these.
--
-- ── WHAT A "VISIT" IS ───────────────────────────────────────────────────────
-- A day a patient was at the clinic: a visit note (patient_visits), an OPD
-- token not turned into a note (opd_queue, not skipped or left), or an
-- admission. One patient on one day is one visit however many of those there
-- were, so a token and the note written from it are not counted twice.
--
-- A "new" patient is one whose business_patients.first_seen_at falls in the
-- period; "returning" is anyone seen in the period who was first seen before
-- it. Days are Indian days.
--
-- ── WHERE THEY COME FROM ────────────────────────────────────────────────────
-- patients.pin_code, recorded since 0111 (bot bookings, and the front desk
-- when it asks). District and state come from pincode_directory; a patient
-- with no pincode but a city from an imported register is grouped by that
-- city. Everyone else is "not recorded" — the report says how many, because
-- that number is the reason to ask for a PIN at the desk.
--
-- ── WHO MAY READ IT ─────────────────────────────────────────────────────────
-- Owner, clinic manager and doctors — the people who run and grow the
-- practice — and Sehatsandhi admins. It includes a win-back list with names
-- and phone numbers, which is the clinic's own register, not reception's.
-- ============================================================================

create or replace function sehat_patient_report(
  p_business uuid,
  p_from date,
  p_to date,
  p_grain text default 'month'
) returns jsonb
-- Volatile only because it builds two temporary tables; it writes nothing else.
language plpgsql volatile security definer set search_path = public as $$
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
      'returning', (select count(*) from seen s join _pr_pat p on p.member = s.member where p.first_seen < v_from),
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
end $$;

revoke all on function sehat_patient_report(uuid, date, date, text) from public, anon;
grant execute on function sehat_patient_report(uuid, date, date, text) to authenticated;

notify pgrst, 'reload schema';

-- ── NOT HERE ────────────────────────────────────────────────────────────────
-- • A doctor seeing only their own patients here. Doctors read the whole
--   clinic, as they already do in the listing report; a per-doctor filter is
--   the by_doctor table.
-- • Sending the win-back list a WhatsApp broadcast. The list is here to
--   export; broadcasts have their own approval flow.
