-- ============================================================================
-- Sehatsandhi — consult from the queue; the token's doctor owns the visit;
--               a token marked Left by mistake can be brought back; who did what
--
-- Run AFTER 0181. Safe to re-run.
--
-- Found 30 Sep 2026 at an eye clinic:
--   • The queue had no way into the consultation. A visit was only ever made
--     from Patients → Visits, with the doctor set to WHOEVER pressed the button
--     — a nurse or manager's own row — so the eye doctor's patient got the
--     general examination form, and Done recorded nothing.
--   • "Left" had no undo, and afterwards the patient was a line of plain text.
--   • Vitals never recorded who took them; visits never recorded who made them.
--
--   sehat_token_visit(token)  — the visit for this token, made on first use:
--                               the TOKEN's doctor, today, OPD; linked to the
--                               token. Clinical staff (0180: incl. manager).
--   sehat_reopen_token(token) — left / skipped / completed today → waiting.
--   triggers                  — patient_vitals.recorded_by and
--                               patient_visits.created_by default to the
--                               signed-in staff member.
-- ============================================================================

create or replace function sehat_token_visit(p_queue uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare q opd_queue%rowtype; v_visit uuid;
begin
  select * into q from opd_queue where id = p_queue for update;
  if q.id is null or not sehat_caller_owns_business(q.business_id) then
    raise exception 'No such token.' using errcode = 'P0002';
  end if;
  if not sehat_caller_is_clinical(q.business_id) then
    raise exception 'Only a doctor, nurse or manager can open the consultation.' using errcode = '42501';
  end if;

  if q.visit_id is not null and exists (select 1 from patient_visits where id = q.visit_id) then
    v_visit := q.visit_id;
  else
    insert into patient_visits (patient_member_id, business_id, practitioner_id, appointment_id,
                                visit_type, visit_date, chief_complaint, created_by)
    values (q.patient_member_id, q.business_id, q.practitioner_id, q.appointment_id,
            'opd', (now() at time zone 'Asia/Kolkata')::date, nullif(btrim(coalesce(q.reason, '')), ''),
            sehat_caller_practitioner_id())
    returning id into v_visit;
    update opd_queue set visit_id = v_visit, updated_at = now() where id = q.id;
  end if;

  return jsonb_build_object('visit_id', v_visit, 'patient_member_id', q.patient_member_id,
                            'practitioner_id', q.practitioner_id);
end $$;
revoke all on function sehat_token_visit(uuid) from public, anon;
grant execute on function sehat_token_visit(uuid) to authenticated;

create or replace function sehat_reopen_token(p_queue uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare q opd_queue%rowtype;
begin
  select * into q from opd_queue where id = p_queue for update;
  if q.id is null or not sehat_caller_owns_business(q.business_id) then
    raise exception 'No such token.' using errcode = 'P0002';
  end if;
  if q.status not in ('left', 'skipped', 'completed') then return; end if;
  if q.queue_date <> (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Only today''s tokens can be brought back. Give the patient a new token.' using errcode = 'P0001';
  end if;
  if exists (select 1 from opd_queue o where o.business_id = q.business_id and o.queue_date = q.queue_date
               and o.patient_member_id = q.patient_member_id and o.id <> q.id
               and o.status in ('waiting', 'called', 'in_consultation')) then
    raise exception 'This patient already has another token in the queue today.' using errcode = 'P0001';
  end if;
  update opd_queue set status = 'waiting', completed_at = null, updated_at = now() where id = q.id;
end $$;
revoke all on function sehat_reopen_token(uuid) from public, anon;
grant execute on function sehat_reopen_token(uuid) to authenticated;

-- ── Who did it ──────────────────────────────────────────────────────────────
create or replace function sehat_stamp_recorded_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'patient_vitals' then
    new.recorded_by := coalesce(new.recorded_by, sehat_caller_practitioner_id());
  elsif tg_table_name = 'patient_visits' then
    new.created_by := coalesce(new.created_by, sehat_caller_practitioner_id());
  end if;
  return new;
end $$;
drop trigger if exists stamp_recorded_by on patient_vitals;
create trigger stamp_recorded_by before insert on patient_vitals
  for each row execute function sehat_stamp_recorded_by();
drop trigger if exists stamp_created_by on patient_visits;
create trigger stamp_created_by before insert on patient_visits
  for each row execute function sehat_stamp_recorded_by();

notify pgrst, 'reload schema';
