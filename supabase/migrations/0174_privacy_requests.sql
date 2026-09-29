-- ============================================================================
-- Sehatsandhi — privacy requests: a queue for DPDP rights, with a nightly
-- erasure batch
--
-- Run AFTER 0173. Safe to re-run.
--
-- The Privacy Policy (DPDP Act 2023 / Rules 2025) promises that a request to
-- see, correct or erase personal data, withdraw consent, nominate someone, or
-- raise a grievance is acknowledged within 24 hours and resolved within 15
-- days. Until now that was an inbox and a memory. This is the queue:
--
--   privacy_requests         one row per request, with its due times
--   privacy_request_events   who did what, when (append-only)
--
-- Requests arrive from the Contact page (topic 'privacy' — a trigger files
-- them here) or are logged by an admin/manager from email, WhatsApp, a call
-- or in person. Admins and managers work them in the "Privacy" tab:
-- acknowledge → verify identity → look up what we hold → forward to clinics
-- that hold records → schedule erasure → resolve or reject with a reason.
--
-- ── WHAT ERASURE TOUCHES, AND WHAT IT NEVER DOES ────────────────────────────
-- Sehatsandhi erases only data it holds as Data Fiduciary for that phone or
-- email: contact messages, message and notification logs, WhatsApp contact and
-- session records, verification and login codes, insurance and doctor leads,
-- the words of any rating (the score stays, unlinked), and marketing consent.
-- The phone stays on the STOP list as a one-way hash only — so an erased
-- person is never messaged again.
--
-- A clinic's records are the clinic's (we are its Data Processor), and
-- patient_members cascades into visits, prescriptions, bills, lab results and
-- documents. So the patient row is deleted ONLY when no clinic holds anything
-- for any member of that phone; otherwise it is left alone and the request is
-- forwarded to each clinic, which decides under medical-record law.
--
-- Erasure runs nightly at 04:00 IST (process-privacy-erasures), not on the
-- click: a scheduled erasure can still be cancelled that day. Each request
-- runs in its own savepoint; a failure is recorded on the request and nothing
-- of it is half-done.
--
-- The requests themselves are kept 3 years after they are closed — the
-- evidence that a right was honoured — then deleted (purge-privacy-requests).
-- ============================================================================

create sequence if not exists privacy_request_seq;

create table if not exists privacy_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('PR-' || lpad(nextval('privacy_request_seq')::text, 5, '0')),
  created_at timestamptz not null default now(),
  kind text not null default 'other'
    check (kind in ('access', 'correct', 'erase', 'withdraw', 'nominate', 'grievance', 'other')),
  name text not null check (length(btrim(name)) between 2 and 100),
  phone text check (phone is null or phone ~ '^91[6-9][0-9]{9}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  on_behalf text not null default 'self' check (on_behalf in ('self', 'guardian', 'nominee')),
  details text,
  channel text not null default 'email'
    check (channel in ('contact_form', 'email', 'whatsapp', 'phone', 'in_person')),
  contact_inquiry_id uuid references contact_inquiries(id) on delete set null,
  status text not null default 'received'
    check (status in ('received', 'acknowledged', 'verified', 'erase_scheduled', 'erased', 'done', 'rejected')),
  ack_due_at timestamptz not null default now() + interval '24 hours',
  resolve_due_at timestamptz not null default now() + interval '15 days',
  acknowledged_at timestamptz,
  verified_at timestamptz,
  verification_method text,
  forwarded jsonb not null default '[]'::jsonb,       -- [{business_id, name, at, by}]
  erase_scheduled_at timestamptz,
  erased_at timestamptz,
  erase_result jsonb,
  resolved_at timestamptz,
  resolution text,
  constraint privacy_requests_reachable check (phone is not null or email is not null)
);
create index if not exists privacy_requests_open_idx on privacy_requests (status, created_at desc);

create table if not exists privacy_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references privacy_requests(id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  actor text not null,
  action text not null,
  note text
);
create index if not exists privacy_request_events_req_idx on privacy_request_events (request_id, at);

alter table privacy_requests enable row level security;
alter table privacy_request_events enable row level security;
drop policy if exists "staff_reads_privacy_requests" on privacy_requests;
create policy "staff_reads_privacy_requests" on privacy_requests for select using (sehat_is_admin() or sehat_is_manager());
drop policy if exists "staff_reads_privacy_request_events" on privacy_request_events;
create policy "staff_reads_privacy_request_events" on privacy_request_events for select using (sehat_is_admin() or sehat_is_manager());
revoke all on privacy_requests, privacy_request_events from anon, authenticated;
grant select on privacy_requests, privacy_request_events to authenticated;

-- Who is acting: the admin/manager's name, or 'system'.
create or replace function sehat_privacy_actor()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(btrim(full_name), ''), email) from admin_users
                    where auth_uid = auth.uid() and is_active limit 1), 'system');
$$;
revoke all on function sehat_privacy_actor() from public, anon;

create or replace function sehat_privacy_guard()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_is_manager()) then
    raise exception 'Admins and managers only.' using errcode = '42501';
  end if;
end $$;
revoke all on function sehat_privacy_guard() from public, anon;

create or replace function sehat_privacy_norm_phone(p text)
returns text language sql immutable as $$
  select case
    when regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^[6-9][0-9]{9}$' then '91' || regexp_replace(p, '\D', '', 'g')
    when regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^91[6-9][0-9]{9}$' then regexp_replace(p, '\D', '', 'g')
  end;
$$;

-- ── Logging a request ───────────────────────────────────────────────────────
create or replace function sehat_privacy_create(
  p_kind text, p_name text, p_phone text, p_email text, p_on_behalf text, p_details text, p_channel text
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_phone text := sehat_privacy_norm_phone(p_phone);
begin
  perform sehat_privacy_guard();
  if nullif(btrim(coalesce(p_phone, '')), '') is not null and v_phone is null then
    raise exception 'That is not a valid Indian mobile number.' using errcode = '22023';
  end if;
  insert into privacy_requests (kind, name, phone, email, on_behalf, details, channel)
  values (coalesce(p_kind, 'other'), btrim(p_name), v_phone, nullif(lower(btrim(coalesce(p_email, ''))), ''),
          coalesce(p_on_behalf, 'self'), nullif(btrim(coalesce(p_details, '')), ''), coalesce(p_channel, 'email'))
  returning id into v_id;
  insert into privacy_request_events (request_id, actor, action, note) values (v_id, sehat_privacy_actor(), 'logged', p_channel);
  return v_id;
end $$;
revoke all on function sehat_privacy_create(text, text, text, text, text, text, text) from public, anon;
grant execute on function sehat_privacy_create(text, text, text, text, text, text, text) to authenticated;

-- From the Contact page: topic 'privacy' files a request automatically.
create or replace function sehat_privacy_from_contact()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.topic = 'privacy' then
    insert into privacy_requests (name, phone, email, details, channel, contact_inquiry_id, created_at, ack_due_at, resolve_due_at)
    values (new.name, new.phone, lower(new.email), new.message, 'contact_form', new.id,
            new.created_at, new.created_at + interval '24 hours', new.created_at + interval '15 days')
    returning id into v_id;
    insert into privacy_request_events (request_id, actor, action, note) values (v_id, 'system', 'logged', 'Contact page');
  end if;
  return new;
end $$;
drop trigger if exists z_privacy_from_contact on contact_inquiries;
create trigger z_privacy_from_contact after insert on contact_inquiries
  for each row execute function sehat_privacy_from_contact();

alter table contact_inquiries drop constraint if exists contact_inquiries_topic_check;
alter table contact_inquiries add constraint contact_inquiries_topic_check
  check (topic in ('booking', 'listing', 'partner', 'billing', 'listing_change', 'privacy', 'other'));

-- ── What we hold for this person ────────────────────────────────────────────
-- Counts and names only, never the records: enough to answer "what do you
-- have about me" and to know which clinics to forward to. Logged as an event.
create or replace function sehat_privacy_lookup(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r privacy_requests;
  v_hash text;
  v_members uuid[];
  v_out jsonb;
begin
  perform sehat_privacy_guard();
  select * into r from privacy_requests where id = p_id;
  if r.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  v_hash := case when r.phone is not null then sehat_phone_hash(r.phone) end;
  select array_agg(pm.id) into v_members from patient_members pm join patients p on p.id = pm.patient_id where p.phone = r.phone;

  v_out := jsonb_build_object(
    'patient', (select jsonb_build_object('name', p.name, 'since', p.created_at::date, 'area', coalesce(p.city, p.area, p.pin_code))
                  from patients p where p.phone = r.phone),
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', pm.full_name, 'relation', pm.relation) order by pm.is_self desc, pm.created_at)
                  from patient_members pm where pm.id = any(v_members)), '[]'::jsonb),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object('business_id', b.id, 'name', b.name, 'phone', b.phone,
               'forwarded', r.forwarded @> jsonb_build_array(jsonb_build_object('business_id', b.id)),
               'visits', (select count(*) from patient_visits v where v.business_id = b.id and v.patient_member_id = any(v_members)),
               'prescriptions', (select count(*) from prescriptions x where x.business_id = b.id and x.patient_member_id = any(v_members)),
               'bills', (select count(*) from patient_bills x where x.business_id = b.id and x.patient_member_id = any(v_members)),
               'appointments', (select count(*) from appointments a where a.business_id = b.id and (a.patient_member_id = any(v_members) or a.patient_phone = r.phone)))
             order by b.name)
        from businesses b
       where b.id in (select bp.business_id from business_patients bp where bp.patient_member_id = any(v_members)
                      union select a.business_id from appointments a where a.patient_phone = r.phone or a.patient_member_id = any(v_members))
    ), '[]'::jsonb),
    'platform', jsonb_build_object(
      'contact_messages', (select count(*) from contact_inquiries c where c.phone = r.phone or lower(c.email) = r.email),
      'messages_sent',    (select count(*) from message_log m where m.phone = r.phone),
      'notifications',    (select count(*) from notification_outbox n where n.phone = r.phone),
      'whatsapp_contact', (select count(*) from wa_contacts w where w.phone = r.phone),
      'whatsapp_sessions',(select count(*) from wa_sessions w where w.phone = r.phone),
      'ratings',          (select count(*) from ratings x where x.patient_phone_hash = v_hash),
      'insurance_leads',  (select count(*) from insurance_leads x where x.patient_phone = r.phone),
      'doctor_leads',     (select count(*) from doctor_leads x where x.phone = r.phone or lower(x.email) = r.email),
      'marketing_consents', (select count(*) from patient_consents c where c.phone = r.phone and c.purpose = 'marketing'
                               and c.action = 'granted' and sehat_has_consent(c.patient_member_id, 'marketing', c.business_id)),
      'opted_out',        exists (select 1 from opt_outs o where o.phone_hash = v_hash),
      'business_owner',   exists (select 1 from businesses b where b.phone = r.phone or lower(b.email) = r.email)
    )
  );
  insert into privacy_request_events (request_id, actor, action) values (p_id, sehat_privacy_actor(), 'looked up data');
  return v_out;
end $$;
revoke all on function sehat_privacy_lookup(uuid) from public, anon;
grant execute on function sehat_privacy_lookup(uuid) to authenticated;

-- ── Working a request ───────────────────────────────────────────────────────
-- p_action: acknowledge | verify (p_extra = method) | set_kind (p_extra = kind)
--           | forward (p_extra = business id) | schedule_erase | cancel_erase
--           | resolve (note required) | reject (note required) | note
create or replace function sehat_privacy_action(p_id uuid, p_action text, p_note text default null, p_extra text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r privacy_requests; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_biz record;
begin
  perform sehat_privacy_guard();
  select * into r from privacy_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if r.status in ('done', 'rejected') and p_action not in ('note') then
    raise exception 'This request is closed.' using errcode = '22023';
  end if;

  if p_action = 'acknowledge' then
    update privacy_requests set acknowledged_at = coalesce(acknowledged_at, now()),
           status = case when status = 'received' then 'acknowledged' else status end where id = p_id;
  elsif p_action = 'verify' then
    if nullif(btrim(coalesce(p_extra, '')), '') is null then raise exception 'Say how identity was checked.' using errcode = '22023'; end if;
    update privacy_requests set verified_at = now(), verification_method = p_extra,
           acknowledged_at = coalesce(acknowledged_at, now()),
           status = case when status in ('received', 'acknowledged') then 'verified' else status end where id = p_id;
  elsif p_action = 'set_kind' then
    update privacy_requests set kind = p_extra where id = p_id;
  elsif p_action = 'forward' then
    select id, name into v_biz from businesses where id = p_extra::uuid;
    if v_biz.id is null then raise exception 'Clinic not found.' using errcode = 'P0002'; end if;
    update privacy_requests set forwarded = forwarded || jsonb_build_array(jsonb_build_object(
             'business_id', v_biz.id, 'name', v_biz.name, 'at', now(), 'by', sehat_privacy_actor()))
     where id = p_id and not forwarded @> jsonb_build_array(jsonb_build_object('business_id', v_biz.id));
    v_note := coalesce(v_note, v_biz.name);
  elsif p_action = 'schedule_erase' then
    if r.verified_at is null then raise exception 'Verify the person''s identity before erasing anything.' using errcode = '22023'; end if;
    if r.phone is null and r.email is null then raise exception 'No phone or email to erase by.' using errcode = '22023'; end if;
    update privacy_requests set status = 'erase_scheduled', erase_scheduled_at = now(), kind = 'erase' where id = p_id;
  elsif p_action = 'cancel_erase' then
    if r.status <> 'erase_scheduled' then raise exception 'No erasure is scheduled.' using errcode = '22023'; end if;
    update privacy_requests set status = 'verified', erase_scheduled_at = null where id = p_id;
  elsif p_action in ('resolve', 'reject') then
    if v_note is null then raise exception 'Write what was done (or why it was refused) — it is the reply on record.' using errcode = '22023'; end if;
    if r.status = 'erase_scheduled' then raise exception 'Wait for tonight''s erasure, or cancel it first.' using errcode = '22023'; end if;
    update privacy_requests set status = case when p_action = 'resolve' then 'done' else 'rejected' end,
           resolved_at = now(), resolution = v_note, acknowledged_at = coalesce(acknowledged_at, now()) where id = p_id;
  elsif p_action = 'note' then
    if v_note is null then return; end if;
  else
    raise exception 'Unknown action %.', p_action using errcode = '22023';
  end if;

  insert into privacy_request_events (request_id, actor, action, note)
  values (p_id, sehat_privacy_actor(), replace(p_action, '_', ' '), coalesce(v_note, p_extra));
end $$;
revoke all on function sehat_privacy_action(uuid, text, text, text) from public, anon;
grant execute on function sehat_privacy_action(uuid, text, text, text) to authenticated;

-- ── The nightly erasure ─────────────────────────────────────────────────────
create or replace function sehat_privacy_erase_one(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r privacy_requests;
  v_hash text;
  v_patient uuid;
  v_members uuid[];
  v_clinic boolean := false;
  v_res jsonb := '{}'::jsonb;
  n integer;
begin
  select * into r from privacy_requests where id = p_id;
  v_hash := case when r.phone is not null then sehat_phone_hash(r.phone) end;

  if r.phone is not null then
    -- Never contact them again: the STOP list keeps a one-way hash only.
    insert into opt_outs (phone_hash, channel, reason) values (v_hash, 'privacy_request', 'erasure ' || r.ref)
    on conflict (phone_hash) do nothing;
    update opt_outs set phone = null, patient_id = null where phone_hash = v_hash;

    delete from message_log where phone = r.phone;                       get diagnostics n = row_count; v_res := v_res || jsonb_build_object('messages_sent', n);
    delete from notification_outbox where phone = r.phone and status in ('sent', 'failed'); get diagnostics n = row_count; v_res := v_res || jsonb_build_object('notifications', n);
    delete from wa_contacts where phone = r.phone;                       get diagnostics n = row_count; v_res := v_res || jsonb_build_object('whatsapp_contact', n);
    delete from wa_sessions where phone = r.phone;                       get diagnostics n = row_count; v_res := v_res || jsonb_build_object('whatsapp_sessions', n);
    delete from phone_verifications where phone = r.phone;
    delete from login_codes where phone = r.phone;
    delete from insurance_leads where patient_phone = r.phone;           get diagnostics n = row_count; v_res := v_res || jsonb_build_object('insurance_leads', n);
    update ratings set review_text = null, patient_phone_hash = null where patient_phone_hash = v_hash;
                                                                          get diagnostics n = row_count; v_res := v_res || jsonb_build_object('ratings_unlinked', n);
    update unmet_demand_log set patient_phone_hash = null where patient_phone_hash = v_hash;
  end if;

  delete from contact_inquiries where (r.phone is not null and phone = r.phone) or (r.email is not null and lower(email) = r.email);
                                                                          get diagnostics n = row_count; v_res := v_res || jsonb_build_object('contact_messages', n);
  delete from doctor_leads where (r.phone is not null and phone = r.phone) or (r.email is not null and lower(email) = r.email);
                                                                          get diagnostics n = row_count; v_res := v_res || jsonb_build_object('doctor_leads', n);

  if r.phone is not null then
    select id into v_patient from patients where phone = r.phone;
    if v_patient is not null then
      select array_agg(id) into v_members from patient_members where patient_id = v_patient;
      -- Anything a clinic holds (or any record of a clinic looking) keeps the
      -- patient row: that is the clinic's decision, not ours.
      v_clinic := exists (select 1 from business_patients where patient_member_id = any(v_members))
        or exists (select 1 from appointments where patient_member_id = any(v_members) or patient_phone = r.phone)
        or exists (select 1 from patient_visits where patient_member_id = any(v_members))
        or exists (select 1 from prescriptions where patient_member_id = any(v_members))
        or exists (select 1 from patient_bills where patient_member_id = any(v_members))
        or exists (select 1 from pharmacy_bills where patient_member_id = any(v_members))
        or exists (select 1 from lab_orders where patient_member_id = any(v_members))
        or exists (select 1 from patient_documents where patient_member_id = any(v_members))
        or exists (select 1 from admissions where patient_member_id = any(v_members))
        or exists (select 1 from patient_record_access where patient_member_id = any(v_members))
        or exists (select 1 from patient_members where merged_into = any(v_members));
      if v_clinic then
        -- Marketing consent is ours to withdraw even where the record stays.
        insert into patient_consents (patient_id, patient_member_id, business_id, phone, channel, action, basis, purpose, recorded_by, created_at)
        select distinct on (c.patient_member_id, c.business_id)
               c.patient_id, c.patient_member_id, c.business_id, r.phone, 'whatsapp', 'withdrawn', 'privacy_request', 'marketing', 'system:' || r.ref, clock_timestamp()
          from patient_consents c
         where c.phone = r.phone and c.purpose = 'marketing' and c.business_id is not null
           and sehat_has_consent(c.patient_member_id, 'marketing', c.business_id)
         order by c.patient_member_id, c.business_id, c.created_at desc;
        v_res := v_res || jsonb_build_object('patient_record', 'kept — held by clinics; forward the request to them');
      else
        delete from wa_broadcast_recipients where patient_member_id = any(v_members);
        update message_log set patient_id = null where patient_id = v_patient;
        update patient_import_rows set patient_id = null where patient_id = v_patient;
        delete from patients where id = v_patient;
        v_res := v_res || jsonb_build_object('patient_record', 'deleted');
      end if;
    end if;
  end if;
  return v_res;
end $$;
revoke all on function sehat_privacy_erase_one(uuid) from public, anon, authenticated;

create or replace function sehat_privacy_run_erasures()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare r record; v_res jsonb; v_done integer := 0;
begin
  for r in select id from privacy_requests where status = 'erase_scheduled' order by erase_scheduled_at loop
    begin
      v_res := sehat_privacy_erase_one(r.id);
      update privacy_requests set status = 'erased', erased_at = now(), erase_result = v_res where id = r.id;
      insert into privacy_request_events (request_id, actor, action, note) values (r.id, 'system', 'erased', v_res::text);
      v_done := v_done + 1;
    exception when others then
      -- Nothing of this request was changed (the block rolled back).
      update privacy_requests set status = 'verified', erase_result = jsonb_build_object('error', sqlerrm) where id = r.id;
      insert into privacy_request_events (request_id, actor, action, note) values (r.id, 'system', 'erasure failed', sqlerrm);
    end;
  end loop;
  return v_done;
end $$;
revoke all on function sehat_privacy_run_erasures() from public, anon, authenticated;

do $$
declare j record;
begin
  for j in
    select * from (values
      ('process-privacy-erasures', '30 22 * * *', $c$ select public.sehat_privacy_run_erasures() $c$),
      ('purge-privacy-requests',   '35 22 * * *', $c$ delete from public.privacy_requests where status in ('done', 'rejected') and resolved_at < now() - interval '3 years' $c$)
    ) v(name, sched, cmd)
  loop
    begin perform cron.unschedule(j.name);
    exception when others then null; end;
    perform cron.schedule(j.name, j.sched, j.cmd);
  end loop;
end $$;

notify pgrst, 'reload schema';
