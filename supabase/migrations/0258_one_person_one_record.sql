-- ============================================================================
-- 0258 — One person, one record: merging duplicates, and the counter picks
-- ============================================================================
-- AFTER 0257. Safe to re-run.
--
-- Reported 23 Oct 2026 (SN Eye Hospital): MRS. ANJANA came on 30 Sep with one
-- mobile and on 22 Oct with another, and got a second record with its own
-- file number. The clinic confirmed she is one person.
--
-- 1. MERGING. sehat_merge_patient_members(keep, drop) moves everything from
--    the duplicate onto the record kept — every row that points at a patient
--    member, found from the foreign keys so a table added later is not
--    missed — joins the two clinic links (file number, first and last seen,
--    visit count), keeps the duplicate's mobile as an extra number on the kept
--    record, and marks the duplicate 'merged' with merged_into set (the
--    columns 0047 left for this). Each clinic's change log says what was
--    merged. Sehatsandhi admin only: there is no grant to clinic users yet.
--
--    An issued prescription, and a charge already on an issued bill, refuse
--    every change (0048, 0056). A merge is the one exception, and only for
--    the patient link: the document is the same person's, unaltered.
--
-- 2. THE COUNTER PICKS. sehat_register_patient takes p_member: the person
--    reception picked from the list on the phone number (0257's form). The
--    visit then goes on that record whatever the spelling or whichever of
--    their numbers was typed — which, after a merge, may be the extra one.
--    The name match now skips merged records too.
-- ============================================================================

-- ── 1a. The merge exception in the two write-once triggers ─────────────────

create or replace function sehat_merging() returns boolean
language sql stable as $$
  select coalesce(current_setting('sehat.merging', true), '') = 'on'
$$;

create or replace function sehat_prescription_is_immutable()
returns trigger language plpgsql as $$
begin
  if new.prescription_no       is distinct from old.prescription_no
  or new.business_id           is distinct from old.business_id
  or new.practitioner_id       is distinct from old.practitioner_id
  -- 0258: a merge re-homes it to the same person's kept record.
  or (new.patient_member_id    is distinct from old.patient_member_id and not sehat_merging())
  or new.prescriber_name       is distinct from old.prescriber_name
  or new.prescriber_reg_number is distinct from old.prescriber_reg_number
  or new.patient_name          is distinct from old.patient_name
  or new.patient_age           is distinct from old.patient_age
  or new.diagnosis             is distinct from old.diagnosis
  or new.advice                is distinct from old.advice
  or new.issued_at             is distinct from old.issued_at
  then
    raise exception
      'a prescription cannot be edited once issued — issue a correction that supersedes it'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function sehat_billed_charge_is_frozen()
returns trigger language plpgsql as $$
declare v_no text;
begin
  if old.bill_id is not null then
    select bill_no into v_no from patient_bills
     where id = old.bill_id and status = 'issued';

    -- Releasing the line is how a cancellation or a correction unwinds, and is
    -- the one change an issued bill permits. 0258: a merge may re-home the
    -- line to the same person's kept record, changing nothing else.
    if found and not (tg_op = 'UPDATE' and new.bill_id is null)
       and not (tg_op = 'UPDATE' and sehat_merging()
                and (to_jsonb(new) - 'patient_member_id' - 'updated_at')
                  = (to_jsonb(old) - 'patient_member_id' - 'updated_at')) then
      raise exception
        'this charge is on bill % — cancel that bill before changing it', v_no
        using errcode = 'check_violation';
    end if;
  end if;

  -- A BEFORE DELETE trigger must return OLD; returning NULL would silently
  -- swallow the delete.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ── 1b. The merge ───────────────────────────────────────────────────────────

create or replace function sehat_merge_patient_members(
  p_keep uuid,
  p_drop uuid,
  p_by text default 'Sehatsandhi admin'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k patient_members;
  d patient_members;
  kb business_patients;
  db business_patients;
  r record;
  n integer;
  m integer;
  v_moved jsonb := '{}'::jsonb;
  v_keep_phone text;
  v_drop_phone text;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception 'name two different records: the one to keep and the duplicate';
  end if;
  select * into k from patient_members where id = p_keep for update;
  select * into d from patient_members where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'patient record not found'; end if;
  if k.status <> 'active' or d.status <> 'active' then
    raise exception 'both records must be active (keep: %, duplicate: %)', k.status, d.status;
  end if;
  select phone into v_keep_phone from patients where id = k.patient_id;
  select phone into v_drop_phone from patients where id = d.patient_id;

  perform set_config('sehat.merging', 'on', true);

  -- The clinic links: joined where both are known to a clinic, moved where
  -- only the duplicate is. The kept file number wins; the other is logged.
  for db in select * from business_patients where patient_member_id = p_drop loop
    select * into kb from business_patients
     where business_id = db.business_id and patient_member_id = p_keep;
    if kb.id is null then
      update business_patients set patient_member_id = p_keep, updated_at = now() where id = db.id;
    else
      update business_patients set mrn = null where id = db.id;   -- frees the unique index
      update business_patients set
        mrn = coalesce(nullif(btrim(kb.mrn), ''), nullif(btrim(db.mrn), '')),
        first_seen_at = least(kb.first_seen_at, db.first_seen_at),
        last_seen_at = greatest(kb.last_seen_at, db.last_seen_at),
        visit_count = coalesce(kb.visit_count, 0) + coalesce(db.visit_count, 0),
        notes = nullif(concat_ws(E'\n', nullif(btrim(kb.notes), ''), nullif(btrim(db.notes), '')), ''),
        primary_practitioner_id = coalesce(kb.primary_practitioner_id, db.primary_practitioner_id),
        updated_at = now()
       where id = kb.id;
      delete from business_patients where id = db.id;
    end if;
    insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by_name)
    values (db.business_id, p_keep, 'merged',
            format('%s · %s · file %s', d.full_name, coalesce(v_drop_phone, '-'), coalesce(nullif(btrim(db.mrn), ''), '-')),
            format('%s · %s · file %s', k.full_name, coalesce(v_keep_phone, '-'),
                   coalesce((select nullif(btrim(mrn), '') from business_patients
                              where business_id = db.business_id and patient_member_id = p_keep), '-')),
            p_by);
  end loop;

  -- Extra numbers come across, and the duplicate's own mobile becomes one.
  insert into patient_phones (business_id, patient_member_id, phone, label, added_by_name, created_at)
  select business_id, p_keep, phone, label, added_by_name, created_at
    from patient_phones where patient_member_id = p_drop
  on conflict (patient_member_id, phone) do nothing;
  delete from patient_phones where patient_member_id = p_drop;
  if v_drop_phone is distinct from v_keep_phone and v_drop_phone ~ '^91[6-9][0-9]{9}$' then
    insert into patient_phones (business_id, patient_member_id, phone, label, added_by_name)
    select bp.business_id, p_keep, v_drop_phone, 'from a merged record', p_by
      from business_patients bp where bp.patient_member_id = p_keep
     order by bp.first_seen_at limit 1
    on conflict (patient_member_id, phone) do nothing;
  end if;
  delete from patient_phones where patient_member_id = p_keep and phone = v_keep_phone;

  -- Everything else that points at the duplicate. Where the row also names
  -- the family account (patient_id), that follows the person.
  for r in
    select cl.relname as tbl, a.attname as col,
           exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = cl.relname
                      and c.column_name = 'patient_id') as has_patient_id
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'patient_members'::regclass
       and cl.relname not in ('business_patients', 'patient_phones', 'patient_members')
  loop
    if r.has_patient_id and r.col = 'patient_member_id' then
      execute format('update %I set %I = $1, patient_id = $3 where %I = $2 and patient_id is not distinct from $4',
                     r.tbl, r.col, r.col) using p_keep, p_drop, k.patient_id, d.patient_id;
      get diagnostics n = row_count;
      execute format('update %I set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_drop;
      get diagnostics m = row_count;
      n := n + m;
    else
      execute format('update %I set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_drop;
      get diagnostics n = row_count;
    end if;
    if n > 0 then v_moved := v_moved || jsonb_build_object(r.tbl, n); end if;
  end loop;

  -- What the duplicate knew and the kept record did not.
  update patient_members set
    gender        = coalesce(gender, d.gender),
    age_years     = coalesce(age_years, d.age_years),
    date_of_birth = coalesce(date_of_birth, d.date_of_birth),
    blood_group   = coalesce(blood_group, d.blood_group),
    updated_at    = now()
   where id = p_keep;

  update patient_members
     set status = 'merged', merged_into = p_keep, is_self = false, updated_at = now()
   where id = p_drop;

  perform set_config('sehat.merging', '', true);

  return jsonb_build_object('kept', p_keep, 'merged', p_drop,
                            'extra_phone', v_drop_phone, 'moved', v_moved);
end $$;

revoke all on function sehat_merge_patient_members(uuid, uuid, text) from public, anon, authenticated;

-- ── 2. Registering the person reception picked ─────────────────────────────

drop function if exists sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text, text);

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
  p_pin_code text default null,
  p_member uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_patient uuid;
  v_member uuid;
  v_name text;
  v_mrn text;
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

  if p_member is not null then
    -- 0258: the person reception picked. Theirs at this clinic, and current.
    select m.id, m.patient_id into v_member, v_patient
      from patient_members m
      join business_patients bp on bp.patient_member_id = m.id and bp.business_id = p_business
     where m.id = p_member and m.status = 'active';
    if v_member is null then
      raise exception 'that patient is not on this clinic''s list — search again';
    end if;
  else
    select id into v_patient from patients where phone = v_phone;
    if v_patient is null then
      insert into patients (phone) values (v_phone) returning id into v_patient;
    end if;

    select id into v_member
      from patient_members
     where patient_id = v_patient
       and lower(btrim(full_name)) = lower(v_name)
       and status = 'active'
     limit 1;
  end if;

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

  -- 0257: a file number, once given, is kept. It is set only where the
  -- patient has none here; a different one typed for a returning patient is
  -- refused rather than written over theirs.
  if coalesce(btrim(p_mrn), '') <> '' then
    select nullif(btrim(mrn), '') into v_mrn
      from business_patients
     where business_id = p_business and patient_member_id = v_member;
    if v_mrn is null then
      begin
        update business_patients set mrn = btrim(p_mrn), updated_at = now()
         where business_id = p_business and patient_member_id = v_member;
      exception when unique_violation then
        raise exception 'file number % is already used by another patient here', btrim(p_mrn);
      end;
    elsif upper(v_mrn) <> upper(btrim(p_mrn)) then
      raise exception '% already has file number % here — it is kept, not replaced', v_name, v_mrn;
    end if;
  end if;

  -- Said at the counter, so it overwrites; see 0193's header.
  if v_pin is not null then
    perform sehat_set_patient_pin(v_patient, v_pin, true);
  end if;

  return v_member;
end $$;

revoke all on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text, text, uuid) from public, anon;
grant execute on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
