-- ============================================================================
-- Sehatsandhi — a patient's own records in the app, and messages with clinics
--
-- Run AFTER 0196. Safe to re-run.
--
-- Decided 4 Oct 2026 with the clinic: a patient signed in to the app (0196)
-- sees everything Sehatsandhi holds about the people on their number — the
-- DPDP right to a summary of their own data, and what clinics already send
-- them on WhatsApp:
--
--   • the family on the number (patients.phone is the household, 0156);
--   • visits — date, clinic, doctor, diagnosis, advice, follow-up;
--   • prescriptions, lab reports, bills and discharge summaries, each opened
--     through its existing patient link (/rx, /lab, /bill, /ds). Opening one
--     from the app renews a link that had expired: the patient is its owner;
--   • the clinics they have been to, with the clinic's phone.
--
-- MESSAGES: a patient can write to a clinic where someone on their number is
-- registered, and the clinic's staff answer from the dashboard or the app.
-- Each side gets a notification. Only a number on the clinic's register can
-- start a conversation, at most 30 messages a day, so this cannot become a
-- way to spam clinics. Every message records who wrote it.
-- ============================================================================

-- ── 1. The household behind the signed-in number ────────────────────────────
create or replace function sehat_my_members()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.id from patient_members m join patients p on p.id = m.patient_id
   where p.phone = sehat_my_phone() and coalesce(m.status, 'active') = 'active';
$$;
revoke all on function sehat_my_members() from public, anon, authenticated;

create or replace function sehat_my_records()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.full_name, 'relation', m.relation,
        'age', coalesce(date_part('year', age(current_date, m.date_of_birth))::integer, m.age_years), 'gender', m.gender) order by m.is_self desc, m.full_name)
      from patient_members m where m.id in (select sehat_my_members())), '[]'),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'member_id', v.patient_member_id, 'date', v.visit_date,
        'clinic', b.name, 'business_id', v.business_id, 'doctor', pr.full_name, 'complaint', v.chief_complaint,
        'diagnosis', v.diagnosis, 'advice', v.advice, 'follow_up', v.follow_up_due) order by v.visit_date desc nulls last)
      from patient_visits v join businesses b on b.id = v.business_id left join practitioners pr on pr.id = v.practitioner_id
      where v.patient_member_id in (select sehat_my_members()) and v.business_id is not null), '[]'),
    'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'member_id', x.patient_member_id, 'no', x.prescription_no,
        'clinic', x.clinic_name, 'doctor', x.prescriber_name, 'date', x.issued_at, 'diagnosis', x.diagnosis) order by x.issued_at desc)
      from prescriptions x where x.patient_member_id in (select sehat_my_members()) and x.status = 'issued'), '[]'),
    'lab_reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'member_id', o.patient_member_id, 'no', r.report_no,
        'clinic', b.name, 'by', r.approved_by_name, 'date', r.approved_at) order by r.approved_at desc)
      from lab_reports r join lab_orders o on o.id = r.order_id join businesses b on b.id = r.business_id
      where o.patient_member_id in (select sehat_my_members())
        and r.version = (select max(r2.version) from lab_reports r2 where r2.order_id = r.order_id)), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'member_id', x.patient_member_id, 'no', x.bill_no,
        'clinic', x.clinic_name, 'date', x.issued_at, 'amount', x.net_payable, 'type', x.bill_type) order by x.issued_at desc)
      from patient_bills x where x.patient_member_id in (select sehat_my_members()) and x.status = 'issued'), '[]'),
    'discharges', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'member_id', x.patient_member_id, 'no', x.summary_no,
        'clinic', x.clinic_name, 'doctor', x.doctor_name, 'date', x.discharged_at, 'diagnosis', x.discharge_diagnosis) order by x.discharged_at desc)
      from discharge_summaries x where x.patient_member_id in (select sehat_my_members()) and x.status = 'issued'), '[]'),
    'clinics', coalesce((select jsonb_agg(c order by c ->> 'last_seen' desc nulls last) from (
        select jsonb_build_object('business_id', b.id, 'name', b.name, 'phone', b.phone, 'address', b.address,
          'last_seen', max(bp.last_seen_at),
          'unread', (select count(*) from clinic_messages cm where cm.business_id = b.id and cm.patient_phone = v_phone
                       and cm.sender = 'clinic' and cm.read_by_patient_at is null)) c
          from business_patients bp join businesses b on b.id = bp.business_id
         where bp.patient_member_id in (select sehat_my_members()) and bp.status = 'active'
         group by b.id, b.name, b.phone, b.address) t), '[]'),
    'site', sehat_site_url());
end $$;
revoke all on function sehat_my_records() from public, anon;
grant execute on function sehat_my_records() to authenticated;

-- A link to one record, renewed for 30 days if it had expired.
-- p_kind: 'rx' | 'lab' | 'bill' | 'ds'
create or replace function sehat_my_open(p_kind text, p_id uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_token text; v_mine boolean;
begin
  if p_kind = 'rx' then
    select public_token::text, patient_member_id in (select sehat_my_members()) into v_token, v_mine from prescriptions where id = p_id and status = 'issued';
    if v_mine then update prescriptions set token_expires_at = greatest(coalesce(token_expires_at, now()), now() + interval '30 days') where id = p_id; end if;
  elsif p_kind = 'lab' then
    select r.public_token::text, o.patient_member_id in (select sehat_my_members()) into v_token, v_mine
      from lab_reports r join lab_orders o on o.id = r.order_id where r.id = p_id;
    if v_mine then update lab_reports set token_expires_at = greatest(token_expires_at, now() + interval '30 days') where id = p_id; end if;
  elsif p_kind = 'bill' then
    select public_token::text, patient_member_id in (select sehat_my_members()) into v_token, v_mine from patient_bills where id = p_id and status = 'issued';
    if v_mine then update patient_bills set token_expires_at = greatest(coalesce(token_expires_at, now()), now() + interval '30 days') where id = p_id; end if;
  elsif p_kind = 'ds' then
    select public_token::text, patient_member_id in (select sehat_my_members()) into v_token, v_mine from discharge_summaries where id = p_id and status = 'issued';
    if v_mine then update discharge_summaries set token_expires_at = greatest(coalesce(token_expires_at, now()), now() + interval '30 days') where id = p_id; end if;
  else
    raise exception 'Unknown record.' using errcode = '22023';
  end if;
  if not coalesce(v_mine, false) or v_token is null then raise exception 'That record is not on your number.' using errcode = '42501'; end if;
  return sehat_site_url() || '/' || p_kind || '/' || v_token;
end $$;
revoke all on function sehat_my_open(text, uuid) from public, anon;
grant execute on function sehat_my_open(text, uuid) to authenticated;

-- ── 2. Messages between a patient and a clinic ──────────────────────────────
create table if not exists clinic_messages (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  patient_phone text not null,
  sender text not null check (sender in ('patient', 'clinic')),
  staff_uid uuid,
  staff_name text,
  body text not null check (length(btrim(body)) between 1 and 2000),
  photo_url text,
  read_by_clinic_at timestamptz,
  read_by_patient_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clinic_messages_thread_idx on clinic_messages (business_id, patient_phone, created_at);
create index if not exists clinic_messages_unread_idx on clinic_messages (business_id, created_at) where sender = 'patient' and read_by_clinic_at is null;
alter table clinic_messages enable row level security;
revoke all on clinic_messages from anon, authenticated;

-- Is anyone on this number registered at this clinic?
create or replace function sehat_phone_registered_at(p_phone text, p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_patients bp join patient_members m on m.id = bp.patient_member_id
                   join patients p on p.id = m.patient_id
                  where bp.business_id = p_business and bp.status = 'active' and p.phone = p_phone);
$$;
revoke all on function sehat_phone_registered_at(text, uuid) from public, anon, authenticated;

create or replace function sehat_msg_row(c clinic_messages)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', c.id, 'from', c.sender, 'by', c.staff_name, 'body', c.body, 'photo_url', c.photo_url,
                            'at', c.created_at, 'read', case when c.sender = 'patient' then c.read_by_clinic_at is not null else c.read_by_patient_at is not null end);
$$;

-- Patient side
create or replace function sehat_my_thread(p_business uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  if not sehat_phone_registered_at(v_phone, p_business) then raise exception 'You can message clinics you have visited.' using errcode = '42501'; end if;
  update clinic_messages set read_by_patient_at = now()
   where business_id = p_business and patient_phone = v_phone and sender = 'clinic' and read_by_patient_at is null;
  return jsonb_build_object(
    'clinic', (select jsonb_build_object('name', b.name, 'phone', b.phone, 'address', b.address) from businesses b where b.id = p_business),
    'messages', coalesce((select jsonb_agg(sehat_msg_row(c) order by c.created_at)
      from (select * from clinic_messages where business_id = p_business and patient_phone = v_phone order by created_at desc limit 200) c), '[]'));
end $$;
revoke all on function sehat_my_thread(uuid) from public, anon;
grant execute on function sehat_my_thread(uuid) to authenticated;

create or replace function sehat_my_send(p_business uuid, p_body text, p_photo_url text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_my_phone(); c clinic_messages; v_name text;
begin
  if not sehat_phone_registered_at(v_phone, p_business) then raise exception 'You can message clinics you have visited.' using errcode = '42501'; end if;
  if (select count(*) from clinic_messages where patient_phone = v_phone and sender = 'patient' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You have sent many messages today. Please call the clinic if it is urgent.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null and p_photo_url is null then raise exception 'Type a message.' using errcode = '22023'; end if;
  insert into clinic_messages (business_id, patient_phone, sender, body, photo_url)
  values (p_business, v_phone, 'patient', coalesce(nullif(btrim(left(coalesce(p_body, ''), 2000)), ''), '📷 Photo'),
          case when p_photo_url ~* '^https://' then p_photo_url end)
  returning * into c;
  select coalesce(p.name, w.profile_name) into v_name from patients p left join wa_contacts w on w.phone = p.phone where p.phone = v_phone;
  begin
    perform sehat_queue_push('message', p_business,
      sehat_mo_users(p_business, array['owner', 'manager', 'doctor', 'receptionist', 'nurse']),
      'Message from ' || coalesce(split_part(v_name, ' ', 1), 'a patient'), left(c.body, 120),
      jsonb_build_object('kind', 'message', 'phone', v_phone));
  exception when others then null;
  end;
  return sehat_msg_row(c);
end $$;
revoke all on function sehat_my_send(uuid, text, text) from public, anon;
grant execute on function sehat_my_send(uuid, text, text) to authenticated;

-- Clinic side: every staff role that sees patients (not delivery or drivers).
create or replace function sehat_msg_check(p_business uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  if coalesce(sehat_caller_role(p_business), 'owner') in ('delivery', 'driver') then
    raise exception 'Your role does not handle patient messages.' using errcode = '42501';
  end if;
end $$;
revoke all on function sehat_msg_check(uuid) from public, anon, authenticated;

create or replace function sehat_clinic_threads(p_business uuid)
returns table (phone text, names text, last_body text, last_from text, last_at timestamptz, unread bigint, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_msg_check(p_business);
  return query
    select t.patient_phone,
           (select string_agg(distinct m.full_name, ', ') from patient_members m join patients p on p.id = m.patient_id
             join business_patients bp on bp.patient_member_id = m.id and bp.business_id = p_business where p.phone = t.patient_phone),
           (select c.body from clinic_messages c where c.business_id = p_business and c.patient_phone = t.patient_phone order by c.created_at desc limit 1),
           (select c.sender from clinic_messages c where c.business_id = p_business and c.patient_phone = t.patient_phone order by c.created_at desc limit 1),
           max(t.created_at),
           count(*) filter (where t.sender = 'patient' and t.read_by_clinic_at is null),
           exists (select 1 from patient_app_accounts a where a.phone = t.patient_phone)
      from clinic_messages t where t.business_id = p_business
     group by t.patient_phone
     order by 5 desc limit 200;
end $$;
revoke all on function sehat_clinic_threads(uuid) from public, anon;
grant execute on function sehat_clinic_threads(uuid) to authenticated;

create or replace function sehat_clinic_thread(p_business uuid, p_phone text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_normalise_phone(p_phone);
begin
  perform sehat_msg_check(p_business);
  update clinic_messages set read_by_clinic_at = now()
   where business_id = p_business and patient_phone = v_phone and sender = 'patient' and read_by_clinic_at is null;
  return jsonb_build_object(
    'on_app', exists (select 1 from patient_app_accounts a where a.phone = v_phone),
    'registered', sehat_phone_registered_at(v_phone, p_business),
    'messages', coalesce((select jsonb_agg(sehat_msg_row(c) order by c.created_at)
      from (select * from clinic_messages where business_id = p_business and patient_phone = v_phone order by created_at desc limit 200) c), '[]'));
end $$;
revoke all on function sehat_clinic_thread(uuid, text) from public, anon;
grant execute on function sehat_clinic_thread(uuid, text) to authenticated;

create or replace function sehat_clinic_send(p_business uuid, p_phone text, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_normalise_phone(p_phone); c clinic_messages; v_uid uuid; v_name text := sehat_mo_actor_name(p_business);
  v_role text := coalesce(sehat_caller_role(p_business), 'owner');
begin
  perform sehat_msg_check(p_business);
  if v_phone is null or not sehat_phone_registered_at(v_phone, p_business) then
    raise exception 'You can message patients registered at your clinic.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then raise exception 'Type a message.' using errcode = '22023'; end if;
  insert into clinic_messages (business_id, patient_phone, sender, staff_uid, staff_name, body)
  values (p_business, v_phone, 'clinic', auth.uid(),
          v_name || case v_role when 'doctor' then '' when 'owner' then '' else ' (' || initcap(v_role) || ')' end,
          btrim(left(p_body, 2000)))
  returning * into c;
  select auth_uid into v_uid from patient_app_accounts where phone = v_phone;
  if v_uid is not null then
    begin
      perform sehat_queue_push('message', p_business, array[v_uid],
        (select name from businesses where id = p_business), left(c.body, 120),
        jsonb_build_object('kind', 'patient_message', 'business_id', p_business));
    exception when others then null;
    end;
  end if;
  return sehat_msg_row(c);
end $$;
revoke all on function sehat_clinic_send(uuid, text, text) from public, anon;
grant execute on function sehat_clinic_send(uuid, text, text) to authenticated;

-- Unread patient messages for the dashboard badge.
create or replace function sehat_clinic_unread(p_business uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_msg_check(p_business);
  return (select count(*)::integer from clinic_messages where business_id = p_business and sender = 'patient' and read_by_clinic_at is null);
end $$;
revoke all on function sehat_clinic_unread(uuid) from public, anon;
grant execute on function sehat_clinic_unread(uuid) to authenticated;

notify pgrst, 'reload schema';
