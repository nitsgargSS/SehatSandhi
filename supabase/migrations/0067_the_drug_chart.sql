-- ============================================================================
-- Sehatsandhi — the drug chart, and the nurse who works from it
--
-- Run AFTER 0066. Safe to re-run.
--
-- ── WHY IPD NEEDED THIS ─────────────────────────────────────────────────────
-- Everything built for inpatients so far is the administrative shell of a stay:
-- admit, assign a bed, write progress notes, discharge, bill the bed-days. What
-- a ward actually does hour by hour was missing, and the biggest piece of it is
-- the drug chart.
--
-- In OPD a prescription is a slip the patient carries away. In IPD it is a
-- chart the nurse works from every shift.
--
-- ── PRESCRIBED IS NOT ADMINISTERED ──────────────────────────────────────────
-- The one principle everything below follows from. A doctor orders amoxicillin
-- 500mg three times a day; what matters clinically is that the 14:00 dose was
-- missed because the patient was in theatre. A "given" flag on the order loses
-- that, and the misses are where harm lives. So: two tables, never one.
--
-- ── DUE DOSES ARE COMPUTED, NOT STORED ──────────────────────────────────────
-- The alternative is writing a row per dose per day in advance and filling it
-- in. That needs a scheduler, breaks when an order is stopped mid-day, and
-- leaves rows nobody created deliberately. Here the order is the source of
-- truth and medication_due expands it; a missed dose is a slot with no matching
-- record, which is explicit by construction rather than an ambiguous blank box.
--
-- ── AND A NURSE ─────────────────────────────────────────────────────────────
-- 0057 split people into clinical (owner, doctor) and not (reception, manager),
-- and noted that a nurse recording vitals had to be given 'doctor'. That was
-- untidy then and unsafe now, because 'doctor' means may-prescribe. The split
-- becomes real here:
--
--   sehat_caller_is_clinical    owner, doctor, NURSE   sees and charts the record
--   sehat_caller_may_prescribe  owner, doctor          writes orders
-- ============================================================================


-- ============================================================================
-- 1. The nurse
-- ============================================================================

alter table business_practitioners drop constraint if exists business_practitioners_role_check;
alter table business_practitioners add constraint business_practitioners_role_check
  check (role in ('owner','doctor','nurse','receptionist','manager'));

-- Nurses join the clinical side. They chart observations, administer drugs and
-- read the record; that is the job.
create or replace function sehat_caller_is_clinical(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(sehat_caller_role(p_business) in ('owner', 'doctor', 'nurse'), false);
$$;

comment on function sehat_caller_is_clinical is
  'May the caller see and chart this business''s medical records. Owner, doctor '
  'and nurse. NOT a licence to prescribe — see sehat_caller_may_prescribe.';

-- The narrower one. Ordering a drug, writing a prescription, signing a
-- discharge summary and reading the business''s money are all things a nurse
-- does not do.
create or replace function sehat_caller_may_prescribe(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(sehat_caller_role(p_business) in ('owner', 'doctor'), false);
$$;

comment on function sehat_caller_may_prescribe is
  'May the caller write medication orders and prescriptions. Owner and doctor '
  'only. Added in 0067 because adding a nurse to is_clinical would otherwise '
  'have handed them a prescribing pad.';

grant execute on function sehat_caller_may_prescribe(uuid) to authenticated;
revoke all on function sehat_caller_may_prescribe(uuid) from public, anon;

-- Everything that meant "owner or doctor" and must keep meaning that, now that
-- is_clinical is wider. Missing one of these is how a nurse ends up able to
-- issue a prescription.
create or replace function sehat_only_clinicians_issue()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if not sehat_caller_may_prescribe(new.business_id) then
    raise exception
      'only a doctor can issue this — your account is registered as %',
      coalesce(sehat_caller_role(new.business_id), 'having no access here')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- An examination is a doctor's act; a nurse charts observations, not findings.
create or replace function sehat_save_findings(
  p_visit_id uuid, p_speciality text, p_findings jsonb, p_recorded_by uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v record; f jsonb; n integer := 0; v_unit text;
begin
  select pv.business_id, pv.patient_member_id into v
    from patient_visits pv where pv.id = p_visit_id;
  if not found then raise exception 'no such visit'; end if;
  if not sehat_caller_may_prescribe(v.business_id) then
    raise exception 'only a doctor can record an examination'
      using errcode = 'insufficient_privilege';
  end if;

  delete from visit_findings where visit_id = p_visit_id;
  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb))
  loop
    continue when coalesce(btrim(f ->> 'text'), '') = '' and (f ->> 'num') is null;
    select sf.unit into v_unit from speciality_fields sf
     where sf.speciality = p_speciality and sf.code = f ->> 'code';
    insert into visit_findings (
      visit_id, business_id, patient_member_id, speciality,
      field_code, site, value_num, value_text, unit, recorded_by
    ) values (
      p_visit_id, v.business_id, v.patient_member_id, p_speciality,
      f ->> 'code', nullif(btrim(coalesce(f ->> 'site','')), ''),
      (nullif(btrim(coalesce(f ->> 'num','')), ''))::numeric,
      nullif(btrim(coalesce(f ->> 'text','')), ''), v_unit, p_recorded_by
    );
    n := n + 1;
  end loop;
  return n;
end $$;


-- ============================================================================
-- 2. What the doctor ordered
-- ============================================================================

create table if not exists admission_medication_orders (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,

  drug_name text not null,
  strength text,
  form text,
  route text not null default 'oral'
    check (route in ('oral','iv','im','sc','sl','ng','pr','pv','topical','inhaled','eye','ear','other')),
  dose_text text not null,                    -- '1 tab', '500 mg', '10 units'

  frequency_code text not null default 'BD'
    check (frequency_code in ('OD','BD','TDS','QID','HS','Q4H','Q6H','Q8H','Q12H','SOS','STAT','OTHER')),
  -- The clock times this is due. Explicit rather than derived from the code:
  -- one ward's round is 08:00/14:00/20:00 and another's is 06:00/12:00/18:00,
  -- and an Indian chart is written 1-0-1 anyway. Empty for SOS and STAT, which
  -- have no schedule to keep.
  times time[] not null default '{}',

  prn boolean not null default false,         -- as required
  prn_indication text,                        -- 'for fever above 101'
  max_per_day integer,                        -- the PRN ceiling

  start_at timestamptz not null default now(),
  stop_at timestamptz,
  instructions text,

  ordered_by uuid references practitioners(id) on delete set null,
  ordered_at timestamptz not null default now(),
  stopped_by uuid references practitioners(id) on delete set null,
  stopped_at timestamptz,
  stop_reason text,

  status text not null default 'active' check (status in ('active','stopped','completed')),
  -- Set when the ward round noted an allergy and prescribed anyway. Recorded,
  -- not prevented: the decision is the doctor's and the record should show they
  -- made it knowingly.
  allergy_override text,

  created_at timestamptz not null default now(),

  constraint med_order_prn_needs_reason
    check (not prn or coalesce(btrim(prn_indication), '') <> ''),
  constraint med_order_scheduled_needs_times
    check (frequency_code in ('SOS','STAT','OTHER') or array_length(times, 1) > 0)
);

create index if not exists med_orders_admission_idx
  on admission_medication_orders (admission_id, status);

comment on table admission_medication_orders is
  'What the doctor wants given. Never says whether it happened — that is '
  'medication_administrations, and the gap between the two is the clinical '
  'record.';


-- ============================================================================
-- 3. What the nurse actually did
-- ============================================================================

create table if not exists medication_administrations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references admission_medication_orders(id) on delete cascade,
  admission_id uuid not null references admissions(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,

  -- The slot this satisfies. Null for PRN and STAT, which answer to no
  -- schedule; the unique index below is partial for exactly that reason.
  due_at timestamptz,

  status text not null
    check (status in ('given','refused','withheld','omitted','self_administered')),
  given_at timestamptz not null default now(),
  dose_given text,
  route_given text,

  given_by uuid references practitioners(id) on delete set null,
  -- Second signature. Not enforced here: which drugs need one is a policy that
  -- differs by hospital, and a constraint we cannot get right is worse than a
  -- column a ward can use.
  witnessed_by uuid references practitioners(id) on delete set null,

  reason text,
  notes text,

  -- Never deleted. Striking through and re-entering is what a paper chart does
  -- and what an auditor expects to see.
  voided_at timestamptz,
  voided_by uuid references practitioners(id) on delete set null,
  void_reason text,

  created_at timestamptz not null default now(),

  constraint med_admin_reason_when_not_given
    check (status = 'given' or coalesce(btrim(reason), '') <> '')
);

-- One live record per slot. Charting the same dose twice is a mistake, not two
-- doses — and on a drug chart that mistake reads as a double dose.
create unique index if not exists med_admin_one_per_slot
  on medication_administrations (order_id, due_at)
  where due_at is not null and voided_at is null;

create index if not exists med_admin_order_idx
  on medication_administrations (order_id, given_at desc);

comment on table medication_administrations is
  'Append-only. A mistake is voided with a reason and re-entered, never edited '
  'or deleted — the same discipline as striking a line through a paper chart.';


-- ============================================================================
-- 4. The chart
--
-- Expands active scheduled orders into slots and left-joins what was recorded.
-- Bounded to a few days either side of now: a ward round looks at today, and
-- expanding a three-week stay every time the screen opens is work nobody asked
-- for.
-- ============================================================================

create or replace view medication_due as
with o as (
  select mo.id, mo.admission_id, mo.business_id, mo.patient_member_id,
         mo.drug_name, mo.strength, mo.dose_text, mo.route, mo.frequency_code,
         mo.times, mo.start_at, mo.stop_at, mo.instructions,
         a.admitted_at,
         -- Infinity while they are still in, NOT now(). Using now() caps the
         -- window at today and the chart shows no future doses at all — a drug
         -- chart that cannot show tonight's dose is not a drug chart. The
         -- forward horizon is set by the now() + 1 day bound below.
         coalesce(a.discharged_at, 'infinity'::timestamptz) as stay_end
    from admission_medication_orders mo
    join admissions a on a.id = mo.admission_id
   where mo.status = 'active'
     and not mo.prn
     and array_length(mo.times, 1) > 0
),
slots as (
  select o.*,
         ((d::date + t) at time zone 'Asia/Kolkata') as due_at
    from o
    cross join lateral generate_series(
      greatest(o.start_at, o.admitted_at, now() - interval '3 days')::date,
      least(coalesce(o.stop_at, 'infinity'::timestamptz), o.stay_end, now() + interval '1 day')::date,
      interval '1 day') d
    cross join lateral unnest(o.times) t
)
select
  s.id as order_id, s.admission_id, s.business_id, s.patient_member_id,
  s.drug_name, s.strength, s.dose_text, s.route, s.frequency_code, s.instructions,
  s.due_at,
  ma.id as administration_id,
  ma.status as recorded_status,
  ma.given_at, ma.dose_given, ma.given_by, ma.reason,
  case
    when ma.id is not null then ma.status
    -- An hour's grace before a dose counts as missed. Drug rounds run late and
    -- a chart that shouts at 08:01 is a chart nobody reads.
    when s.due_at < now() - interval '1 hour' then 'missed'
    else 'due'
  end as slot_status
from slots s
left join medication_administrations ma
  on ma.order_id = s.id and ma.due_at = s.due_at and ma.voided_at is null
where s.due_at between s.start_at and coalesce(s.stop_at, 'infinity'::timestamptz)
  and s.business_id in (select sehat_caller_business_ids())
  and sehat_caller_is_clinical(s.business_id);

-- Both layers, deliberately. The WHERE above already scopes to the caller's
-- own clinics, so this is not what stops a leak today — it is what stops one
-- the day somebody edits that WHERE. Without it the view runs as its owner and
-- the base tables' RLS is skipped entirely, so a single bad edit to one line
-- would expose every clinic's drug chart with nothing else to catch it.
--
-- 31 other views in this schema are still missing this. None of them leak —
-- measured, not assumed: each scopes itself the same way. Fixing them is a
-- migration of its own, because switching a view to invoker rights means the
-- caller now needs SELECT policies on every base table it touches, and getting
-- that wrong turns a working screen blank.
alter view medication_due set (security_invoker = on);

comment on view medication_due is
  'The drug chart: one row per scheduled dose, labelled due, given, missed, '
  'refused or withheld. Slots are computed from the order rather than written '
  'in advance, so stopping an order mid-day simply stops producing them.';


-- ============================================================================
-- 5. Writing to it
-- ============================================================================

create or replace function sehat_order_medication(
  p_admission_id uuid,
  p_drug_name text,
  p_dose_text text,
  p_frequency_code text default 'BD',
  p_times time[] default null,
  p_route text default 'oral',
  p_strength text default null,
  p_form text default null,
  p_prn boolean default false,
  p_prn_indication text default null,
  p_max_per_day integer default null,
  p_instructions text default null,
  p_ordered_by uuid default null,
  p_allergy_override text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare a record; v_id uuid; v_times time[];
begin
  select ad.business_id, ad.patient_member_id, ad.status
    into a from admissions ad where ad.id = p_admission_id;
  if not found then raise exception 'no such admission'; end if;
  if not sehat_caller_may_prescribe(a.business_id) then
    raise exception 'only a doctor can order medication'
      using errcode = 'insufficient_privilege';
  end if;
  if a.status <> 'admitted' then
    raise exception 'this patient is not admitted';
  end if;

  -- Sensible round times when the prescriber does not name them. A ward can
  -- override per order; these are only what BD means if nobody says otherwise.
  v_times := coalesce(p_times, case p_frequency_code
    when 'OD'   then array['08:00']::time[]
    when 'BD'   then array['08:00','20:00']::time[]
    when 'TDS'  then array['08:00','14:00','20:00']::time[]
    when 'QID'  then array['06:00','12:00','18:00','22:00']::time[]
    when 'HS'   then array['22:00']::time[]
    when 'Q4H'  then array['06:00','10:00','14:00','18:00','22:00','02:00']::time[]
    when 'Q6H'  then array['06:00','12:00','18:00','00:00']::time[]
    when 'Q8H'  then array['06:00','14:00','22:00']::time[]
    when 'Q12H' then array['08:00','20:00']::time[]
    else '{}'::time[] end);

  insert into admission_medication_orders (
    admission_id, business_id, patient_member_id, drug_name, strength, form,
    route, dose_text, frequency_code, times, prn, prn_indication, max_per_day,
    instructions, ordered_by, allergy_override
  ) values (
    p_admission_id, a.business_id, a.patient_member_id, btrim(p_drug_name),
    p_strength, p_form, p_route, btrim(p_dose_text), p_frequency_code,
    case when p_prn or p_frequency_code in ('SOS','STAT') then '{}'::time[] else v_times end,
    p_prn, p_prn_indication, p_max_per_day, p_instructions, p_ordered_by,
    p_allergy_override
  ) returning id into v_id;

  return v_id;
end $$;


create or replace function sehat_stop_medication(
  p_order_id uuid, p_reason text, p_stopped_by uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from admission_medication_orders where id = p_order_id;
  if not found then raise exception 'no such order'; end if;
  if not sehat_caller_may_prescribe(v_biz) then
    raise exception 'only a doctor can stop medication' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'say why it is being stopped'; end if;

  update admission_medication_orders
     set status = 'stopped', stopped_at = now(), stopped_by = p_stopped_by,
         stop_reason = p_reason, stop_at = coalesce(stop_at, now())
   where id = p_order_id;
end $$;


-- The nurse's call, and the only one they need.
create or replace function sehat_record_administration(
  p_order_id uuid,
  p_status text,
  p_due_at timestamptz default null,
  p_dose_given text default null,
  p_reason text default null,
  p_given_by uuid default null,
  p_witnessed_by uuid default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare o record; v_id uuid;
begin
  select * into o from admission_medication_orders where id = p_order_id;
  if not found then raise exception 'no such order'; end if;
  -- is_clinical, not may_prescribe: administering is the nursing act this whole
  -- migration exists to make possible.
  if not sehat_caller_is_clinical(o.business_id) then
    raise exception 'not your patient' using errcode = 'insufficient_privilege';
  end if;
  if p_status <> 'given' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a dose not given needs a reason';
  end if;

  insert into medication_administrations (
    order_id, admission_id, business_id, due_at, status, dose_given,
    route_given, given_by, witnessed_by, reason, notes
  ) values (
    p_order_id, o.admission_id, o.business_id, p_due_at, p_status,
    coalesce(p_dose_given, o.dose_text), o.route, p_given_by, p_witnessed_by,
    p_reason, p_notes
  ) returning id into v_id;

  return v_id;
end $$;


create or replace function sehat_void_administration(
  p_id uuid, p_reason text, p_voided_by uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from medication_administrations where id = p_id;
  if not found then raise exception 'no such entry'; end if;
  if not sehat_caller_is_clinical(v_biz) then
    raise exception 'not your patient' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'say why it is being struck out'; end if;

  update medication_administrations
     set voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
   where id = p_id and voided_at is null;
end $$;


-- ============================================================================
-- 6. The allergy warning
--
-- Warns, does not block — the prescriber decides, and there are real reasons to
-- give a drug somebody once reacted to. What the system owes is that they saw
-- it: the order carries allergy_override, so the record shows the decision was
-- made knowingly rather than missed.
--
-- Substring match both ways, because an allergy is recorded as "penicillin" and
-- the order says "Amoxicillin" — so a name list per family is what actually
-- catches it, not string equality.
-- ============================================================================

create or replace function sehat_allergy_warning(p_member uuid, p_drug text)
returns table (substance text, severity text, reaction text)
language sql stable security definer set search_path = public as $$
  select pa.substance, pa.severity, pa.reaction
    from patient_allergies pa
   where pa.patient_member_id = p_member
     and pa.is_active
     and sehat_caller_is_clinical(pa.business_id)
     and (
       lower(p_drug) like '%' || lower(pa.substance) || '%'
       or lower(pa.substance) like '%' || lower(p_drug) || '%'
       -- The families that actually matter in a ward. Not exhaustive, and
       -- deliberately loud rather than clever: a false warning costs a glance,
       -- a missed one costs more.
       or (lower(pa.substance) like '%penicillin%' and lower(p_drug) similar to
           '%(amoxi|ampi|cloxa|piperacillin|augmentin)%')
       or (lower(pa.substance) like '%sulfa%' and lower(p_drug) like '%cotrimoxazole%')
       or (lower(pa.substance) like '%nsaid%' and lower(p_drug) similar to
           '%(ibuprofen|diclofenac|aceclofenac|naproxen|ketorolac)%')
     );
$$;


-- ============================================================================
-- 7. RLS
-- ============================================================================

alter table admission_medication_orders enable row level security;
alter table medication_administrations  enable row level security;

drop policy if exists clinic_reads_med_orders on admission_medication_orders;
create policy clinic_reads_med_orders on admission_medication_orders
  for select using (sehat_caller_is_clinical(business_id));

drop policy if exists clinic_reads_med_admins on medication_administrations;
create policy clinic_reads_med_admins on medication_administrations
  for select using (sehat_caller_is_clinical(business_id));

-- No insert or update policies on either. Everything goes through the functions
-- above, which decide prescribe-versus-administer and refuse a missed dose with
-- no reason. A direct insert would skip both.

grant select on medication_due to authenticated;

-- ── And take it away from anon ───────────────────────────────────────────────
-- Supabase's default privileges grant every new table and view in this schema
-- to anon and authenticated. So `anon` arrives holding SELECT, INSERT, UPDATE
-- and DELETE on a drug chart, and the ONLY thing between the open internet and
-- an inpatient's medication record is RLS.
--
-- RLS does hold — measured on both databases, all 18 clinical tables have it
-- enabled and anon gets zero rows. This is the second lock, not the first.
-- It matters because RLS is one forgotten policy away from not holding, and a
-- table anon has no grant on cannot be read even then.
--
-- 14 clinical tables on production still carry these grants (0067 fixes only
-- the ones it creates). That sweep is its own migration: each table needs its
-- real callers traced first, exactly as 0064 argued for functions.
revoke all on medication_due                 from anon;
revoke all on admission_medication_orders    from anon;
revoke all on medication_administrations     from anon;
grant execute on function sehat_order_medication(uuid, text, text, text, time[], text, text, text, boolean, text, integer, text, uuid, text) to authenticated;
grant execute on function sehat_stop_medication(uuid, text, uuid) to authenticated;
grant execute on function sehat_record_administration(uuid, text, timestamptz, text, text, uuid, uuid, text) to authenticated;
grant execute on function sehat_void_administration(uuid, text, uuid) to authenticated;
grant execute on function sehat_allergy_warning(uuid, text) to authenticated;

revoke all on function sehat_order_medication(uuid, text, text, text, time[], text, text, text, boolean, text, integer, text, uuid, text) from public, anon;
revoke all on function sehat_stop_medication(uuid, text, uuid) from public, anon;
revoke all on function sehat_record_administration(uuid, text, timestamptz, text, text, uuid, uuid, text) from public, anon;
revoke all on function sehat_void_administration(uuid, text, uuid) from public, anon;
revoke all on function sehat_allergy_warning(uuid, text) from public, anon;


-- ============================================================================
-- 8. Reports are still owner-and-doctor
--
-- 0065 gated the report on sehat_caller_is_clinical, which was owner-and-doctor
-- then and is owner-doctor-and-nurse now. Repointed, or adding the nurse role
-- would have quietly handed the nursing station the clinic's revenue.
--
-- This is the trap in widening a predicate: everything that used it inherits
-- the wider meaning, silently, and only the ones you remember get checked.
-- ============================================================================

create or replace function sehat_business_report(p_business_id uuid, p_days integer default 30)
returns table (
  day date, times_listed integer, profile_views integer, whatsapp_clicks integer,
  unique_visitors integer, bookings integer, completed integer, cancelled integer, no_show integer
)
language plpgsql stable security definer set search_path = public as $$
declare v_from date := current_date - greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not (sehat_caller_may_prescribe(p_business_id) or sehat_is_admin()) then
    raise exception 'you are not authorised to read this listing''s reports'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with days as (select generate_series(v_from, current_date, interval '1 day')::date as d),
  ev as (
    select date_trunc('day', created_at)::date as d,
           count(*) filter (where event_type = 'doctor_impression') as listed,
           count(*) filter (where event_type = 'doctor_view')       as views,
           count(*) filter (where event_type = 'whatsapp_click')    as taps,
           count(distinct session_id)                               as visitors
      from site_events where business_id = p_business_id and created_at >= v_from group by 1
  ),
  ap as (
    select date_trunc('day', created_at)::date as d,
           count(*) as booked,
           count(*) filter (where status = 'completed') as done,
           count(*) filter (where status = 'cancelled') as cancelled,
           count(*) filter (where status = 'no_show')   as missed
      from appointments where business_id = p_business_id and created_at >= v_from group by 1
  )
  select days.d, coalesce(ev.listed,0)::integer, coalesce(ev.views,0)::integer,
         coalesce(ev.taps,0)::integer, coalesce(ev.visitors,0)::integer,
         coalesce(ap.booked,0)::integer, coalesce(ap.done,0)::integer,
         coalesce(ap.cancelled,0)::integer, coalesce(ap.missed,0)::integer
    from days left join ev on ev.d = days.d left join ap on ap.d = days.d
   order by days.d;
end $$;

revoke all on function sehat_business_report(uuid, integer) from public, anon;
grant execute on function sehat_business_report(uuid, integer) to authenticated;


-- ============================================================================
-- NOT HERE
--   Infusion rates and titration — a running IV is a different shape again.
--   Controlled-drug registers with running stock balances.
--   Barcode scanning at the bedside.
--   An enforced second signature: which drugs need one is hospital policy, and
--     a rule we cannot get right is worse than the column a ward can use.
-- ============================================================================
