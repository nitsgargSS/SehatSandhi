-- ============================================================================
-- Sehatsandhi — the front desk's OPD visit in one step, the patient's history
--               with us, a printable OPD slip, and the hospital's banner
--
-- Run AFTER 0134. Safe to re-run.
--
-- Decided 26 Sep 2026:
--
--   • A patient at a multi-doctor clinic is sent to the doctor they came for,
--     and that doctor's OPD fee is charged — full, discounted or free with a
--     reason (0133). sehat_opd_visit does the token and the charge together.
--
--   • A returning patient is recognised, not registered twice: the desk sees
--     every earlier visit and which doctor they saw (sehat_patient_history),
--     and the doctor they last saw is offered first.
--
--   • The OPD slip: letterhead, token, doctor, fee, and the vitals and
--     allergies the nurse took — printed before the patient goes in.
--     sehat_opd_slip returns everything it prints, for the clinic only.
--
--   • The banner: businesses.letterhead_url, an image the owner uploads to the
--     public 'letterheads' bucket (a banner is meant to be seen). Printed at
--     the top of the OPD slip, bills, prescriptions and discharge summaries.
--     Without one, those print the name, address and phone as before.
-- ============================================================================

alter table businesses add column if not exists letterhead_url text;

insert into storage.buckets (id, name, public)
values ('letterheads', 'letterheads', true)
on conflict (id) do nothing;

-- Files live under <business id>/…; only its owner or manager may write there.
drop policy if exists letterheads_owner_write on storage.objects;
create policy letterheads_owner_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'letterheads'
              and sehat_caller_role(((storage.foldername(name))[1])::uuid) in ('owner', 'manager'));
drop policy if exists letterheads_owner_update on storage.objects;
create policy letterheads_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'letterheads'
         and sehat_caller_role(((storage.foldername(name))[1])::uuid) in ('owner', 'manager'));
drop policy if exists letterheads_owner_delete on storage.objects;
create policy letterheads_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'letterheads'
         and sehat_caller_role(((storage.foldername(name))[1])::uuid) in ('owner', 'manager'));

create or replace function sehat_set_letterhead(p_business uuid, p_url text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(sehat_caller_role(p_business), '') not in ('owner', 'manager') then
    raise exception 'Only the owner or a manager can change the letterhead.' using errcode = 'insufficient_privilege';
  end if;
  if p_url is not null and p_url !~ '^https://[^ ]+/storage/v1/object/public/letterheads/' then
    raise exception 'The banner must be uploaded here.' using errcode = 'check_violation';
  end if;
  update businesses set letterhead_url = p_url where id = p_business;
end $$;
revoke all on function sehat_set_letterhead(uuid, text) from public, anon;
grant execute on function sehat_set_letterhead(uuid, text) to authenticated;


-- ── One OPD visit: token + consultation charge ─────────────────────────────
create or replace function sehat_opd_visit(
  p_business uuid,
  p_member uuid,
  p_practitioner uuid,
  p_fee numeric default null,            -- null = the doctor's fee; 0 = free
  p_discount_reason text default null,
  p_reason text default null,            -- what they came for
  p_priority integer default 0,
  p_priority_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_doc    record;
  v_list   numeric;
  v_fee    numeric;
  v_token  opd_queue;
  v_charge uuid;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'not your business' using errcode = 'insufficient_privilege';
  end if;

  if p_practitioner is not null then
    select p.full_name, bp.consultation_fee, bp.discounted_fee into v_doc
      from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = p_business and bp.practitioner_id = p_practitioner
       and bp.status <> 'suspended';
    if v_doc.full_name is null then
      raise exception 'That doctor does not work here.' using errcode = 'no_data_found';
    end if;
    v_list := nullif(coalesce(v_doc.discounted_fee, v_doc.consultation_fee, 0), 0);
  end if;

  v_token := sehat_issue_token(p_member, p_business, p_practitioner, nullif(btrim(coalesce(p_reason, '')), ''),
                               null, coalesce(p_priority, 0), p_priority_reason, sehat_caller_practitioner_id());

  v_fee := coalesce(p_fee, v_list, 0);
  if v_fee < 0 then raise exception 'The fee cannot be negative.' using errcode = 'check_violation'; end if;
  if v_fee > 0 or v_list is not null then
    insert into patient_charges (business_id, patient_member_id, category, description, quantity,
                                 unit_price, amount, practitioner_id, list_price, discount_reason)
    values (p_business, p_member, 'consultation',
            'OPD consultation' || coalesce(' — ' || v_doc.full_name, ''), 1,
            v_fee, v_fee, p_practitioner, v_list, p_discount_reason)
    returning id into v_charge;
  end if;

  update business_patients set last_seen_at = now(), visit_count = coalesce(visit_count, 0) + 1,
         primary_practitioner_id = coalesce(primary_practitioner_id, p_practitioner)
   where business_id = p_business and patient_member_id = p_member;

  return jsonb_build_object('queue_id', v_token.id, 'token_number', v_token.token_number,
                            'charge_id', v_charge, 'fee', v_fee, 'list_price', v_list);
end $$;
revoke all on function sehat_opd_visit(uuid, uuid, uuid, numeric, text, text, integer, text) from public, anon;
grant execute on function sehat_opd_visit(uuid, uuid, uuid, numeric, text, text, integer, text) to authenticated;


-- ── Everything this patient has had here, newest first ─────────────────────
create or replace function sehat_patient_history(p_business uuid, p_member uuid)
returns table (seen_on date, kind text, doctor_id uuid, doctor_name text, detail text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'not your business' using errcode = 'insufficient_privilege';
  end if;
  return query
  select * from (
    select q.queue_date, 'OPD'::text, q.practitioner_id, p.full_name,
           'Token ' || q.token_number || coalesce(' · ' || q.reason, '') || ' · ' || q.status
      from opd_queue q left join practitioners p on p.id = q.practitioner_id
     where q.business_id = p_business and q.patient_member_id = p_member
    union all
    select v.visit_date, 'Visit', v.practitioner_id, p.full_name,
           coalesce(nullif(v.diagnosis, ''), nullif(v.chief_complaint, ''), 'Consultation')
      from patient_visits v left join practitioners p on p.id = v.practitioner_id
     where v.business_id = p_business and v.patient_member_id = p_member
       and not exists (select 1 from opd_queue q where q.visit_id = v.id)
    union all
    select a.admitted_at::date, 'Admission', a.attending_practitioner_id, p.full_name,
           coalesce(a.admitting_diagnosis, a.reason, 'Admitted')
      from admissions a left join practitioners p on p.id = a.attending_practitioner_id
     where a.business_id = p_business and a.patient_member_id = p_member
  ) h(seen_on, kind, doctor_id, doctor_name, detail)
  order by 1 desc
  limit 30;
end $$;
revoke all on function sehat_patient_history(uuid, uuid) from public, anon;
grant execute on function sehat_patient_history(uuid, uuid) to authenticated;


-- ── What the OPD slip prints ────────────────────────────────────────────────
create or replace function sehat_opd_slip(p_queue uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q opd_queue;
  v jsonb;
begin
  select * into q from opd_queue where id = p_queue;
  if q.id is null or not sehat_caller_owns_business(q.business_id) then
    raise exception 'No such token.' using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
    'clinic', (select jsonb_build_object('name', b.name, 'address', b.address, 'phone', b.phone,
                 'email', b.email, 'reg_number', b.reg_number, 'gstin', b.gstin, 'letterhead_url', b.letterhead_url)
                 from businesses b where b.id = q.business_id),
    'token', jsonb_build_object('number', q.token_number, 'date', q.queue_date, 'issued_at', q.created_at,
                 'reason', q.reason, 'priority', q.priority, 'priority_reason', q.priority_reason, 'status', q.status),
    'doctor', (select jsonb_build_object('name', p.full_name, 'speciality', p.speciality,
                 'qualification', p.qualification, 'reg_number', p.reg_number)
                 from practitioners p where p.id = q.practitioner_id),
    'patient', (select jsonb_build_object('name', m.full_name, 'age', m.age_years, 'gender', m.gender,
                 'blood_group', m.blood_group, 'phone', pt.phone, 'mrn', bp.mrn,
                 'visit_count', bp.visit_count)
                 from patient_members m
                 left join patients pt on pt.id = m.patient_id
                 left join business_patients bp on bp.business_id = q.business_id and bp.patient_member_id = m.id
                where m.id = q.patient_member_id),
    'vitals', (select to_jsonb(x) from (
                 select recorded_at, bp_systolic, bp_diastolic, pulse, temperature_c, weight_kg, height_cm,
                        spo2, blood_sugar_mg_dl, blood_sugar_type, notes
                   from patient_vitals
                  where patient_member_id = q.patient_member_id and business_id = q.business_id
                    and recorded_at::date = q.queue_date
                  order by recorded_at desc limit 1) x),
    'allergies', coalesce((select jsonb_agg(jsonb_build_object('substance', a.substance, 'reaction', a.reaction,
                   'severity', a.severity) order by a.severity nulls last)
                   from patient_allergies a
                  where a.patient_member_id = q.patient_member_id and a.is_active), '[]'::jsonb),
    'conditions', coalesce((select jsonb_agg(c.condition)
                   from patient_conditions c
                  where c.patient_member_id = q.patient_member_id and c.business_id = q.business_id
                    and coalesce(c.status, 'active') = 'active'), '[]'::jsonb),
    'charge', (select jsonb_build_object('amount', c.amount, 'list_price', c.list_price,
                 'discount_kind', c.discount_kind, 'discount_reason', c.discount_reason)
                 from patient_charges c
                where c.business_id = q.business_id and c.patient_member_id = q.patient_member_id
                  and c.category = 'consultation' and c.charged_on = q.queue_date
                  and c.practitioner_id is not distinct from q.practitioner_id
                order by c.created_at desc limit 1)
  ) into v;
  return v;
end $$;
revoke all on function sehat_opd_slip(uuid) from public, anon;
grant execute on function sehat_opd_slip(uuid) to authenticated;

notify pgrst, 'reload schema';
