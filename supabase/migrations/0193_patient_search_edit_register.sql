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
-- 2. CORRECTIONS. A wrong name, age or gender could not be fixed once saved
--    (address and PIN already could, 0183). sehat_update_patient_details lets
--    any staff member at the clinic correct them, and every change is kept —
--    who, when, from what to what — in patient_detail_changes.
--    The saved mobile number is NOT edited on screen (the clinic's call, 4 Oct
--    2026): it is the patient's WhatsApp identity. Another number is ADDED
--    instead (patient_phones, below) and search finds the patient by it. The
--    function can still re-home a number for a Sehatsandhi admin's repair.
--
-- 3. THE REGISTER. sehat_visit_register lists the people behind every number
--    on the Patient report and My practice — visits, patients seen, new,
--    returning, admissions, follow-ups due or missed, everyone — for any
--    dates, any doctor, with a search. It counts exactly as 0161's report
--    does, so the list under a number has that many rows. Diagnosis and
--    complaint only for clinical staff.
-- ============================================================================

-- Other numbers a patient can be reached on. Exactly ten digits, like the
-- main one; searchable; removable if added by mistake (the removal is logged).
create table if not exists patient_phones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  phone text not null check (phone ~ '^91[6-9][0-9]{9}$'),
  label text,
  added_by_name text,
  created_at timestamptz not null default now(),
  unique (patient_member_id, phone)
);
create index if not exists patient_phones_phone_idx on patient_phones (phone);
alter table patient_phones enable row level security;
revoke all on patient_phones from anon, authenticated;

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
       or (length(q.digits) >= 3 and exists (select 1 from patient_phones x where x.patient_member_id = m.id and x.phone like '%' || q.digits || '%'))
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
    -- Staff add another number instead (sehat_add_patient_phone); re-homing
    -- the main number is a Sehatsandhi admin's repair only.
    if not sehat_is_admin() then
      raise exception 'The saved mobile number cannot be changed. Add another number instead.' using errcode = '42501';
    end if;
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

create or replace function sehat_add_patient_phone(p_business uuid, p_member uuid, p_phone text, p_label text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_patient_phone(p_phone); v_id uuid;
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  if not exists (select 1 from business_patients where business_id = p_business and patient_member_id = p_member) then
    raise exception 'That patient is not registered here.' using errcode = 'P0002';
  end if;
  if v_phone is null then raise exception '%', sehat_patient_phone_problem(p_phone) using errcode = '22023'; end if;
  if v_phone = (select p.phone from patient_members m join patients p on p.id = m.patient_id where m.id = p_member) then
    raise exception 'That is already their main number.' using errcode = 'P0001';
  end if;
  insert into patient_phones (business_id, patient_member_id, phone, label, added_by_name)
  values (p_business, p_member, v_phone, nullif(btrim(left(coalesce(p_label, ''), 40)), ''), sehat_mo_actor_name(p_business))
  on conflict (patient_member_id, phone) do update set label = coalesce(excluded.label, patient_phones.label)
  returning id into v_id;
  insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
  values (p_business, p_member, 'another number added', null, v_phone || coalesce(' (' || nullif(btrim(p_label), '') || ')', ''), auth.uid(), sehat_mo_actor_name(p_business));
  return v_id;
end $$;
revoke all on function sehat_add_patient_phone(uuid, uuid, text, text) from public, anon;
grant execute on function sehat_add_patient_phone(uuid, uuid, text, text) to authenticated;

create or replace function sehat_remove_patient_phone(p_business uuid, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r patient_phones;
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  delete from patient_phones where id = p_id and business_id = p_business returning * into r;
  if r.id is null then raise exception 'Number not found.' using errcode = 'P0002'; end if;
  insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
  values (p_business, r.patient_member_id, 'another number removed', r.phone, null, auth.uid(), sehat_mo_actor_name(p_business));
end $$;
revoke all on function sehat_remove_patient_phone(uuid, uuid) from public, anon;
grant execute on function sehat_remove_patient_phone(uuid, uuid) to authenticated;

create or replace function sehat_patient_phones(p_business uuid, p_member uuid)
returns table (id uuid, phone text, label text, added_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  return query select x.id, x.phone, x.label, x.added_by_name, x.created_at from patient_phones x
    where x.business_id = p_business and x.patient_member_id = p_member order by x.created_at;
end $$;
revoke all on function sehat_patient_phones(uuid, uuid) from public, anon;
grant execute on function sehat_patient_phones(uuid, uuid) to authenticated;

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
      or (length(v_digits) >= 3 and exists (select 1 from patient_phones x where x.patient_member_id = r.member and x.phone like '%' || v_digits || '%'))
      or upper(coalesce(p.mrn, '')) = upper(v_q)
      or p.pin_code = v_q
      or (v_clin and (pv.diagnosis ilike '%' || v_q || '%' or pv.chief_complaint ilike '%' || v_q || '%'))
   order by r.d desc nulls last, p.full_name
   limit 2000;
end $$;
revoke all on function sehat_visit_register(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function sehat_visit_register(uuid, date, date, uuid, text, text) to authenticated;


-- ── 4. Ten digits, or a foreign number with its country code ────────────────
-- Decided 4 Oct 2026: a phone box takes exactly ten digits for an Indian
-- mobile (+91 or a leading 0 allowed) and says so when it gets nine or eleven;
-- and, for the foreign patients big-city clinics see, a number typed with +
-- and its country code (+44 7700 900123) — 8 to 15 digits, stored as digits
-- (447700900123). Foreign numbers are kept and searchable; WhatsApp messages
-- to them depend on the sender (AiSensy) supporting that country.
create or replace function sehat_patient_phone(p_raw text)
returns text language plpgsql immutable as $$
declare t text := btrim(coalesce(p_raw, '')); d text := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');
begin
  if t like '+%' or t like '00%' then
    if t like '00%' then d := substr(d, 3); end if;
    if left(d, 2) = '91' then d := substr(d, 3);            -- +91: an Indian number after all
    else
      return case when d ~ '^[1-9][0-9]{7,14}$' then d end;
    end if;
  elsif length(d) = 12 and left(d, 2) = '91' then d := substr(d, 3);
  elsif length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2);
  end if;
  return case when d ~ '^[6-9][0-9]{9}$' then '91' || d end;
end $$;

create or replace function sehat_patient_phone_problem(p_raw text)
returns text language plpgsql immutable as $$
declare t text := btrim(coalesce(p_raw, '')); d text := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');
begin
  if t = '' then return 'Enter the mobile number.'; end if;
  if (t like '+%' or t like '00%') and left(case when t like '00%' then substr(d, 3) else d end, 2) <> '91' then
    return 'Incorrect number — a foreign number is + and the country code, then 8 to 15 digits in all.';
  end if;
  if length(d) = 12 and left(d, 2) = '91' then d := substr(d, 3);
  elsif length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) <> 10 then return format('Incorrect number — a mobile number has 10 digits, this has %s.', length(d)); end if;
  return 'Incorrect number — an Indian mobile number starts with 6, 7, 8 or 9.';
end $$;

alter table patients drop constraint if exists patients_phone_format;
alter table patients add constraint patients_phone_format
  check (phone ~ '^91[6-9][0-9]{9}$' or (phone ~ '^[1-9][0-9]{7,14}$' and phone !~ '^91')) not valid;
alter table patient_phones drop constraint if exists patient_phones_phone_check;
alter table patient_phones add constraint patient_phones_phone_check
  check (phone ~ '^91[6-9][0-9]{9}$' or (phone ~ '^[1-9][0-9]{7,14}$' and phone !~ '^91'));

create or replace function sehat_register_patient(
  p_business uuid,
  p_phone text,
  p_full_name text,
  p_relation text default 'self',
  p_gender text default null,
  p_age_years integer default null,
  p_date_of_birth date default null,
  p_blood_group text default null,
  p_mrn text default null,
  p_source text default 'walk_in',
  p_pin_code text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_patient uuid;
  v_member uuid;
  v_name text;
  v_pin text := nullif(regexp_replace(coalesce(p_pin_code, ''), '\D', '', 'g'), '');
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'not your business';
  end if;

  v_name := btrim(coalesce(p_full_name, ''));
  if v_name = '' then raise exception 'a patient needs a name'; end if;

  if v_pin is not null and v_pin !~ '^[1-9][0-9]{5}$' then
    raise exception 'a PIN code is 6 digits';
  end if;

  -- 0193: exactly ten digits for an Indian mobile, or a foreign number typed
  -- with + and its country code. Anything else says what is wrong.
  v_phone := sehat_patient_phone(p_phone);
  if v_phone is null then
    raise exception '%', sehat_patient_phone_problem(p_phone);
  end if;

  select id into v_patient from patients where phone = v_phone;
  if v_patient is null then
    insert into patients (phone) values (v_phone) returning id into v_patient;
  end if;

  select id into v_member
    from patient_members
   where patient_id = v_patient
     and lower(btrim(full_name)) = lower(v_name)
     and status <> 'deleted'
   limit 1;

  if v_member is null then
    insert into patient_members (
      patient_id, full_name, relation, gender, age_years, date_of_birth, blood_group,
      is_self
    ) values (
      v_patient, v_name,
      coalesce(nullif(btrim(p_relation), ''), 'self'),
      p_gender, p_age_years, p_date_of_birth, p_blood_group,
      coalesce(nullif(btrim(p_relation), ''), 'self') = 'self'
        and not exists (select 1 from patient_members m where m.patient_id = v_patient and m.is_self)
    ) returning id into v_member;
  else
    update patient_members
       set gender        = coalesce(gender, p_gender),
           age_years     = coalesce(age_years, p_age_years),
           date_of_birth = coalesce(date_of_birth, p_date_of_birth),
           blood_group   = coalesce(blood_group, p_blood_group),
           updated_at    = now()
     where id = v_member;
  end if;

  perform sehat_link_patient_to_business(v_member, p_business, p_source, 'registered at the front desk');

  if coalesce(btrim(p_mrn), '') <> '' then
    begin
      update business_patients set mrn = btrim(p_mrn)
       where business_id = p_business and patient_member_id = v_member;
    exception when unique_violation then
      raise exception 'file number % is already used by another patient here', btrim(p_mrn);
    end;
  end if;

  -- Said at the counter, so it overwrites; see the header.
  if v_pin is not null then
    perform sehat_set_patient_pin(v_patient, v_pin, true);
  end if;

  return v_member;
end $$;

notify pgrst, 'reload schema';
