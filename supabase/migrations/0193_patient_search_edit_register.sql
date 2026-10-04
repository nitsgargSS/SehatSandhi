-- ============================================================================
-- Sehatsandhi — patient search that finds, details anyone can correct, and a
--               register of who came when
--
-- Run AFTER 0192. Safe to re-run.
--
-- Reported 4 Oct 2026 by the user's clinic:
--
-- 1. SEARCH. sehat_search_patients (0047) matched the phone with
--    like '%' || <digits in the query> || '%'. A name has no digits, so that
--    became like '%%' — every patient matched, whatever was typed. Now the
--    phone is only compared when the query has at least three digits.
--
-- 2. CORRECTIONS. A wrong name, age, gender or phone could not be fixed once
--    saved (address and PIN already could, 0183). sehat_update_patient_details
--    lets any staff member at the clinic correct them, and every change is
--    kept — who, when, from what to what — in patient_detail_changes.
--    A phone number belongs to a household (patients.phone is unique):
--      • a number nobody has yet corrects it for the household;
--      • a number another household already has moves this one person into
--        that household — the usual case of a child registered on the wrong
--        parent's number.
--
-- 3. THE REGISTER. sehat_visit_register lists the people behind every number
--    on the Patient report and My practice — visits, patients seen, new,
--    returning, admissions, follow-ups due or missed, everyone — for any
--    dates, any doctor, with a search. It counts exactly as 0161's report
--    does, so the list under a number has that many rows. Diagnosis and
--    complaint only for clinical staff.
-- ============================================================================

-- ── 1. Search ───────────────────────────────────────────────────────────────
create or replace function sehat_search_patients(p_query text, p_business uuid default null)
returns table (
  patient_member_id uuid, business_id uuid, full_name text, relation text,
  phone text, age_years integer, gender text, mrn text,
  last_seen_at timestamptz, visit_count integer
)
language sql stable security definer set search_path = public as $$
  with q as (select btrim(coalesce(p_query, '')) as raw,
                    regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g') as digits)
  select m.id, bp.business_id, m.full_name, m.relation,
         p.phone, m.age_years, m.gender, bp.mrn,
         bp.last_seen_at, bp.visit_count
    from business_patients bp
    join patient_members m on m.id = bp.patient_member_id
    join patients p on p.id = m.patient_id
   cross join q
   where bp.business_id in (select sehat_caller_business_ids())
     and (p_business is null or bp.business_id = p_business)
     and m.status = 'active'
     and length(q.raw) >= 2
     and (
       m.full_name ilike '%' || q.raw || '%'
       -- 0193: only a query with digits in it is a phone search.
       or (length(q.digits) >= 3 and p.phone like '%' || q.digits || '%')
       or upper(coalesce(bp.mrn, '')) = upper(q.raw)
     )
   order by (m.full_name ilike q.raw || '%') desc, bp.last_seen_at desc nulls last, m.full_name
   limit 50;
$$;

-- ── 2. Corrections ──────────────────────────────────────────────────────────
create table if not exists patient_detail_changes (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists patient_detail_changes_member_idx on patient_detail_changes (patient_member_id, changed_at desc);
alter table patient_detail_changes enable row level security;
revoke all on patient_detail_changes from anon, authenticated;

create or replace function sehat_update_patient_details(
  p_business uuid, p_member uuid,
  p_full_name text default null, p_gender text default null, p_age_years integer default null,
  p_date_of_birth date default null, p_phone text default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  m patient_members;
  v_patient patients;
  v_name text := nullif(btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g')), '');
  v_gender text := nullif(lower(btrim(coalesce(p_gender, ''))), '');
  v_phone text;
  v_other uuid;
  v_by text := sehat_mo_actor_name(p_business);
  v_moved boolean := false;
  n integer := 0;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_patients where business_id = p_business and patient_member_id = p_member) then
    raise exception 'That patient is not registered here.' using errcode = 'P0002';
  end if;
  select * into m from patient_members where id = p_member for update;
  select * into v_patient from patients where id = m.patient_id for update;

  if v_name is not null and v_name is distinct from m.full_name then
    if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Enter the full name (2 to 80 letters).' using errcode = '22023'; end if;
    insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
    values (p_business, p_member, 'name', m.full_name, v_name, auth.uid(), v_by);
    update patient_members set full_name = v_name, updated_at = now() where id = p_member;
    if m.is_self then update patients set name = v_name, updated_at = now() where id = m.patient_id; end if;
    n := n + 1;
  end if;

  if v_gender is not null and v_gender is distinct from m.gender then
    if v_gender not in ('male', 'female', 'other') then raise exception 'Choose male, female or other.' using errcode = '22023'; end if;
    insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
    values (p_business, p_member, 'gender', m.gender, v_gender, auth.uid(), v_by);
    update patient_members set gender = v_gender, updated_at = now() where id = p_member;
    n := n + 1;
  end if;

  if p_date_of_birth is not null and p_date_of_birth is distinct from m.date_of_birth then
    if p_date_of_birth > (now() at time zone 'Asia/Kolkata')::date or p_date_of_birth < date '1890-01-01' then
      raise exception 'That date of birth is not possible.' using errcode = '22023';
    end if;
    insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
    values (p_business, p_member, 'date_of_birth', m.date_of_birth::text, p_date_of_birth::text, auth.uid(), v_by);
    update patient_members set date_of_birth = p_date_of_birth,
           age_years = date_part('year', age((now() at time zone 'Asia/Kolkata')::date, p_date_of_birth))::integer, updated_at = now()
     where id = p_member;
    n := n + 1;
  elsif p_age_years is not null and p_age_years is distinct from m.age_years then
    if p_age_years < 0 or p_age_years > 130 then raise exception 'Enter an age between 0 and 130.' using errcode = '22023'; end if;
    insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
    values (p_business, p_member, 'age', m.age_years::text, p_age_years::text, auth.uid(), v_by);
    -- An age typed in replaces a date of birth that no longer agrees with it.
    update patient_members set age_years = p_age_years, date_of_birth = null, updated_at = now() where id = p_member;
    n := n + 1;
  end if;

  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    v_phone := sehat_normalise_phone(p_phone);
    if v_phone is null then raise exception 'Enter a 10-digit Indian mobile number.' using errcode = '22023'; end if;
    if v_phone is distinct from v_patient.phone then
      select id into v_other from patients where phone = v_phone;
      if v_other is null then
        -- A number nobody has: the household's number was wrong.
        update patients set phone = v_phone, phone_raw = p_phone, updated_at = now() where id = v_patient.id;
      else
        -- Someone already has it: this person belongs to that household.
        update patient_members
           set patient_id = v_other,
               is_self = not exists (select 1 from patient_members x where x.patient_id = v_other and x.is_self),
               relation = case when exists (select 1 from patient_members x where x.patient_id = v_other and x.is_self) then 'other' else 'self' end,
               updated_at = now()
         where id = p_member;
        v_moved := true;
      end if;
      insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
      values (p_business, p_member, case when v_moved then 'phone (moved to that number''s family)' else 'phone' end,
              v_patient.phone, v_phone, auth.uid(), v_by);
      n := n + 1;
    end if;
  end if;

  return jsonb_build_object('changed', n, 'moved_household', v_moved,
    'household_size', (select count(*) from patient_members where patient_id = v_patient.id and status = 'active'));
end $$;
revoke all on function sehat_update_patient_details(uuid, uuid, text, text, integer, date, text) from public, anon;
grant execute on function sehat_update_patient_details(uuid, uuid, text, text, integer, date, text) to authenticated;

-- How many people share this person's number — the screen warns before a
-- phone correction that will apply to all of them.
create or replace function sehat_patient_household(p_business uuid, p_member uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  return (select jsonb_build_object('phone', p.phone,
            'others', coalesce((select jsonb_agg(x.full_name order by x.full_name) from patient_members x
                                 where x.patient_id = p.id and x.id <> p_member and x.status = 'active'), '[]'))
            from patient_members m join patients p on p.id = m.patient_id where m.id = p_member);
end $$;
revoke all on function sehat_patient_household(uuid, uuid) from public, anon;
grant execute on function sehat_patient_household(uuid, uuid) to authenticated;

create or replace function sehat_patient_detail_changes(p_business uuid, p_member uuid)
returns table (field text, old_value text, new_value text, changed_by_name text, changed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  return query select c.field, c.old_value, c.new_value, c.changed_by_name, c.changed_at
    from patient_detail_changes c where c.business_id = p_business and c.patient_member_id = p_member
   order by c.changed_at desc limit 50;
end $$;
revoke all on function sehat_patient_detail_changes(uuid, uuid) from public, anon;
grant execute on function sehat_patient_detail_changes(uuid, uuid) to authenticated;

-- ── 3. The register ─────────────────────────────────────────────────────────
-- p_kind: visits | patients | new | returning | admissions | follow_ups | missed | all
create or replace function sehat_visit_register(
  p_business uuid, p_from date default null, p_to date default null,
  p_doctor uuid default null, p_query text default null, p_kind text default 'visits'
) returns table (
  on_date date, kind text, patient_member_id uuid, full_name text, phone text, mrn text,
  age_years integer, gender text, pin_code text, city text,
  practitioner_id uuid, doctor text, visit_id uuid, chief_complaint text, diagnosis text, follow_up_due date,
  first_seen date, visits_total integer
) language plpgsql stable security definer set search_path = public as $$
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
       and (v_kind = 'patients' or (select p.first_seen from pat p where p.member = s.member) < v_from)
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
      or upper(coalesce(p.mrn, '')) = upper(v_q)
      or p.pin_code = v_q
      or (v_clin and (pv.diagnosis ilike '%' || v_q || '%' or pv.chief_complaint ilike '%' || v_q || '%'))
   order by r.d desc nulls last, p.full_name
   limit 2000;
end $$;
revoke all on function sehat_visit_register(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function sehat_visit_register(uuid, date, date, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
