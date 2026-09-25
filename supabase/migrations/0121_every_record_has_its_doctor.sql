-- ============================================================================
-- Sehatsandhi — every record has its doctor; a doctor's page; the owner's view
--
-- Run AFTER 0120. Safe to re-run.
--
-- A hospital is one business with one patient list, but it has to be able to
-- see which doctor is doing what, and each doctor needs their own page
-- (decided 25 Sep 2026). Most clinical rows already name a doctor —
-- appointments, visits, prescriptions, admissions, discharge summaries, queue
-- tokens. Money did not: a charge or a payment could not say whose it was. And
-- a patient could not be "registered under" anyone.
--
--   • patient_charges.practitioner_id — filled automatically when left blank:
--     the visit's doctor, else the admission's attending doctor. Old charges
--     are backfilled the same way; the rest stay "Not assigned".
--   • patient_payments.practitioner_id — the same, via the admission or the
--     bill's visit/admission, so "collected" can be split by doctor too.
--   • business_patients.primary_practitioner_id — "Registered under Dr …".
--   • sehat_set_attending — move an admission to another doctor, noted.
--   • sehat_doctor_performance — one row per doctor for a period.
--   • sehat_doctor_patients — a doctor's own patient list.
--   • sehat_revenue_report — gains a doctor filter. A doctor only ever gets
--     their own figures (decided: doctors do not see each other's earnings);
--     owner and manager see any doctor or the whole hospital.
--
-- A doctor may still open any patient of the hospital, as today — referrals
-- and cover need it — but their page lists only their own.
-- ============================================================================

-- ── Who is this caller as a practitioner, and is X a doctor here? ───────────
create or replace function sehat_caller_practitioner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from practitioners p where p.auth_uid = auth.uid() limit 1;
$$;
revoke all on function sehat_caller_practitioner_id() from public, anon;
grant execute on function sehat_caller_practitioner_id() to authenticated;

create or replace function sehat_is_business_doctor(p_business uuid, p_practitioner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from business_practitioners bp
     where bp.business_id = p_business and bp.practitioner_id = p_practitioner
       and bp.role in ('doctor', 'owner'));
$$;
revoke all on function sehat_is_business_doctor(uuid, uuid) from public, anon;
grant execute on function sehat_is_business_doctor(uuid, uuid) to authenticated;

-- ── Charges and payments name a doctor ──────────────────────────────────────
alter table patient_charges add column if not exists practitioner_id uuid references practitioners(id) on delete set null;
create index if not exists patient_charges_practitioner_idx on patient_charges (business_id, practitioner_id, charged_on);
alter table patient_payments add column if not exists practitioner_id uuid references practitioners(id) on delete set null;
create index if not exists patient_payments_practitioner_idx on patient_payments (business_id, practitioner_id, received_on);

create or replace function sehat_charge_takes_its_doctor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.practitioner_id is null and new.visit_id is not null then
    select v.practitioner_id into new.practitioner_id from patient_visits v where v.id = new.visit_id;
  end if;
  if new.practitioner_id is null and new.admission_id is not null then
    select a.attending_practitioner_id into new.practitioner_id from admissions a where a.id = new.admission_id;
  end if;
  if new.practitioner_id is not null and not sehat_is_business_doctor(new.business_id, new.practitioner_id) then
    raise exception 'That doctor does not work at this hospital.';
  end if;
  return new;
end $$;
drop trigger if exists patient_charges_takes_its_doctor on patient_charges;
create trigger patient_charges_takes_its_doctor before insert or update of practitioner_id, visit_id, admission_id
  on patient_charges for each row execute function sehat_charge_takes_its_doctor();

create or replace function sehat_payment_takes_its_doctor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.practitioner_id is null and new.admission_id is not null then
    select a.attending_practitioner_id into new.practitioner_id from admissions a where a.id = new.admission_id;
  end if;
  if new.practitioner_id is null and new.bill_id is not null then
    select coalesce(v.practitioner_id, a.attending_practitioner_id) into new.practitioner_id
      from patient_bills b
      left join patient_visits v on v.id = b.visit_id
      left join admissions a on a.id = b.admission_id
     where b.id = new.bill_id;
  end if;
  return new;
end $$;
drop trigger if exists patient_payments_takes_its_doctor on patient_payments;
create trigger patient_payments_takes_its_doctor before insert on patient_payments
  for each row execute function sehat_payment_takes_its_doctor();

-- Backfill, where the doctor is knowable. Triggers bypassed for charges on a
-- frozen bill: the column is attribution, not what the patient was billed.
alter table patient_charges disable trigger user;
update patient_charges c set practitioner_id = v.practitioner_id
  from patient_visits v where c.practitioner_id is null and c.visit_id = v.id and v.practitioner_id is not null;
update patient_charges c set practitioner_id = a.attending_practitioner_id
  from admissions a where c.practitioner_id is null and c.admission_id = a.id and a.attending_practitioner_id is not null;
alter table patient_charges enable trigger user;
update patient_payments p set practitioner_id = a.attending_practitioner_id
  from admissions a where p.practitioner_id is null and p.admission_id = a.id and a.attending_practitioner_id is not null;
update patient_payments p set practitioner_id = coalesce(v.practitioner_id, a.attending_practitioner_id)
  from patient_bills b
  left join patient_visits v on v.id = b.visit_id
  left join admissions a on a.id = b.admission_id
 where p.practitioner_id is null and p.bill_id = b.id
   and coalesce(v.practitioner_id, a.attending_practitioner_id) is not null;

-- ── "Registered under" ──────────────────────────────────────────────────────
alter table business_patients add column if not exists primary_practitioner_id uuid references practitioners(id) on delete set null;
create index if not exists business_patients_primary_practitioner_idx on business_patients (business_id, primary_practitioner_id);

create or replace function sehat_set_patient_doctor(p_business uuid, p_member uuid, p_practitioner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'not your business' using errcode = '42501'; end if;
  if p_practitioner is not null and not sehat_is_business_doctor(p_business, p_practitioner) then
    raise exception 'That doctor does not work at this hospital.';
  end if;
  update business_patients set primary_practitioner_id = p_practitioner, updated_at = now()
   where business_id = p_business and patient_member_id = p_member;
  if not found then raise exception 'That patient is not on this hospital''s list.'; end if;
end $$;
revoke all on function sehat_set_patient_doctor(uuid, uuid, uuid) from public, anon;
grant execute on function sehat_set_patient_doctor(uuid, uuid, uuid) to authenticated;

-- ── Move an admission to another doctor ─────────────────────────────────────
-- Charges already posted stay with the doctor they were posted to; charges
-- from now on follow the new attending doctor.
create or replace function sehat_set_attending(p_admission uuid, p_practitioner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_adm admissions; v_name text;
begin
  select * into v_adm from admissions where id = p_admission;
  if v_adm.id is null then raise exception 'no such admission'; end if;
  if not sehat_caller_owns_business(v_adm.business_id) then raise exception 'not your business' using errcode = '42501'; end if;
  if p_practitioner is not null and not sehat_is_business_doctor(v_adm.business_id, p_practitioner) then
    raise exception 'That doctor does not work at this hospital.';
  end if;
  if v_adm.attending_practitioner_id is not distinct from p_practitioner then return; end if;
  update admissions set attending_practitioner_id = p_practitioner, updated_at = now() where id = p_admission;
  select full_name into v_name from practitioners where id = p_practitioner;
  insert into admission_notes (admission_id, business_id, note_type, body)
  values (p_admission, v_adm.business_id, 'status_change',
          'Attending doctor changed to ' || coalesce(v_name, 'none'));
end $$;
revoke all on function sehat_set_attending(uuid, uuid) from public, anon;
grant execute on function sehat_set_attending(uuid, uuid) to authenticated;

-- ── Per-doctor performance ──────────────────────────────────────────────────
-- Owner and manager: every doctor, plus a "Not assigned" row (practitioner_id
-- null). A doctor: their own row only.
create or replace function sehat_doctor_performance(p_business uuid, p_from date, p_to date)
returns table (
  practitioner_id uuid, doctor_name text, speciality text,
  appointments bigint, completed bigint, no_shows bigint, cancelled bigint,
  opd_visits bigint, prescriptions bigint, admissions bigint, discharges bigint,
  patients bigint, registered_patients bigint,
  billed numeric, collected numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid; v_all boolean;
begin
  v_all := sehat_caller_is_business(p_business) or sehat_is_admin();
  v_me := sehat_caller_practitioner_id();
  if not v_all and not (coalesce(sehat_caller_role(p_business), '') = 'doctor' and v_me is not null) then
    raise exception 'Only the owner, a manager or a doctor can read this.' using errcode = '42501';
  end if;
  return query
  with docs as (
    select p.id, p.full_name, p.speciality
      from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = p_business and bp.role in ('doctor', 'owner')
       and (v_all or p.id = v_me)
    union all
    select null::uuid, 'Not assigned', null where v_all
  )
  select d.id, d.full_name, d.speciality,
    (select count(*) from appointments a where a.business_id = p_business and a.practitioner_id is not distinct from d.id
        and (a.slot_datetime at time zone 'Asia/Kolkata')::date between p_from and p_to),
    (select count(*) from appointments a where a.business_id = p_business and a.practitioner_id is not distinct from d.id
        and (a.slot_datetime at time zone 'Asia/Kolkata')::date between p_from and p_to and a.status = 'completed'),
    (select count(*) from appointments a where a.business_id = p_business and a.practitioner_id is not distinct from d.id
        and (a.slot_datetime at time zone 'Asia/Kolkata')::date between p_from and p_to and a.status = 'no_show'),
    (select count(*) from appointments a where a.business_id = p_business and a.practitioner_id is not distinct from d.id
        and (a.slot_datetime at time zone 'Asia/Kolkata')::date between p_from and p_to and a.status = 'cancelled'),
    (select count(*) from patient_visits v where v.business_id = p_business and v.practitioner_id is not distinct from d.id
        and v.visit_date::date between p_from and p_to),
    (select count(*) from prescriptions r where r.business_id = p_business and r.practitioner_id is not distinct from d.id
        and r.issued_at::date between p_from and p_to and r.status <> 'cancelled'),
    (select count(*) from admissions m where m.business_id = p_business and m.attending_practitioner_id is not distinct from d.id
        and m.admitted_at::date between p_from and p_to),
    (select count(*) from admissions m where m.business_id = p_business and m.attending_practitioner_id is not distinct from d.id
        and m.discharged_at::date between p_from and p_to),
    (select count(distinct x.m) from (
        select v.patient_member_id m from patient_visits v where v.business_id = p_business
           and v.practitioner_id is not distinct from d.id and v.visit_date::date between p_from and p_to
        union
        select m.patient_member_id from admissions m where m.business_id = p_business
           and m.attending_practitioner_id is not distinct from d.id and m.admitted_at::date between p_from and p_to) x),
    (select count(*) from business_patients bp where bp.business_id = p_business
        and bp.primary_practitioner_id is not distinct from d.id and d.id is not null),
    (select coalesce(sum(c.amount), 0) from patient_charges c left join patient_bills b on b.id = c.bill_id
      where c.business_id = p_business and c.practitioner_id is not distinct from d.id
        and c.charged_on between p_from and p_to
        and (c.bill_id is null or (b.status <> 'cancelled' and b.superseded_by is null))),
    (select coalesce(sum(pm.amount), 0) from patient_payments pm
      where pm.business_id = p_business and pm.practitioner_id is not distinct from d.id
        and pm.received_on between p_from and p_to)
  from docs d
  order by d.id is null, d.full_name;
end $$;
revoke all on function sehat_doctor_performance(uuid, date, date) from public, anon;
grant execute on function sehat_doctor_performance(uuid, date, date) to authenticated;

-- ── A doctor's own patients ─────────────────────────────────────────────────
-- Registered under them, seen by them, or admitted under them. A doctor may
-- only ask for themselves; owner and manager may ask for any doctor.
create or replace function sehat_doctor_patients(p_business uuid, p_practitioner uuid default null)
returns table (
  patient_member_id uuid, full_name text, phone text, mrn text,
  registered_under_me boolean, last_visit date, visits bigint,
  admitted_now boolean, admission_id uuid, bed_label text
)
language plpgsql stable security definer set search_path = public as $$
declare v_doc uuid;
begin
  v_doc := coalesce(p_practitioner, sehat_caller_practitioner_id());
  if v_doc is null then raise exception 'Choose a doctor.'; end if;
  if not (sehat_caller_is_business(p_business) or sehat_is_admin()
          or (v_doc = sehat_caller_practitioner_id() and sehat_is_business_doctor(p_business, v_doc))) then
    raise exception 'You can only see your own patients here.' using errcode = '42501';
  end if;
  return query
  with mine as (
    select bp.patient_member_id m from business_patients bp
     where bp.business_id = p_business and bp.primary_practitioner_id = v_doc
    union
    select v.patient_member_id from patient_visits v where v.business_id = p_business and v.practitioner_id = v_doc
    union
    select a.patient_member_id from admissions a where a.business_id = p_business and a.attending_practitioner_id = v_doc
  )
  select pm.id, pm.full_name, pt.phone, bp.mrn,
         coalesce(bp.primary_practitioner_id = v_doc, false),
         (select max(v.visit_date)::date from patient_visits v
           where v.business_id = p_business and v.patient_member_id = pm.id and v.practitioner_id = v_doc),
         (select count(*) from patient_visits v
           where v.business_id = p_business and v.patient_member_id = pm.id and v.practitioner_id = v_doc),
         a.id is not null, a.id,
         (select b.label from beds b where b.id = a.bed_id)
    from mine
    join patient_members pm on pm.id = mine.m
    join patients pt on pt.id = pm.patient_id
    left join business_patients bp on bp.business_id = p_business and bp.patient_member_id = pm.id
    left join admissions a on a.business_id = p_business and a.patient_member_id = pm.id
                          and a.status = 'admitted' and a.attending_practitioner_id = v_doc
   order by (a.id is not null) desc, 6 desc nulls last, pm.full_name;
end $$;
revoke all on function sehat_doctor_patients(uuid, uuid) from public, anon;
grant execute on function sehat_doctor_patients(uuid, uuid) to authenticated;

-- ── The revenue report, by doctor ───────────────────────────────────────────
-- 0091's report with a doctor filter. Unchanged for owner and manager asking
-- for the whole hospital; a doctor is always held to their own figures —
-- before this, a doctor saw the whole hospital's takings.
drop function if exists sehat_revenue_report(uuid, text, date, date);
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
    coalesce(sum(c.amount) filter (where c.category = 'other'),        0),
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
revoke all on function sehat_revenue_report(uuid, text, date, date, uuid) from public, anon;
grant execute on function sehat_revenue_report(uuid, text, date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
