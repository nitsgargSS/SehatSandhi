-- ============================================================================
-- 0214 — Business metrics, round two (the rest of the plan) + districts by themselves
-- ============================================================================
-- AFTER 0213. Safe to re-run. docs/metrics-definitions.md: definition version 1
-- still (new metrics added, none changed).
--
--   1. Source per booking: patients keep their LATEST touch too (last_source_*,
--      set by every note of a touch); a booking made online copies it when it is
--      under 30 days old (appointments.source_type / campaign_code), else
--      'direct'; a desk booking is 'clinic_desk'. Older bookings: 'unknown'.
--   2. Where partners came from: businesses.first_source_*; a matching doctor
--      lead (phone / email) → 'field_sales' with the lead; the registration
--      wizard sends the website's first touch (sehat_signup_set_source, first
--      day only, as sehat_signup_set_category).
--   3. Coupons with payments: revenue_ledger gains coupon_code /
--      coupon_discount (Razorpay's, and the offline form's new fields).
--   4. Partner retention: subscription periods ending in a month, and how many
--      were renewed (a later subscription paid by 30 days after the last day).
--   5. Unmet demand served: a known patient whose search found nobody, who
--      booked in that district within 90 days (the same kind of doctor when
--      it was one). unmet_demand_log.patient_id, written by typed WhatsApp
--      messages and the app's Find (sehat_note_unmet).
--   6. "Sehatsandhi से आपका कितना समय/खर्च बचा?" — one optional answer with a
--      rating (visit_savings, sehat_my_saved). Answers only; nothing medical.
--   7. Bookings by speciality; voice notes counted (free_text_log.input_kind —
--      0 until voice notes are connected).
--   8. Districts by themselves: a business registering in a new district adds
--      it (onboarding from that day); the first business going live sets
--      first_partner_live_at; the first booking sets first_booking_at. Dates
--      already entered are never changed.
-- ============================================================================

-- ── 1. Source per booking ────────────────────────────────────────────────────
alter table patients add column if not exists last_source_type text;
alter table patients add column if not exists last_source_detail text;
alter table patients add column if not exists last_seen_at timestamptz;
alter table appointments add column if not exists source_type text;

create or replace function sehat_note_first_touch(p_patient uuid, p_type text, p_detail text, p_channel text, p_pin text)
returns void language sql security definer set search_path = public as $$
  update patients set
    first_source_detail = case when first_source_type is null or first_source_type = 'unknown' then left(nullif(btrim(coalesce(p_detail, '')), ''), 200) else first_source_detail end,
    first_source_type   = case when first_source_type is null or first_source_type = 'unknown' then coalesce(nullif(p_type, ''), first_source_type, 'unknown') else first_source_type end,
    first_channel       = coalesce(first_channel, nullif(p_channel, '')),
    first_pincode       = coalesce(first_pincode, case when p_pin ~ '^[1-9][0-9]{5}$' then p_pin end),
    first_seen_at       = coalesce(first_seen_at, now()),
    -- 0214: the latest touch, every time one is known.
    last_source_type    = case when coalesce(p_type, '') not in ('', 'unknown') then p_type else last_source_type end,
    last_source_detail  = case when coalesce(p_type, '') not in ('', 'unknown') then left(nullif(btrim(coalesce(p_detail, '')), ''), 200) else last_source_detail end,
    last_seen_at        = case when coalesce(p_type, '') not in ('', 'unknown') then now() else last_seen_at end
  where id = p_patient;
$$;
revoke all on function sehat_note_first_touch(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function sehat_appointment_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.source_type is not null then return new; end if;
  if coalesce(new.booked_via, '') in ('whatsapp', 'whatsapp_bot', 'app', 'website', 'web') then
    select last_source_type, last_source_detail, last_seen_at into r
      from patients where phone = sehat_normalise_phone(new.patient_phone);
    if r.last_seen_at > now() - interval '30 days' then
      new.source_type := r.last_source_type;
      new.campaign_code := coalesce(new.campaign_code, r.last_source_detail);
    else
      new.source_type := 'direct';
    end if;
  else
    new.source_type := 'clinic_desk';
  end if;
  return new;
end $$;
drop trigger if exists appointments_source on appointments;
create trigger appointments_source before insert on appointments for each row execute function sehat_appointment_source();
update appointments set source_type = case when coalesce(booked_via, '') in ('whatsapp', 'whatsapp_bot', 'app', 'website', 'web') then 'unknown' else 'clinic_desk' end
 where source_type is null;

-- ── 2. Where partners came from ──────────────────────────────────────────────
alter table businesses add column if not exists first_source_type text;
alter table businesses add column if not exists first_source_detail text;
alter table businesses add column if not exists first_seen_at timestamptz;

create or replace function sehat_business_first_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare l record;
begin
  new.first_seen_at := coalesce(new.first_seen_at, new.created_at, now());
  if new.first_source_type is null then
    select id, source into l from doctor_leads
     where (new.phone is not null and sehat_normalise_phone(phone) = sehat_normalise_phone(new.phone))
        or (new.email is not null and lower(email) = lower(new.email))
     order by created_at limit 1;
    if l.id is not null then
      new.first_source_type := 'field_sales';
      new.first_source_detail := left('lead:' || l.id || coalesce(':' || l.source, ''), 200);
    else
      new.first_source_type := 'unknown';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists businesses_first_source on businesses;
create trigger businesses_first_source before insert on businesses for each row execute function sehat_business_first_source();

update businesses b set
  first_seen_at = coalesce(b.first_seen_at, b.created_at),
  first_source_type = coalesce(b.first_source_type, case when l.id is not null then 'field_sales' else 'unknown' end),
  first_source_detail = coalesce(b.first_source_detail, case when l.id is not null then left('lead:' || l.id || coalesce(':' || l.source, ''), 200) end)
  from businesses b2
  left join lateral (select id, source from doctor_leads d
                      where (b2.phone is not null and sehat_normalise_phone(d.phone) = sehat_normalise_phone(b2.phone))
                         or (b2.email is not null and lower(d.email) = lower(b2.email))
                      order by d.created_at limit 1) l on true
 where b.id = b2.id and b.first_source_type is null;

-- The registration wizard: the website's first touch, on the first day only.
create or replace function sehat_signup_set_source(p_business uuid, p_type text, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_type is null or p_type not in ('meta_ctwa_ad', 'instagram_reel', 'website_organic', 'google', 'sms_campaign', 'doctor_referral',
       'patient_referral', 'qr_poster', 'camp', 'direct', 'field_sales', 'other') then return; end if;
  update businesses set first_source_type = p_type, first_source_detail = left(nullif(btrim(coalesce(p_detail, '')), ''), 200)
   where id = p_business and created_at > now() - interval '1 day'
     and coalesce(first_source_type, 'unknown') = 'unknown';
end $$;
revoke all on function sehat_signup_set_source(uuid, text, text) from public;
grant execute on function sehat_signup_set_source(uuid, text, text) to anon, authenticated;

-- ── 3. Coupons ───────────────────────────────────────────────────────────────
alter table offline_payments add column if not exists coupon_code text;
alter table offline_payments add column if not exists coupon_discount numeric(12, 2) not null default 0;

create or replace view revenue_ledger as
  select 'razorpay'::text as source, p.id::text as ref, p.business_id, sehat_month(p.created_at) as month, p.created_at::date as paid_on,
         case p.type when 'premium_slot' then 'featured_listing' when 'wallet_topup' then 'whatsapp_marketing_credits' else 'subscription' end as purpose,
         coalesce(p.taxable_value, p.amount) as amount_ex_gst, coalesce(p.tax_total, 0) as gst, 0::numeric as refunded,
         p.term_start as period_start, p.term_end as period_end,
         sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key,
         nullif(btrim(p.coupon_code), '') as coupon_code, coalesce(p.coupon_discount, 0)::numeric as coupon_discount
    from payments p left join businesses b on b.id = p.business_id
   where p.status = 'paid'
  union all
  select 'offline', o.id::text, o.business_id, sehat_month(o.paid_at::timestamptz), o.paid_at, o.purpose,
         o.amount_inr, o.gst_amount, o.refunded_amount, o.period_start, o.period_end,
         coalesce(lower(regexp_replace(o.district, '[^A-Za-z]', '', 'g')),
                  sehat_pin_district_key((select coalesce(b.own_pin_code, b.pin_codes[1]) from businesses b where b.id = o.business_id))),
         nullif(btrim(o.coupon_code), ''), coalesce(o.coupon_discount, 0)
    from offline_payments o;

-- ── 6. The one savings question ──────────────────────────────────────────────
create table if not exists visit_savings (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('booking', 'order', 'trip', 'insurance')),
  ref_id     uuid not null,
  patient_id uuid references patients(id) on delete set null,
  answer     text not null check (answer in ('time_and_money', 'time', 'money', 'none')),
  channel    text not null default 'app' check (channel in ('app', 'website', 'whatsapp')),
  created_at timestamptz not null default now(),
  unique (kind, ref_id)
);
alter table visit_savings enable row level security;
drop policy if exists visit_savings_admin on visit_savings;
create policy visit_savings_admin on visit_savings for select to authenticated using (sehat_is_admin());

create or replace function sehat_my_saved(p_kind text, p_id uuid, p_answer text, p_channel text default 'app')
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  if p_answer is null or p_answer not in ('time_and_money', 'time', 'money', 'none') then raise exception 'Choose an answer.' using errcode = '22023'; end if;
  if not (
       (p_kind = 'booking' and exists (select 1 from appointments where id = p_id and patient_phone = v_phone))
    or (p_kind = 'order' and exists (select 1 from medicine_orders where id = p_id and patient_phone = v_phone))
    or (p_kind = 'trip' and exists (select 1 from ambulance_requests where id = p_id and patient_phone = v_phone))
    or (p_kind = 'insurance' and exists (select 1 from insurance_leads where id = p_id and patient_phone = v_phone))) then
    raise exception 'Not yours.' using errcode = '42501';
  end if;
  insert into visit_savings (kind, ref_id, patient_id, answer, channel)
  values (p_kind, p_id, (select id from patients where phone = sehat_normalise_phone(v_phone)), p_answer,
          case when p_channel in ('app', 'website', 'whatsapp') then p_channel else 'app' end)
  on conflict (kind, ref_id) do nothing;
end $$;
revoke all on function sehat_my_saved(text, uuid, text, text) from public, anon;
grant execute on function sehat_my_saved(text, uuid, text, text) to authenticated;

-- ── 5. Unmet demand of a known patient ───────────────────────────────────────
alter table unmet_demand_log add column if not exists patient_id uuid references patients(id) on delete set null;
create index if not exists unmet_demand_log_patient on unmet_demand_log (patient_id) where patient_id is not null;

create or replace function sehat_note_unmet_for(p_phone text, p_source text, p_speciality text, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v_patient uuid := (select id from patients where phone = p_phone);
begin
  if v_patient is null or p_pin is null then return; end if;
  -- One a day per patient, need and place.
  if exists (select 1 from unmet_demand_log where patient_id = v_patient and pin_code = p_pin
               and coalesce(speciality, '') = coalesce(p_speciality, '') and created_at > now() - interval '1 day') then return; end if;
  insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification, patient_id)
  values (p_source, p_pin, left(p_speciality, 40), false, v_patient);
end $$;
revoke all on function sehat_note_unmet_for(text, text, text, text) from public, anon, authenticated;

-- The app's Find, when a search shows nobody.
create or replace function sehat_note_unmet(p_speciality text, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_pin !~ '^[1-9][0-9]{5}$' then return; end if;
  perform sehat_note_unmet_for(sehat_normalise_phone(sehat_my_phone()), 'app', p_speciality, p_pin);
end $$;
revoke all on function sehat_note_unmet(text, text) from public, anon;
grant execute on function sehat_note_unmet(text, text) to authenticated;

-- ── 7. Voice notes, counted when they come ───────────────────────────────────
alter table free_text_log add column if not exists input_kind text not null default 'text';
alter table free_text_log drop constraint if exists free_text_log_input_kind_check;
alter table free_text_log add constraint free_text_log_input_kind_check check (input_kind in ('text', 'voice'));

-- ── The new definitions, as views ────────────────────────────────────────────
-- Bookings by where that booking came from.
create or replace view metric_booking_sources as
  select sehat_month(a.created_at) as month, sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key,
         coalesce(a.source_type, 'unknown') as source_type, a.campaign_code, count(*) as total
    from appointments a left join businesses b on b.id = a.business_id
   group by 1, 2, 3, 4;

-- Bookings by the doctor's speciality.
create or replace view metric_bookings_by_speciality as
  select sehat_month(a.created_at) as month, sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key,
         coalesce(pr.speciality, case when a.purpose like 'Lab%' or b.vertical = 'lab' then 'lab' else 'not recorded' end) as speciality,
         count(*) as total,
         count(*) filter (where a.status = 'completed' or (a.status in ('booked', 'confirmed') and a.slot_datetime < now())) as completed
    from appointments a left join businesses b on b.id = a.business_id left join practitioners pr on pr.id = a.practitioner_id
   group by 1, 2, 3;

-- Partners by where they came from, in the month they registered.
create or replace view metric_partner_sources as
  select sehat_month(coalesce(b.first_seen_at, b.created_at)) as month, sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key,
         b.vertical, coalesce(b.first_source_type, 'unknown') as source_type, count(*) as n
    from businesses b group by 1, 2, 3, 4;

-- Coupons used with payments.
create or replace view metric_coupons_monthly as
  select month, district_key, coupon_code, count(*) as payments, sum(coupon_discount) as discount, sum(amount_ex_gst - refunded) as revenue
    from revenue_ledger where coupon_code is not null group by 1, 2, 3;

-- Partner retention: subscription periods whose last day falls in the month (and has passed),
-- and how many were renewed — a later subscription paid no more than 30 days after that day.
-- Razorpay's period_end is the first day NOT covered; offline period_end is the last day covered.
create or replace view metric_partner_renewals as
  with subs as (
    select r.*, case when r.source = 'razorpay' then r.period_end - 1 else r.period_end end as last_day
      from revenue_ledger r where r.purpose = 'subscription' and r.period_end is not null and r.business_id is not null)
  select sehat_month(s.last_day::timestamptz) as month, s.district_key,
         count(*) as due,
         count(*) filter (where exists (select 1 from revenue_ledger n where n.business_id = s.business_id and n.purpose = 'subscription'
                                          and n.ref <> s.ref and n.paid_on > s.paid_on and n.paid_on <= s.last_day + 30)) as renewed
    from subs s
   where s.last_day < (now() at time zone 'Asia/Kolkata')::date
   group by 1, 2;

-- Unmet demand served: patients whose search found nobody that month, and how many of them
-- booked in that district within 90 days (the same speciality, when the need was a doctor's).
create or replace view metric_unmet_served as
  with u as (
    select distinct on (patient_id, sehat_month(created_at), coalesce(speciality, ''), sehat_pin_district_key(pin_code))
           patient_id, created_at, speciality, sehat_month(created_at) as month, sehat_pin_district_key(pin_code) as district_key
      from unmet_demand_log where patient_id is not null
     order by patient_id, sehat_month(created_at), coalesce(speciality, ''), sehat_pin_district_key(pin_code), created_at)
  select u.month, u.district_key, count(distinct u.patient_id) as unmet_patients,
         count(distinct u.patient_id) filter (where exists (
           select 1 from appointments a join patients p on p.phone = sehat_normalise_phone(a.patient_phone)
             left join businesses b on b.id = a.business_id left join practitioners pr on pr.id = a.practitioner_id
            where p.id = u.patient_id and a.created_at > u.created_at and a.created_at <= u.created_at + interval '90 days'
              and a.status <> 'cancelled'
              and sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) = u.district_key
              and (u.speciality is null or u.speciality !~ '^[A-Z]{2,5}$' or pr.speciality = u.speciality))) as served_patients
    from u group by 1, 2;

create or replace view metric_impact_monthly as
  with months as (select generate_series(date '2026-01-01', sehat_month(now()), interval '1 month')::date as month)
  select m.month,
         (select count(*) from appointments a join businesses b on b.id = a.business_id join service_areas s on s.pin_code = coalesce(b.own_pin_code, b.pin_codes[1])
           where s.area_type = 'rural' and sehat_month(a.created_at) = m.month) as rural_bookings,
         (select count(*) from appointments a join businesses b on b.id = a.business_id join service_areas s on s.pin_code = coalesce(b.own_pin_code, b.pin_codes[1])
           where s.area_type = 'urban' and sehat_month(a.created_at) = m.month) as urban_bookings,
         (select count(*) from medicine_orders o where sehat_month(o.created_at) = m.month) as medicine_orders,
         (select count(*) from ambulance_requests r where sehat_month(r.created_at) = m.month) as ambulance_requests,
         (select round(percentile_cont(0.5) within group (order by extract(epoch from (r.accepted_at - r.created_at)) / 60)::numeric, 1)
            from ambulance_requests r where r.accepted_at is not null and sehat_month(r.created_at) = m.month) as ambulance_median_accept_minutes,
         (select round(percentile_cont(0.5) within group (order by extract(epoch from (r.picked_at - r.created_at)) / 60)::numeric, 1)
            from ambulance_requests r where r.picked_at is not null and sehat_month(r.created_at) = m.month) as ambulance_median_pickup_minutes,
         (select count(*) from insurance_leads l where sehat_month(l.created_at) = m.month) as insurance_requests,
         (select count(*) from unmet_demand_log u where sehat_month(u.created_at) = m.month) as unmet_searches,
         (select count(*) from free_text_log f where sehat_month(f.created_at) = m.month and f.normalized_text ~ '[ऀ-ॿ]') as hindi_messages,
         (select count(*) from free_text_log f where sehat_month(f.created_at) = m.month) as typed_messages,
         -- 0214 (added at the end: the view's earlier columns are unchanged)
         (select count(*) from free_text_log f where sehat_month(f.created_at) = m.month and f.input_kind = 'voice') as voice_messages,
         (select count(*) from visit_savings v where sehat_month(v.created_at) = m.month and v.answer = 'time_and_money') as saved_time_and_money,
         (select count(*) from visit_savings v where sehat_month(v.created_at) = m.month and v.answer = 'time') as saved_time,
         (select count(*) from visit_savings v where sehat_month(v.created_at) = m.month and v.answer = 'money') as saved_money,
         (select count(*) from visit_savings v where sehat_month(v.created_at) = m.month and v.answer = 'none') as saved_none
    from months m;

do $$
declare v text;
begin
  foreach v in array array['revenue_ledger', 'metric_booking_sources', 'metric_bookings_by_speciality', 'metric_partner_sources',
    'metric_coupons_monthly', 'metric_partner_renewals', 'metric_unmet_served', 'metric_impact_monthly'] loop
    execute format('revoke all on %I from public, anon, authenticated', v);
  end loop;
end $$;

-- ── 8. Districts by themselves ───────────────────────────────────────────────
-- A business's district: India Post's for its PIN (what a business types can be
-- a division or a town), else what it typed. Older businesses without their own
-- PIN: their first coverage PIN, as every other metric does.
create or replace function sehat_business_district(p_business uuid)
returns table (name text, state text) language sql stable security definer set search_path = public as $$
  select coalesce(d.district, nullif(btrim(b.own_district), '')), coalesce(d.state, nullif(btrim(b.own_state), ''))
    from businesses b left join pincode_directory d on d.pin_code = coalesce(b.own_pin_code, b.pin_codes[1])
   where b.id = p_business and coalesce(d.district, nullif(btrim(b.own_district), '')) is not null
     and coalesce(d.state, nullif(btrim(b.own_state), '')) is not null
   limit 1;
$$;

create or replace function sehat_district_note(p_business uuid, p_event text, p_on date)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_state text; v_id integer;
begin
  select name, state into v_name, v_state from sehat_business_district(p_business);
  if v_name is null then return; end if;
  select id into v_id from districts
   where district_key = lower(regexp_replace(v_name, '[^A-Za-z]', '', 'g')) and sehat_area_key(state) = sehat_area_key(v_state);
  if v_id is null then
    insert into districts (name, state, status, onboarding_started_at, notes)
    values (initcap(v_name), initcap(v_state), 'onboarding', p_on, 'Added by itself when its first business registered (0214).')
    on conflict do nothing
    returning id into v_id;
    if v_id is null then return; end if;
  end if;
  if p_event = 'live' then
    update districts set first_partner_live_at = coalesce(first_partner_live_at, p_on),
                         status = case when status in ('planned', 'onboarding') then 'live' else status end
     where id = v_id;
  elsif p_event = 'booking' then
    update districts set first_booking_at = coalesce(first_booking_at, p_on) where id = v_id;
  end if;
end $$;
revoke all on function sehat_district_note(uuid, text, date) from public, anon, authenticated;

create or replace function sehat_businesses_district_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform sehat_district_note(new.id, 'registered', coalesce(new.created_at, now())::date);
  end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform sehat_district_note(new.id, 'live', (now() at time zone 'Asia/Kolkata')::date);
  end if;
  return null;
end $$;
drop trigger if exists businesses_district on businesses;
create trigger businesses_district after insert or update of status on businesses for each row execute function sehat_businesses_district_trg();

create or replace function sehat_appointments_district_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is not null then
    perform sehat_district_note(new.business_id, 'booking', (coalesce(new.created_at, now()) at time zone 'Asia/Kolkata')::date);
  end if;
  return null;
end $$;
drop trigger if exists appointments_district on appointments;
create trigger appointments_district after insert on appointments for each row execute function sehat_appointments_district_trg();

-- Backfill: every district a business is in. New rows take their earliest
-- registration as onboarding; the first live and first booking dates fill in
-- only where empty.
do $$
declare r record;
begin
  -- Rebuilt on every run: only the rows this migration added itself.
  delete from districts where notes = 'Added by itself when its first business registered (0214).';
  for r in select b.id, b.created_at, b.status from businesses b order by b.created_at loop
    perform sehat_district_note(r.id, 'registered', r.created_at::date);
  end loop;
  for r in select distinct on (dk) b.id, coalesce(b.term_start, b.created_at::date) as on_day,
             (select name from sehat_business_district(b.id)) || '|' || (select state from sehat_business_district(b.id)) as dk
             from businesses b where b.status = 'active' order by dk, coalesce(b.term_start, b.created_at::date) loop
    perform sehat_district_note(r.id, 'live', r.on_day);
  end loop;
  for r in select distinct on (dk) a.business_id, a.created_at,
             (select name from sehat_business_district(a.business_id)) || '|' || (select state from sehat_business_district(a.business_id)) as dk
             from appointments a where a.business_id is not null order by dk, a.created_at loop
    perform sehat_district_note(r.business_id, 'booking', (r.created_at at time zone 'Asia/Kolkata')::date);
  end loop;
end $$;

-- ── The admin read and the frozen history, with the new parts ────────────────
create or replace function sehat_admin_metrics(p_from date, p_to date, p_district text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d text := nullif(lower(regexp_replace(coalesce(p_district, ''), '[^A-Za-z]', '', 'g')), '');
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'map', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'patients', patients) order by month), '[]')
              from metric_map_monthly where district_key = coalesce(d, 'all') and month between p_from and p_to),
    'bookings', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
              select month, vertical, channel, sum(total) total, sum(completed) completed, sum(cancelled) cancelled, sum(no_show) no_show
                from metric_bookings_monthly where (d is null or district_key = d) and month between p_from and p_to group by 1, 2, 3) x),
    'revenue', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
              select month, purpose, sum(revenue) revenue, sum(gst) gst from metric_revenue_monthly
               where (d is null or district_key = d) and month between p_from and p_to group by 1, 2) x),
    'mrr', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
              select month, sum(mrr) mrr from metric_mrr_monthly where (d is null or district_key = d) and month between p_from and p_to group by 1) x),
    'partners', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
              select month, vertical, sum(active) active, sum(paying) paying from metric_partners_monthly
               where (d is null or district_key = d) and month between p_from and p_to group by 1, 2) x),
    'repeat', (select coalesce(jsonb_agg(to_jsonb(r) order by r.cohort_month), '[]') from metric_repeat_cohorts r where cohort_month between p_from and p_to),
    'retention', (select coalesce(jsonb_agg(to_jsonb(r) order by r.cohort_month, r.month_offset), '[]') from metric_retention_cohorts r where cohort_month between p_from and p_to),
    'cac', (select coalesce(jsonb_agg(to_jsonb(c) order by c.month, c.channel), '[]') from metric_cac_monthly c where month between p_from and p_to),
    'funnel', (select coalesce(jsonb_agg(to_jsonb(f) order by f.month), '[]') from metric_funnel_monthly f where month between p_from and p_to),
    'impact', (select coalesce(jsonb_agg(to_jsonb(i) order by i.month), '[]') from metric_impact_monthly i where month between p_from and p_to),
    'acquisition', (select coalesce(jsonb_agg(x), '[]') from (
              select sehat_month(first_seen_at) as month, coalesce(first_source_type, 'unknown') as source, coalesce(first_channel, 'unknown') as channel, count(*) as n
                from patients where first_seen_at is not null and sehat_month(first_seen_at) between p_from and p_to group by 1, 2, 3) x),
    'districts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from metric_districts x),
    'plans', (select jsonb_build_object('paying_now', count(*) filter (where paying_now), 'listed', count(*) filter (where status = 'active'))
                from partner_plan_status where d is null or district_key = d),
    'snapshots', (select count(*) from metrics_monthly_snapshot),
    -- 0214
    'booking_sources', (select coalesce(jsonb_agg(x), '[]') from (
              select month, source_type, campaign_code, sum(total) total from metric_booking_sources
               where (d is null or district_key = d) and month between p_from and p_to group by 1, 2, 3) x),
    'specialities', (select coalesce(jsonb_agg(x), '[]') from (
              select month, speciality, sum(total) total, sum(completed) completed from metric_bookings_by_speciality
               where (d is null or district_key = d) and month between p_from and p_to group by 1, 2) x),
    'partner_sources', (select coalesce(jsonb_agg(x), '[]') from (
              select month, vertical, source_type, sum(n) n from metric_partner_sources
               where (d is null or district_key = d) and month between p_from and p_to group by 1, 2, 3) x),
    'coupons', (select coalesce(jsonb_agg(x), '[]') from (
              select month, coupon_code, sum(payments) payments, sum(discount) discount, sum(revenue) revenue from metric_coupons_monthly
               where (d is null or district_key = d) and month between p_from and p_to group by 1, 2) x),
    'renewals', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
              select month, sum(due) due, sum(renewed) renewed from metric_partner_renewals
               where (d is null or district_key = d) and month between p_from and p_to group by 1) x),
    'unmet_served', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
              select month, sum(unmet_patients) unmet_patients, sum(served_patients) served_patients from metric_unmet_served
               where (d is null or district_key = d) and month between p_from and p_to group by 1) x),
    'savings', (select coalesce(jsonb_agg(x), '[]') from (
              select sehat_month(created_at) as month, answer, count(*) n from visit_savings
               where sehat_month(created_at) between p_from and p_to group by 1, 2) x));
end $$;
revoke all on function sehat_admin_metrics(date, date, text) from public, anon;
grant execute on function sehat_admin_metrics(date, date, text) to authenticated;

create or replace function sehat_metrics_snapshot(p_month date default null, p_version integer default 1)
returns integer language plpgsql security definer set search_path = public as $$
declare
  m date := coalesce(p_month, (sehat_month(now()) - interval '1 month')::date);
  n integer;
begin
  if exists (select 1 from metrics_monthly_snapshot where month = m and definition_version = p_version) then return 0; end if;
  insert into metrics_monthly_snapshot (month, district, metric_key, value, definition_version)
  select m, district, key, value, p_version from (
    select district_key as district, 'monthly_active_patients' as key, patients::numeric as value from metric_map_monthly where month = m
    union all select coalesce(district_key, 'unknown'), 'bookings', sum(total) from metric_bookings_monthly where month = m group by 1
    union all select 'all', 'bookings', sum(total) from metric_bookings_monthly where month = m
    union all select 'all', 'bookings_completed', sum(completed) from metric_bookings_monthly where month = m
    union all select 'all', 'bookings_cancelled', sum(cancelled) from metric_bookings_monthly where month = m
    union all select 'all', 'bookings_no_show', sum(no_show) from metric_bookings_monthly where month = m
    union all select 'all', 'revenue_ex_gst', sum(revenue) from metric_revenue_monthly where month = m
    union all select coalesce(district_key, 'unknown'), 'revenue_ex_gst', sum(revenue) from metric_revenue_monthly where month = m group by 1
    union all select 'all', 'mrr', sum(mrr) from metric_mrr_monthly where month = m
    union all select 'all', 'active_partners', sum(active) from metric_partners_monthly where month = m
    union all select 'all', 'paying_partners', sum(paying) from metric_partners_monthly where month = m
    union all select 'all', 'new_patients', new_patients from metric_repeat_cohorts where cohort_month = m
    union all select 'all', 'marketing_spend', sum(spend) from metric_cac_monthly where month = m
    union all select 'all', 'searches', searches from metric_funnel_monthly where month = m
    union all select 'all', 'results_shown', results_shown from metric_funnel_monthly where month = m
    union all select 'all', 'rural_bookings', rural_bookings from metric_impact_monthly where month = m
    union all select 'all', 'urban_bookings', urban_bookings from metric_impact_monthly where month = m
    union all select 'all', 'ambulance_requests', ambulance_requests from metric_impact_monthly where month = m
    union all select 'all', 'ambulance_median_accept_minutes', ambulance_median_accept_minutes from metric_impact_monthly where month = m
    union all select 'all', 'unmet_searches', unmet_searches from metric_impact_monthly where month = m
    -- 0214
    union all select 'all', 'renewals_due', sum(due) from metric_partner_renewals where month = m
    union all select 'all', 'renewals_renewed', sum(renewed) from metric_partner_renewals where month = m
    union all select 'all', 'unmet_patients', sum(unmet_patients) from metric_unmet_served where month = m
    union all select 'all', 'unmet_patients_served', sum(served_patients) from metric_unmet_served where month = m
    union all select 'all', 'coupon_discount', sum(discount) from metric_coupons_monthly where month = m
  ) x where value is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function sehat_metrics_snapshot(date, integer) from public, anon, authenticated;

-- ── Typed WhatsApp messages: the unmet need of a known patient ───────────────
create or replace function sehat_free_text_whatsapp(p_phone text, p_payload text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pin_hint text := nullif(btrim(split_part(coalesce(p_payload, ''), '|', 1)), '');
  v_text     text := btrim(substr(coalesce(p_payload, ''), length(split_part(coalesce(p_payload, ''), '|', 1)) + 2));
  m          jsonb;
  v_pin      text;
  v_branch   text;
  v_type     text;
  v_filter   text;
  v_list     text;
  v_log      bigint;
  v_search   bigint;
  v_route    text;
  v_out      text;
begin
  m := match_message(v_text, v_pin_hint);
  if (m ->> 'place_live')::boolean is false and m ->> 'intent' is null and not coalesce((m ->> 'is_emergency')::boolean, false) then
    perform sehat_ft_note_place(m, 'whatsapp');   -- a bare "Mumbai": still interest
  end if;
  v_pin := m ->> 'pincode';
  v_branch := m ->> 'next_branch';
  -- What the normal search node takes for this branch.
  v_type := case v_branch when 'doctor_search' then 'doctor' when 'lab_booking' then 'lab_booking'
                          when 'medicine' then 'pharmacy' when 'ambulance' then 'ambulance' when 'camps' then 'camps' end;
  v_filter := case when v_branch = 'doctor_search' then m ->> 'speciality' else v_type end;

  if not coalesce((m ->> 'is_emergency')::boolean, false) and (m ->> 'place_live')::boolean is false
     and m ->> 'intent' is not null then
    -- 0212: asked for somewhere we are not in yet — say so, and count it.
    perform sehat_ft_note_place(m, 'whatsapp');
    perform sehat_note_unmet_for(sehat_normalise_phone(p_phone), 'bot', coalesce(m ->> 'speciality', v_type, m ->> 'intent'), v_pin);
    insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
    values (coalesce(v_type, m ->> 'intent'), case when v_type = 'doctor' then v_filter end, v_pin, m ->> 'location', false)
    returning id into v_search;
    v_route := 'info';
    v_out := sehat_ft_fill('not_live_place', jsonb_build_object('place', coalesce(m ->> 'location_hi', m ->> 'location'),
               'what', coalesce(m ->> 'speciality_name_hi', case m ->> 'intent' when 'lab' then 'जांच (टेस्ट) लैब' when 'medicine' then 'दवाई'
                 when 'insurance' then 'हेल्थ इंश्योरेंस' when 'camps' then 'हेल्थ कैंप' when 'ambulance' then 'एम्बुलेंस' else 'डॉक्टर' end)));
  elsif (m ->> 'is_emergency')::boolean then
    v_list := bot_ambulance(v_pin);
    v_out := sehat_ft_fill('emergency', '{}') || case when v_list is not null then E'\n\n' || v_list else '' end;
    v_route := 'emergency';
  elsif m ->> 'action' = 'proceed' then
    if v_branch = 'doctor_search' and m ->> 'speciality' is null then
      v_route := 'branch'; v_out := m ->> 'reply_text';
    elsif v_branch in ('insurance', 'medicine') then
      v_route := 'branch'; v_out := m ->> 'reply_text';
    elsif v_pin is null then
      v_route := 'ask_pin'; v_out := (m ->> 'reply_text') || E'\n' || sehat_ft_fill('ask_pin', '{}');
    else
      -- The same search the buttons run; bot_search_bookable logs unmet demand.
      v_list := bot_generic_search(v_type, v_filter, v_pin);
      insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
      values (v_type, case when v_type = 'doctor' then v_filter end, v_pin, null, v_list is not null)
      returning id into v_search;
      if v_list is null then
        perform sehat_note_unmet_for(sehat_normalise_phone(p_phone), 'bot', coalesce(m ->> 'speciality', v_type), v_pin);
      end if;
      v_route := case when v_list is null then 'info' when v_type in ('doctor', 'lab_booking') then 'list' else 'info' end;
      v_out := (m ->> 'reply_text') || E'\n\n' || coalesce(v_list,
        sehat_ft_fill(case v_type when 'lab_booking' then 'none_lab' when 'doctor' then 'none_doctor' else 'none_other' end, '{}'));
    end if;
  elsif m ->> 'action' = 'confirm' then
    v_route := 'confirm'; v_out := m ->> 'reply_text';
  else
    v_route := 'menu'; v_out := m ->> 'reply_text';
  end if;

  v_log := sehat_ft_log('whatsapp', v_text, p_phone, null, m, v_search);

  return jsonb_build_object(
    'found', v_route in ('list', 'info', 'emergency'),
    'route', v_route,
    'text', v_out,
    'action', m ->> 'action',
    'next_branch', coalesce(v_branch, ''),
    'search_type', coalesce(v_type, ''),
    'filter_value', coalesce(v_filter, ''),
    'pincode', coalesce(v_pin, ''),
    'speciality', coalesce(m ->> 'speciality', ''),
    'target_date', coalesce(m ->> 'target_date', ''),
    'is_emergency', coalesce((m ->> 'is_emergency')::boolean, false),
    'confidence', m -> 'confidence',
    'log_id', v_log);
end $$;
revoke all on function sehat_free_text_whatsapp(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
