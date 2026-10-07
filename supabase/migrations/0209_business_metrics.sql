-- 0209: business metrics — the raw facts, the definitions as views, and a
-- frozen monthly history (docs/metrics-definitions.md is the written twin of
-- the views below; change one, change the other, bump definition_version).
--
-- What already existed and is reused: one patient per normalised phone
-- (patients), bookings (appointments), typed messages (free_text_log, 0201),
-- searches (bot_search_log, site_events), Razorpay payments (payments,
-- invoices), service areas and PIN → district (service_areas, pincode_directory).
-- What this adds:
--   • patients.first_*        — where a patient first came from, set once
--   • appointments.campaign_code
--   • patient_app_days        — a day the app was opened (for active patients)
--   • free_text_log.patient_id
--   • marketing_spend, offline_payments, districts, service_areas.area_type
--   • revenue_ledger, partner_plan_status, metric_* views (admin only)
--   • metrics_monthly_snapshot (+ nightly job that freezes last month once),
--     metrics_export_log
-- Months are calendar months in Asia/Kolkata. No names, phone numbers or
-- health details in any metric — internal ids only, and counts out.

-- ── 1. Where a patient first came from ───────────────────────────────────────
alter table patients add column if not exists first_source_type text;
alter table patients add column if not exists first_source_detail text;
alter table patients add column if not exists first_channel text;
alter table patients add column if not exists first_pincode text;
alter table patients add column if not exists first_seen_at timestamptz;
alter table patients drop constraint if exists patients_first_source_type_check;
alter table patients add constraint patients_first_source_type_check check (first_source_type is null or first_source_type in (
  'meta_ctwa_ad', 'instagram_reel', 'website_organic', 'google', 'sms_campaign', 'doctor_referral', 'patient_referral',
  'qr_poster', 'camp', 'direct', 'clinic_register', 'other', 'unknown'));
alter table patients drop constraint if exists patients_first_channel_check;
alter table patients add constraint patients_first_channel_check check (first_channel is null or first_channel in ('whatsapp', 'website', 'app', 'clinic'));

-- Set once. 'unknown' is the only value a later, known source may replace.
create or replace function sehat_note_first_touch(p_patient uuid, p_type text, p_detail text, p_channel text, p_pin text)
returns void language sql security definer set search_path = public as $$
  update patients set
    first_source_detail = case when first_source_type is null or first_source_type = 'unknown' then left(nullif(btrim(coalesce(p_detail, '')), ''), 200) else first_source_detail end,
    first_source_type   = case when first_source_type is null or first_source_type = 'unknown' then coalesce(nullif(p_type, ''), first_source_type, 'unknown') else first_source_type end,
    first_channel       = coalesce(first_channel, nullif(p_channel, '')),
    first_pincode       = coalesce(first_pincode, case when p_pin ~ '^[1-9][0-9]{5}$' then p_pin end),
    first_seen_at       = coalesce(first_seen_at, now())
  where id = p_patient;
$$;
revoke all on function sehat_note_first_touch(uuid, text, text, text, text) from public, anon, authenticated;

-- A new patient row starts its first touch from how it was made.
create or replace function sehat_patients_first_touch_default()
returns trigger language plpgsql as $$
begin
  new.first_seen_at := coalesce(new.first_seen_at, new.created_at, now());
  new.first_channel := coalesce(new.first_channel, case new.source
    when 'whatsapp_inbound' then 'whatsapp' when 'hospital_register' then 'clinic' when 'import' then 'clinic'
    when 'qr_reception' then 'clinic' when 'walk_in' then 'clinic' else null end);
  new.first_source_type := coalesce(new.first_source_type, case when new.source in ('hospital_register', 'import') then 'clinic_register' else 'unknown' end);
  new.first_pincode := coalesce(new.first_pincode, new.pin_code);
  return new;
end $$;
drop trigger if exists patients_first_touch on patients;
create trigger patients_first_touch before insert on patients for each row execute function sehat_patients_first_touch_default();

-- Backfill: the earliest booking says the channel; imported registers are the clinic's.
update patients p set
  first_seen_at = coalesce(p.first_seen_at, least(p.created_at,
    (select min(a.created_at) from appointments a where sehat_normalise_phone(a.patient_phone) = p.phone))),
  first_channel = coalesce(p.first_channel,
    (select case a.booked_via when 'whatsapp_bot' then 'whatsapp' when 'whatsapp' then 'whatsapp' when 'app' then 'app'
                              when 'website' then 'website' when 'web' then 'website' else 'clinic' end
       from appointments a where sehat_normalise_phone(a.patient_phone) = p.phone order by a.created_at limit 1),
    case p.source when 'whatsapp_inbound' then 'whatsapp' when 'hospital_register' then 'clinic' else null end),
  first_source_type = coalesce(p.first_source_type, case when p.source = 'hospital_register' then 'clinic_register' else 'unknown' end),
  first_pincode = coalesce(p.first_pincode, p.pin_code)
where p.first_seen_at is null or p.first_source_type is null;

alter table appointments add column if not exists campaign_code text;

-- ── 2. Activity a phone can be counted by ────────────────────────────────────
create table if not exists patient_app_days (
  patient_id uuid not null references patients(id) on delete cascade,
  day date not null,
  primary key (patient_id, day)
);
alter table patient_app_days enable row level security;
revoke all on patient_app_days from anon, authenticated;

alter table free_text_log add column if not exists patient_id uuid references patients(id) on delete set null;
create index if not exists free_text_log_patient on free_text_log (patient_id) where patient_id is not null;

-- 0196 + a day of app use for the active-patient count.
create or replace function sehat_me()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  update patient_app_accounts set last_seen_at = now() where auth_uid = auth.uid();
  insert into patient_app_days (patient_id, day)
  select p.id, (now() at time zone 'Asia/Kolkata')::date from patients p where p.phone = v_phone
  on conflict do nothing;
  return jsonb_build_object('phone', v_phone,
    'name', coalesce((select p.name from patients p where p.phone = v_phone), (select w.profile_name from wa_contacts w where w.phone = v_phone)),
    'pin_code', (select p.pin_code from patients p where p.phone = v_phone));
end $$;
revoke all on function sehat_me() from public, anon;
grant execute on function sehat_me() to authenticated;

-- 0201 + the patient: WhatsApp by the phone, the app by its login.
create or replace function sehat_ft_log(p_channel text, p_text text, p_phone text, p_user uuid, m jsonb, p_search_log bigint default null)
returns bigint language sql security definer set search_path = public as $$
  insert into free_text_log (channel, phone_hash, user_id, raw_text, normalized_text,
    matched_intent, matched_speciality, matched_pin, matched_place, matched_when, time_window,
    secondary_intents, matched_terms, is_emergency, confidence, action, method, needs_review, bot_search_log_id, patient_id)
  values (p_channel, sehat_ft_phone_hash(p_phone), p_user, left(p_text, 1000), m ->> 'normalized_text',
    m ->> 'intent', m ->> 'speciality', m ->> 'pincode', m ->> 'location', (m ->> 'target_date')::date, m ->> 'time_window',
    array(select jsonb_array_elements_text(coalesce(m -> 'secondary_intents', '[]'))),
    array(select jsonb_array_elements_text(coalesce(m -> 'matched_terms', '[]'))),
    coalesce((m ->> 'is_emergency')::boolean, false), (m ->> 'confidence')::numeric, m ->> 'action',
    case m ->> 'action' when 'menu' then 'fallback_menu' when 'confirm' then 'confirm' else 'rules' end,
    not coalesce((m ->> 'is_emergency')::boolean, false) and coalesce((m ->> 'confidence')::numeric, 0) < 0.7,
    p_search_log,
    coalesce((select p.id from patients p where p.phone = sehat_normalise_phone(p_phone) and p_phone is not null),
             (select p.id from patient_app_accounts a join patients p on p.phone = a.phone where a.auth_uid = p_user)))
  returning id;
$$;
revoke all on function sehat_ft_log(text, text, text, uuid, jsonb, bigint) from public, anon, authenticated;

-- ── 3. Money and districts, entered by admins ────────────────────────────────
create table if not exists marketing_spend (
  id          bigserial primary key,
  month       date not null check (extract(day from month) = 1),
  channel     text not null check (channel in ('meta_ads', 'google_ads', 'sms', 'print', 'camp', 'salary_field_staff', 'other')),
  campaign    text,
  amount_inr  numeric(12,2) not null check (amount_inr >= 0),
  notes       text,
  entered_by  uuid default auth.uid(),
  entered_at  timestamptz not null default now()
);

-- Money received outside Razorpay (UPI, bank, cash). Never card or account numbers.
create table if not exists offline_payments (
  id              bigserial primary key,
  payer_type      text not null check (payer_type in ('business', 'practitioner', 'patient', 'other')),
  business_id     uuid references businesses(id) on delete set null,
  practitioner_id uuid references practitioners(id) on delete set null,
  payer_name      text,
  district        text,
  purpose         text not null check (purpose in ('pilot_registration', 'subscription', 'whatsapp_marketing_credits', 'featured_listing', 'lead_fees', 'other')),
  amount_inr      numeric(12,2) not null check (amount_inr > 0),
  gst_amount      numeric(12,2) not null default 0 check (gst_amount >= 0),
  method          text not null check (method in ('upi', 'bank', 'cash', 'cheque', 'other')),
  reference_no    text,
  invoice_no      text,
  paid_at         date not null,
  period_start    date,
  period_end      date,
  refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0),
  refunded_at     date,
  notes           text,
  recorded_by     uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table if not exists districts (
  id                    serial primary key,
  name                  text not null,
  state                 text not null,
  district_key          text generated always as (lower(regexp_replace(name, '[^A-Za-z]', '', 'g'))) stored,
  status                text not null default 'planned' check (status in ('planned', 'onboarding', 'live', 'paused')),
  onboarding_started_at date,
  first_partner_live_at date,
  first_booking_at      date,
  notes                 text,
  unique (district_key, state)
);

-- Rural / urban for the access numbers grant bodies ask for.
alter table service_areas add column if not exists area_type text check (area_type in ('urban', 'rural'));
update service_areas set area_type = case when area_name in
  ('Yamuna Nagar', 'Jagadhri', 'Radaur', 'Bilaspur', 'Chhachhrauli', 'Sadhaura', 'Buria', 'Barara', 'Shahbad') then 'urban' else 'rural' end
 where area_type is null;

-- District #1: what the data says; the onboarding date is for the admin to fill.
insert into districts (name, state, status, first_partner_live_at, first_booking_at, notes)
select 'Yamuna Nagar', 'Haryana', 'live',
       (select min(b.created_at)::date from businesses b where b.status = 'active' and b.own_pin_code in (select pin_code from service_areas)),
       (select min(a.created_at)::date from appointments a join businesses b on b.id = a.business_id where b.own_pin_code in (select pin_code from service_areas)),
       'District #1 (pilot). Fill in when onboarding started.'
on conflict (district_key, state) do nothing;

create table if not exists metrics_monthly_snapshot (
  month              date not null,
  district           text not null default 'all',
  metric_key         text not null,
  value              numeric,
  definition_version integer not null,
  computed_at        timestamptz not null default now(),
  primary key (month, district, metric_key, definition_version)
);

create table if not exists metrics_export_log (
  id          bigserial primary key,
  exported_by uuid default auth.uid(),
  exported_at timestamptz not null default now(),
  kind        text not null,
  params      jsonb
);

-- Admins only, everywhere.
do $$
declare t text;
begin
  foreach t in array array['marketing_spend', 'offline_payments', 'districts', 'metrics_monthly_snapshot', 'metrics_export_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format('create policy %I on %I for all to authenticated using (sehat_is_admin()) with check (sehat_is_admin())', t || '_admin', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;
-- Snapshots are frozen: no edits, even by admins (the job inserts as owner).
drop policy if exists metrics_monthly_snapshot_admin on metrics_monthly_snapshot;
create policy metrics_monthly_snapshot_admin on metrics_monthly_snapshot for select to authenticated using (sehat_is_admin());
drop policy if exists metrics_export_log_admin on metrics_export_log;
create policy metrics_export_log_admin on metrics_export_log for select to authenticated using (sehat_is_admin());
create policy metrics_export_log_insert on metrics_export_log for insert to authenticated with check (sehat_is_admin());

-- ── 4. The definitions, as views (owner-run; reached only through admin RPCs) ─
create or replace function sehat_month(t timestamptz)
returns date language sql immutable parallel safe as $$ select date_trunc('month', t at time zone 'Asia/Kolkata')::date $$;

create or replace function sehat_pin_district_key(p_pin text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select district_key from sehat_pin_district(p_pin)), 'unknown');
$$;

-- Money in: Razorpay payments, Razorpay wallet top-ups, offline payments.
create or replace view revenue_ledger as
  select 'razorpay'::text as source, p.id::text as ref, p.business_id, sehat_month(p.created_at) as month, p.created_at::date as paid_on,
         case p.type when 'premium_slot' then 'featured_listing' when 'wallet_topup' then 'whatsapp_marketing_credits' else 'subscription' end as purpose,
         coalesce(p.taxable_value, p.amount) as amount_ex_gst, coalesce(p.tax_total, 0) as gst, 0::numeric as refunded,
         p.term_start as period_start, p.term_end as period_end,
         sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key
    from payments p left join businesses b on b.id = p.business_id
   where p.status = 'paid'
  union all
  select 'offline', o.id::text, o.business_id, sehat_month(o.paid_at::timestamptz), o.paid_at, o.purpose,
         o.amount_inr, o.gst_amount, o.refunded_amount, o.period_start, o.period_end,
         coalesce(lower(regexp_replace(o.district, '[^A-Za-z]', '', 'g')),
                  sehat_pin_district_key((select coalesce(b.own_pin_code, b.pin_codes[1]) from businesses b where b.id = o.business_id)))
    from offline_payments o;

-- Who is paying now, on what, until when.
create or replace view partner_plan_status as
  select b.id as business_id, b.name, b.vertical, b.status, b.pricing_plan_code, b.term_start, b.term_end,
         (b.term_end is not null and b.term_end >= (now() at time zone 'Asia/Kolkata')::date) as paying_now,
         (select max(r.paid_on) from revenue_ledger r where r.business_id = b.id) as last_paid_on,
         sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key
    from businesses b;

-- Every countable thing a patient did, by internal id (never a phone).
create or replace view metric_patient_events as
  select p.id as patient_id, a.created_at as at, 'booking'::text as kind,
         case a.booked_via when 'whatsapp_bot' then 'whatsapp' when 'app' then 'app' when 'website' then 'website' else coalesce(a.booked_via, 'other') end as channel,
         sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key
    from appointments a join patients p on p.phone = sehat_normalise_phone(a.patient_phone) left join businesses b on b.id = a.business_id
  union all
  select f.patient_id, f.created_at, 'message', f.channel, sehat_pin_district_key(f.matched_pin) from free_text_log f where f.patient_id is not null
  union all
  select d.patient_id, d.day::timestamptz, 'app_session', 'app', 'unknown' from patient_app_days d
  union all
  select p.id, o.created_at, 'medicine_order', coalesce(o.source, 'other'), sehat_pin_district_key(o.pin_code)
    from medicine_orders o join patients p on p.phone = sehat_normalise_phone(o.patient_phone)
  union all
  select p.id, r.created_at, 'ambulance', coalesce(r.source, 'other'), sehat_pin_district_key(r.pin_code)
    from ambulance_requests r join patients p on p.phone = sehat_normalise_phone(r.patient_phone)
  union all
  select p.id, l.created_at, 'insurance', coalesce(l.source, 'other'), sehat_pin_district_key(l.pincode)
    from insurance_leads l join patients p on p.phone = sehat_normalise_phone(l.patient_phone);

-- Monthly active patients.
create or replace view metric_map_monthly as
  select sehat_month(at) as month, district_key, count(distinct patient_id) as patients from metric_patient_events group by 1, 2
  union all
  select sehat_month(at), 'all', count(distinct patient_id) from metric_patient_events group by 1;

-- Bookings, split by status; completed = marked completed, or the time passed without cancel / no-show.
create or replace view metric_bookings_monthly as
  select sehat_month(a.created_at) as month,
         sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key,
         case when a.purpose like 'Lab%' or b.vertical = 'lab' then 'lab' when b.vertical in ('clinic', 'hospital') then 'doctor' else coalesce(b.vertical, 'other') end as vertical,
         case a.booked_via when 'whatsapp_bot' then 'whatsapp' else coalesce(a.booked_via, 'other') end as channel,
         count(*) as total,
         count(*) filter (where a.status = 'completed' or (a.status in ('booked', 'confirmed') and a.slot_datetime < now())) as completed,
         count(*) filter (where a.status = 'cancelled') as cancelled,
         count(*) filter (where a.status = 'no_show') as no_show
    from appointments a left join businesses b on b.id = a.business_id
   group by 1, 2, 3, 4;

-- Revenue: excluding GST, net of refunds.
create or replace view metric_revenue_monthly as
  select month, district_key, purpose, sum(amount_ex_gst - refunded) as revenue, sum(gst) as gst, count(*) as payments
    from revenue_ledger group by 1, 2, 3;

-- MRR: each subscription spread evenly over the months it covers.
create or replace view metric_mrr_monthly as
  select m::date as month, r.district_key,
         sum((r.amount_ex_gst - r.refunded) / greatest(1, (extract(year from age(r.period_end, r.period_start)) * 12 + extract(month from age(r.period_end, r.period_start)))::int + 1)) as mrr
    from revenue_ledger r,
         generate_series(date_trunc('month', r.period_start), date_trunc('month', r.period_end), interval '1 month') m
   where r.purpose = 'subscription' and r.period_start is not null and r.period_end is not null
   group by 1, 2;

-- Partners: active (live, with a booking or a profile view that month) and paying (a payment covering a day of it).
create or replace view metric_partners_monthly as
  with months as (select generate_series(date '2026-01-01', sehat_month(now()), interval '1 month')::date as month),
  biz as (select b.id, b.vertical, b.status, sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key from businesses b)
  select m.month, biz.district_key, biz.vertical,
         count(*) filter (where biz.status = 'active' and (
            exists (select 1 from appointments a where a.business_id = biz.id and sehat_month(a.created_at) = m.month)
            or exists (select 1 from site_events e where e.business_id = biz.id and e.event_type = 'doctor_view' and sehat_month(e.created_at) = m.month))) as active,
         count(*) filter (where exists (select 1 from revenue_ledger r where r.business_id = biz.id
            and coalesce(r.period_start, r.paid_on) <= (m.month + interval '1 month' - interval '1 day')::date
            and coalesce(r.period_end, (r.paid_on + interval '1 month')::date) >= m.month)) as paying
    from months m cross join biz
   group by 1, 2, 3;

-- Repeat: a second booking within 30 / 90 days of the first.
create or replace view metric_repeat_cohorts as
  with b as (select p.id as patient_id, a.created_at, row_number() over (partition by p.id order by a.created_at) as n
               from appointments a join patients p on p.phone = sehat_normalise_phone(a.patient_phone) where a.status <> 'cancelled'),
  firsts as (select patient_id, created_at as first_at from b where n = 1),
  seconds as (select patient_id, created_at as second_at from b where n = 2)
  select sehat_month(f.first_at) as cohort_month, count(*) as new_patients,
         count(*) filter (where s.second_at <= f.first_at + interval '30 days') as repeat_30,
         count(*) filter (where s.second_at <= f.first_at + interval '90 days') as repeat_90
    from firsts f left join seconds s using (patient_id)
   group by 1;

-- Cohort retention: of each month's new patients, how many were active N months later.
create or replace view metric_retention_cohorts as
  with firsts as (select patient_id, min(sehat_month(at)) as cohort_month from metric_patient_events group by 1),
  active as (select distinct patient_id, sehat_month(at) as month from metric_patient_events)
  select f.cohort_month,
         ((extract(year from age(a.month, f.cohort_month)) * 12) + extract(month from age(a.month, f.cohort_month)))::int as month_offset,
         count(distinct a.patient_id) as active,
         (select count(*) from firsts f2 where f2.cohort_month = f.cohort_month) as cohort_size
    from firsts f join active a on a.patient_id = f.patient_id and a.month >= f.cohort_month
   group by 1, 2;

-- New patients by where they first came from, against what that channel cost.
create or replace view metric_cac_monthly as
  with newp as (
    select sehat_month(first_seen_at) as month,
           case first_source_type when 'meta_ctwa_ad' then 'meta_ads' when 'instagram_reel' then 'meta_ads' when 'google' then 'google_ads'
             when 'sms_campaign' then 'sms' when 'qr_poster' then 'print' when 'camp' then 'camp' else 'other' end as channel,
           count(*) as new_patients
      from patients where first_seen_at is not null and coalesce(first_source_type, 'unknown') <> 'clinic_register' group by 1, 2),
  spend as (select month, channel, sum(amount_inr) as spend from marketing_spend group by 1, 2)
  select coalesce(s.month, n.month) as month, coalesce(s.channel, n.channel) as channel,
         coalesce(s.spend, 0) as spend, coalesce(n.new_patients, 0) as new_patients,
         case when coalesce(n.new_patients, 0) > 0 then round(coalesce(s.spend, 0) / n.new_patients, 2) end as cac
    from spend s full join newp n on n.month = s.month and n.channel = s.channel;

-- Funnel: searched → shown results → opened a profile → booked → completed.
create or replace view metric_funnel_monthly as
  with months as (select generate_series(date '2026-01-01', sehat_month(now()), interval '1 month')::date as month)
  select m.month,
         (select count(*) from bot_search_log x where sehat_month(x.created_at) = m.month)
           + (select count(*) from site_events e where e.event_type = 'search' and sehat_month(e.created_at) = m.month)
           + (select count(*) from free_text_log f where sehat_month(f.created_at) = m.month) as searches,
         (select count(*) from bot_search_log x where x.found and sehat_month(x.created_at) = m.month)
           + (select count(*) from site_events e where e.event_type = 'search' and sehat_month(e.created_at) = m.month)
           + (select count(*) from free_text_log f where f.action = 'proceed' and sehat_month(f.created_at) = m.month) as results_shown,
         (select count(*) from site_events e where e.event_type in ('doctor_view', 'whatsapp_click') and sehat_month(e.created_at) = m.month) as profile_views,
         (select count(*) from appointments a where sehat_month(a.created_at) = m.month) as booked,
         (select count(*) from appointments a where sehat_month(a.created_at) = m.month
             and (a.status = 'completed' or (a.status in ('booked', 'confirmed') and a.slot_datetime < now()))) as completed
    from months m;

-- Time to launch a district.
create or replace view metric_districts as
  select d.*, (d.first_booking_at - d.onboarding_started_at) as days_to_launch from districts d;

-- Access (grant bodies): rural vs urban bookings, by vertical, ambulance response, unmet demand.
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
         (select count(*) from free_text_log f where sehat_month(f.created_at) = m.month) as typed_messages
    from months m;

do $$
declare v text;
begin
  foreach v in array array['revenue_ledger', 'partner_plan_status', 'metric_patient_events', 'metric_map_monthly', 'metric_bookings_monthly',
    'metric_revenue_monthly', 'metric_mrr_monthly', 'metric_partners_monthly', 'metric_repeat_cohorts', 'metric_retention_cohorts',
    'metric_cac_monthly', 'metric_funnel_monthly', 'metric_districts', 'metric_impact_monthly'] loop
    execute format('revoke all on %I from public, anon, authenticated', v);
  end loop;
end $$;

-- ── 5. Admin reads ───────────────────────────────────────────────────────────
-- One call for the Insights section: every metric between two months, all
-- districts or one. Admins only.
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
    'snapshots', (select count(*) from metrics_monthly_snapshot));
end $$;
revoke all on function sehat_admin_metrics(date, date, text) from public, anon;
grant execute on function sehat_admin_metrics(date, date, text) to authenticated;

-- ── 6. Frozen monthly history ────────────────────────────────────────────────
-- definition_version 1 = docs/metrics-definitions.md as of 0209.
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
  ) x where value is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function sehat_metrics_snapshot(date, integer) from public, anon, authenticated;

do $$ begin
  begin perform cron.unschedule('metrics-monthly-snapshot');
  exception when others then null; end;
  -- Daily; freezes last month the first time it runs in a new month, then does nothing.
  perform cron.schedule('metrics-monthly-snapshot', '20 19 * * *', $job$ select public.sehat_metrics_snapshot() $job$);
end $$;

notify pgrst, 'reload schema';
