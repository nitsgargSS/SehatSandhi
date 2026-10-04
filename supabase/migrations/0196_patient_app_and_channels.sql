-- ============================================================================
-- Sehatsandhi — patients in the app; where every request came from
--
-- Run AFTER 0195. Safe to re-run.
--
-- Decided 4 Oct 2026 with the clinic:
--
-- 1. PATIENTS SIGN IN TO THE APP with a code sent to their WhatsApp
--    (patient-otp). A patient login is its own kind of account — a row in
--    patient_app_accounts tying the login to the phone it proved — and never
--    reaches any business: sehat_caller_business_ids matches business and
--    practitioner logins only, and the synthetic address
--    (91XXXXXXXXXX@patient.sehatsandhi.in) matches no listing.
--
-- 2. FROM THE APP, a patient can order medicines (with a photo of the
--    prescription), ask for an ambulance (with where they are — latitude and
--    longitude go to the accepting crew as a map pin), and ask about health
--    insurance — the same requests the WhatsApp bot makes (0189, 0191, 0192),
--    marked source 'app'. "My requests" lists everything on their number:
--    bookings, orders, trips, insurance requests, with their links.
--
-- 3. REVIEWS ASKED AUTOMATICALLY: when a visit is completed, medicines are
--    delivered, a trip is completed or an insurance advisor has spoken to them,
--    the patient's app gets a notification asking for a rating, and "My
--    requests" shows what is waiting to be rated. The rating lands where the
--    WhatsApp one does (ratings, and each request's own rating).
--
-- 4. PATIENTS' PHOTOS (a prescription) go to a private bucket, patient-uploads,
--    each under the patient's own folder; the patient shares a time-limited
--    link with the pharmacy that takes the order.
--
-- 5. CHANNELS: sehat_admin_channel_report — how many bookings, orders,
--    ambulance requests, insurance leads and new contacts came from the app,
--    WhatsApp, the website or the front desk, for any number of days.
-- ============================================================================

-- ── 1. Patient accounts ─────────────────────────────────────────────────────
create table if not exists patient_app_accounts (
  auth_uid uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique check (phone ~ '^91[6-9][0-9]{9}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table patient_app_accounts enable row level security;
revoke all on patient_app_accounts from anon, authenticated;

-- Called by patient-otp (service role) once the code is right.
create or replace function sehat_link_patient_account(p_uid uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text := sehat_normalise_phone(p_phone);
begin
  if v_phone is null then raise exception 'Not a valid mobile number.'; end if;
  delete from patient_app_accounts where phone = v_phone and auth_uid <> p_uid;
  insert into patient_app_accounts (auth_uid, phone) values (p_uid, v_phone)
  on conflict (auth_uid) do update set phone = excluded.phone, last_seen_at = now();
  begin
    perform sehat_wa_handle_inbound(v_phone, null, null, 'app sign-in', null, null);
  exception when others then null;
  end;
end $$;
revoke all on function sehat_link_patient_account(uuid, text) from public, anon, authenticated;

-- The signed-in patient's number, or an error.
create or replace function sehat_my_phone()
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select phone into v from patient_app_accounts where auth_uid = auth.uid();
  if v is null then raise exception 'Please sign in with your mobile number.' using errcode = '42501'; end if;
  return v;
end $$;
revoke all on function sehat_my_phone() from public, anon, authenticated;

create or replace function sehat_me()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  update patient_app_accounts set last_seen_at = now() where auth_uid = auth.uid();
  return jsonb_build_object('phone', v_phone,
    'name', coalesce((select p.name from patients p where p.phone = v_phone), (select w.profile_name from wa_contacts w where w.phone = v_phone)),
    'pin_code', (select p.pin_code from patients p where p.phone = v_phone));
end $$;
revoke all on function sehat_me() from public, anon;
grant execute on function sehat_me() to authenticated;

-- ── 2. My requests, and what is waiting for a rating ─────────────────────────
create or replace function sehat_my_activity()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  return jsonb_build_object(
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'when', a.slot_datetime, 'status', a.status, 'name', a.patient_name,
        'place', b.name, 'doctor', pr.full_name,
        'rated', exists (select 1 from ratings r where r.appointment_id = a.id),
        'rateable', a.status in ('completed', 'booked', 'confirmed') and a.slot_datetime < now() and a.slot_datetime > now() - interval '30 days'
                    and not exists (select 1 from ratings r where r.appointment_id = a.id)) order by a.slot_datetime desc)
      from appointments a left join businesses b on b.id = a.business_id left join practitioners pr on pr.id = a.practitioner_id
      where a.patient_phone = v_phone and a.slot_datetime > now() - interval '180 days'), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'code', o.code, 'token', o.token, 'status', o.status, 'created_at', o.created_at,
        'pharmacy', b.name, 'total', o.quote_amount + o.delivery_fee, 'rated', o.rating is not null,
        'rateable', o.status = 'delivered' and o.rating is null) order by o.created_at desc)
      from medicine_orders o left join businesses b on b.id = o.business_id
      where o.patient_phone = v_phone and o.created_at > now() - interval '180 days'), '[]'),
    'trips', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'token', r.token, 'status', r.status, 'kind', r.kind, 'created_at', r.created_at,
        'service', b.name, 'rated', r.rating is not null, 'rateable', r.status = 'completed' and r.rating is null) order by r.created_at desc)
      from ambulance_requests r left join businesses b on b.id = r.business_id
      where r.patient_phone = v_phone and r.created_at > now() - interval '180 days'), '[]'),
    'insurance', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'code', l.code, 'token', l.token, 'status', l.status, 'created_at', l.created_at,
        'advisor', b.name, 'rated', l.rating is not null,
        'rateable', l.status in ('accepted', 'contacted', 'won', 'lost') and l.accepted_at < now() - interval '1 hour' and l.rating is null) order by l.created_at desc)
      from insurance_leads l left join businesses b on b.id = l.agent_business_id
      where l.patient_phone = v_phone and l.code is not null and l.created_at > now() - interval '180 days'), '[]'),
    'site', sehat_site_url());
end $$;
revoke all on function sehat_my_activity() from public, anon;
grant execute on function sehat_my_activity() to authenticated;

-- Rate one thing: 'booking' | 'order' | 'trip' | 'insurance'.
create or replace function sehat_my_rate(p_kind text, p_id uuid, p_rating integer, p_review text default null,
  p_paid numeric default null, p_bought boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text := sehat_my_phone(); v_token text;
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Choose 1 to 5 stars.' using errcode = '22023'; end if;
  if p_kind = 'booking' then
    if not exists (select 1 from appointments a where a.id = p_id and a.patient_phone = v_phone) then
      raise exception 'Not your booking.' using errcode = '42501';
    end if;
    if exists (select 1 from ratings r where r.appointment_id = p_id) then raise exception 'Already rated — thank you.' using errcode = 'P0001'; end if;
    insert into ratings (appointment_id, business_id, patient_phone_hash, overall_rating, review_text)
    select a.id, a.business_id, sehat_phone_hash(v_phone), p_rating, nullif(btrim(left(coalesce(p_review, ''), 500)), '')
      from appointments a where a.id = p_id
    on conflict (appointment_id) do nothing;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'order' then
    select token into v_token from medicine_orders where id = p_id and patient_phone = v_phone;
    if v_token is null then raise exception 'Not your order.' using errcode = '42501'; end if;
    return sehat_mo_patient(v_token, 'feedback', p_rating, p_review, p_paid);
  elsif p_kind = 'trip' then
    select token into v_token from ambulance_requests where id = p_id and patient_phone = v_phone;
    if v_token is null then raise exception 'Not your request.' using errcode = '42501'; end if;
    return sehat_am_patient(v_token, 'feedback', p_rating, p_review, p_paid);
  elsif p_kind = 'insurance' then
    select token into v_token from insurance_leads where id = p_id and patient_phone = v_phone;
    if v_token is null then raise exception 'Not your request.' using errcode = '42501'; end if;
    return sehat_il_patient(v_token, 'feedback', p_bought, p_rating, p_review);
  end if;
  raise exception 'Unknown kind.' using errcode = '22023';
end $$;
revoke all on function sehat_my_rate(text, uuid, integer, text, numeric, boolean) from public, anon;
grant execute on function sehat_my_rate(text, uuid, integer, text, numeric, boolean) to authenticated;

-- ── 3. Requests from the app ────────────────────────────────────────────────
alter table ambulance_requests add column if not exists pickup_lat double precision;
alter table ambulance_requests add column if not exists pickup_lng double precision;

create or replace function sehat_app_medicine_order(p_pin text, p_name text, p_address text, p_medicines text, p_rx_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return sehat_create_medicine_order(sehat_my_phone(), p_pin, p_name, p_address, p_medicines, p_rx_url, 'app');
end $$;
revoke all on function sehat_app_medicine_order(text, text, text, text, text) from public, anon;
grant execute on function sehat_app_medicine_order(text, text, text, text, text) to authenticated;

create or replace function sehat_app_ambulance_request(p_pin text, p_name text, p_kind text, p_address text, p_need text,
  p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := sehat_create_ambulance_request(sehat_my_phone(), p_pin, p_name, p_kind, p_address, p_need, 'app');
  if r ? 'code' and p_lat between -90 and 90 and p_lng between -180 and 180 then
    update ambulance_requests set pickup_lat = p_lat, pickup_lng = p_lng where code = r ->> 'code';
  end if;
  return r;
end $$;
revoke all on function sehat_app_ambulance_request(text, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function sehat_app_ambulance_request(text, text, text, text, text, double precision, double precision) to authenticated;

create or replace function sehat_app_insurance_lead(p_pin text, p_name text, p_cover text, p_members text, p_call_time text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return sehat_create_insurance_lead(sehat_my_phone(), p_pin, p_name, p_cover, p_members, p_call_time, 'app');
end $$;
revoke all on function sehat_app_insurance_lead(text, text, text, text, text) from public, anon;
grant execute on function sehat_app_insurance_lead(text, text, text, text, text) to authenticated;

-- The crew sees the pin: 0191's row with the coordinates added.
create or replace function sehat_am_location(p_business uuid, p_req uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r ambulance_requests;
begin
  perform sehat_am_role(p_business);
  select * into r from ambulance_requests where id = p_req;
  if r.business_id is distinct from p_business then return null; end if;
  if r.pickup_lat is null then return null; end if;
  return jsonb_build_object('lat', r.pickup_lat, 'lng', r.pickup_lng);
end $$;
revoke all on function sehat_am_location(uuid, uuid) from public, anon;
grant execute on function sehat_am_location(uuid, uuid) to authenticated;

-- ── 4. Asking for the review, automatically ──────────────────────────────────
create or replace function sehat_ask_review(p_phone text, p_business uuid, p_what text, p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  select auth_uid into v_uid from patient_app_accounts where phone = sehat_normalise_phone(p_phone);
  if v_uid is null then return; end if;
  perform sehat_queue_push('review', p_business, array[v_uid],
    'कैसा रहा? / How was it?', p_what || ' — एक टैप में रेटिंग दें / rate it in one tap.',
    jsonb_build_object('kind', 'review', 'what', p_kind, 'id', p_id));
exception when others then null;   -- a notification must never block the step that caused it
end $$;
revoke all on function sehat_ask_review(text, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function sehat_review_on_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform sehat_ask_review(new.patient_phone, new.business_id,
      'आपकी विज़िट — ' || coalesce((select name from businesses where id = new.business_id), 'clinic'), 'booking', new.id);
  end if;
  return null;
end $$;
drop trigger if exists review_on_appointment on appointments;
create trigger review_on_appointment after update of status on appointments
  for each row execute function sehat_review_on_appointment();

create or replace function sehat_review_on_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    perform sehat_ask_review(new.patient_phone, new.business_id, 'दवाई ऑर्डर ' || new.code || ' / Medicine order ' || new.code, 'order', new.id);
  end if;
  return null;
end $$;
drop trigger if exists review_on_order on medicine_orders;
create trigger review_on_order after update of status on medicine_orders
  for each row execute function sehat_review_on_order();

create or replace function sehat_review_on_trip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform sehat_ask_review(new.patient_phone, new.business_id, 'एम्बुलेंस ' || new.code || ' / Ambulance ' || new.code, 'trip', new.id);
  end if;
  return null;
end $$;
drop trigger if exists review_on_trip on ambulance_requests;
create trigger review_on_trip after update of status on ambulance_requests
  for each row execute function sehat_review_on_trip();

create or replace function sehat_review_on_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is not null and new.status in ('won', 'lost') and old.status not in ('won', 'lost') then
    perform sehat_ask_review(new.patient_phone, new.agent_business_id, 'बीमा सलाहकार / Insurance advisor', 'insurance', new.id);
  end if;
  return null;
end $$;
drop trigger if exists review_on_lead on insurance_leads;
create trigger review_on_lead after update of status on insurance_leads
  for each row execute function sehat_review_on_lead();

do $$ declare f text; begin
  foreach f in array array['sehat_review_on_appointment()', 'sehat_review_on_order()', 'sehat_review_on_trip()', 'sehat_review_on_lead()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- ── 5. Patients' photos ─────────────────────────────────────────────────────
-- Storage policies run as the caller, who cannot read patient_app_accounts.
create or replace function sehat_is_patient_account()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from patient_app_accounts a where a.auth_uid = auth.uid());
$$;
revoke all on function sehat_is_patient_account() from public, anon;
grant execute on function sehat_is_patient_account() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-uploads', 'patient-uploads', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "patient writes own uploads" on storage.objects;
create policy "patient writes own uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-uploads' and (storage.foldername(name))[1] = auth.uid()::text
              and public.sehat_is_patient_account());
drop policy if exists "patient reads own uploads" on storage.objects;
create policy "patient reads own uploads" on storage.objects for select to authenticated
  using (bucket_id = 'patient-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 6. Where requests come from ─────────────────────────────────────────────
-- Channels, in words: the app, WhatsApp (the bot), the website, the front desk
-- (or a clinic's own entry), and anything else recorded.
create or replace function sehat_channel_of(p_source text)
returns text language sql immutable as $$
  select case
    when p_source is null then 'other'
    when p_source = 'app' then 'app'
    when p_source in ('whatsapp_bot', 'bot', 'whatsapp', 'whatsapp_inbound', 'qr_reception') then 'whatsapp'
    when p_source in ('website', 'web', 'online') then 'website'
    when p_source in ('walk_in', 'desk', 'front_desk', 'reception', 'dashboard', 'hospital_register', 'import') then 'front_desk'
    else 'other' end;
$$;

create or replace function sehat_admin_channel_report(p_days integer default 30)
returns table (what text, channel text, n bigint)
language sql stable security definer set search_path = public as $$
  with since as (select now() - make_interval(days => greatest(coalesce(p_days, 30), 1)) t)
  select x.what, x.channel, count(*) from (
    select 'Bookings' what, sehat_channel_of(a.booked_via) channel from appointments a, since where a.created_at > since.t
    union all select 'Medicine orders', sehat_channel_of(o.source) from medicine_orders o, since where o.created_at > since.t
    union all select 'Ambulance requests', sehat_channel_of(r.source) from ambulance_requests r, since where r.created_at > since.t
    union all select 'Insurance leads', sehat_channel_of(l.source) from insurance_leads l, since where l.created_at > since.t and l.code is not null
    union all select 'New patients', sehat_channel_of(p.source) from patients p, since where p.created_at > since.t
    union all select 'App sign-ins (new)', 'app' from patient_app_accounts pa, since where pa.created_at > since.t
  ) x
  where sehat_is_staff()
  group by 1, 2 order by 1, 2;
$$;
revoke all on function sehat_admin_channel_report(integer) from public, anon;
grant execute on function sehat_admin_channel_report(integer) to authenticated;

notify pgrst, 'reload schema';
