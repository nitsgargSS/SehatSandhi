-- ============================================================================
-- 0262 — WhatsApp Pro: its price, and the messages it sends by itself
-- ============================================================================
-- Decided 24 Oct 2026 (see 0261 for the clinic's own number):
--
--   WhatsApp Basic  ₹500 a month — as today.
--   WhatsApp Pro    ₹1,000 a month, charged with the clinic's plan every term
--                   like Basic, and instead of it (one or the other). Pro
--                   sends these by itself, each one switched on or off by the
--                   clinic:
--
--     welcome        when a patient is registered: their file number, and
--                    that their records will be in the Sehatsandhi app;
--     visit_summary  after the consultation: the prescription and the bill,
--                    in one message (or whichever of the two there is);
--     thank_you      a couple of hours later: "how was your visit?", 1 to 5 —
--                    at most once in 30 days per patient (the 0232 rules);
--     follow_up      the day before the follow-up date the doctor wrote.
--
-- A patient who has the Sehatsandhi app gets a notification in the app
-- instead (free, and it is where the record is); WhatsApp only when there is
-- no app or no notification could be queued.
--
-- WHO PAYS: on the clinic's own number Meta charges the clinic directly. On
-- our number — until the clinic connects its own — Pro's automatic messages
-- are not taken from the wallet: they are part of the plan.
--
-- Nothing is sent between 9 pm and 8 am: a thank-you or reminder that falls
-- then waits until 9 am.
--
-- HOW: triggers and a daily job put rows in wa_auto_messages; the wa-auto-send
-- edge function, every two minutes, claims the rows that are due
-- (sehat_wa_auto_claim, which re-checks everything and fills in the words),
-- sends them and reports back (sehat_wa_auto_done).
-- ============================================================================

-- ── 1. The price ────────────────────────────────────────────────────────────
alter table vertical_term_prices add column if not exists whatsapp_pro_price integer;
update vertical_term_prices set whatsapp_pro_price = whatsapp_price * 2 where whatsapp_pro_price is null;

alter table payments add column if not exists whatsapp_plan text;
alter table businesses add column if not exists renewal_whatsapp_plan text not null default 'basic';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_whatsapp_plan_check') then
    alter table payments add constraint payments_whatsapp_plan_check check (whatsapp_plan is null or whatsapp_plan in ('basic', 'pro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'businesses_renewal_whatsapp_plan_check') then
    alter table businesses add constraint businesses_renewal_whatsapp_plan_check check (renewal_whatsapp_plan in ('basic', 'pro'));
  end if;
end $$;

-- A clinic on Pro renews on Pro, and is reminded of the Pro price.
update businesses b set renewal_whatsapp_plan = 'pro'
  from business_wa_accounts a where a.business_id = b.id and a.plan = 'pro' and b.renewal_whatsapp_plan <> 'pro';

create or replace function sehat_business_renewal_price(p_business uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  b businesses;
  v_months integer;
  v_price integer;
begin
  select * into b from businesses where id = p_business;
  if b.id is null then return null; end if;
  if b.renewal_price is not null then return b.renewal_price; end if;
  v_months := coalesce(b.renewal_term_months, b.months_paid, 1);

  select p.subscription_price + case when not b.renewal_whatsapp then 0
                                      when b.renewal_whatsapp_plan = 'pro' then coalesce(p.whatsapp_pro_price, p.whatsapp_price * 2)
                                      else p.whatsapp_price end
    into v_price
    from vertical_term_prices p
   where p.vertical = b.vertical and p.months = v_months and p.is_enabled;
  if v_price is not null then return v_price; end if;

  if to_regclass('public.plan_terms') is not null then
    execute 'select price from plan_terms where plan_code = $1 and months = $2 and is_enabled'
      into v_price using b.pricing_plan_code, v_months;
    if v_price is not null then return v_price; end if;
  end if;

  return b.locked_monthly_price * v_months;
end $$;

-- The owner picks Basic or Pro for the next renewal.
create or replace function sehat_set_renewal_whatsapp_plan(p_business uuid, p_plan text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_caller_is_owner(p_business) then
    raise exception 'Only the owner can change the plan.' using errcode = '42501';
  end if;
  if p_plan not in ('basic', 'pro') then raise exception 'Basic or Pro.'; end if;
  update businesses set renewal_whatsapp_plan = p_plan where id = p_business;
end $$;
revoke all on function sehat_set_renewal_whatsapp_plan(uuid, text) from public, anon;
grant execute on function sehat_set_renewal_whatsapp_plan(uuid, text) to authenticated;

-- Admins set the Pro price with the others ("whatsapp_pro_price" in each term;
-- left out, it stays as it was).
create or replace function sehat_admin_set_type_pricing(
  p_vertical text, p_terms jsonb,
  p_commission_percent numeric, p_commission_enabled boolean,
  p_included_doctors integer, p_extra_doctor_price integer
) returns void
language plpgsql security definer set search_path = public as $$
declare
  t jsonb;
  v_who text := (select email from auth.users where id = auth.uid());
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not exists (select 1 from vertical_billing where vertical = p_vertical) then
    raise exception 'Unknown business type: %', p_vertical;
  end if;
  if p_commission_percent < 0 or p_commission_percent > 100 then
    raise exception 'Commission is 0–100%%.';
  end if;
  if p_included_doctors < 0 or p_extra_doctor_price < 0 then
    raise exception 'Doctor numbers cannot be negative.';
  end if;

  for t in select * from jsonb_array_elements(coalesce(p_terms, '[]'::jsonb)) loop
    if (t->>'months')::int not in (1, 6, 12) then raise exception 'Terms are 1, 6 or 12 months.'; end if;
    if (t->>'subscription_price')::int < 0 or (t->>'whatsapp_price')::int < 0 or coalesce((t->>'whatsapp_pro_price')::int, 0) < 0 then
      raise exception 'Prices cannot be negative.';
    end if;
    insert into vertical_term_prices (vertical, months, subscription_price, whatsapp_price, whatsapp_pro_price, is_enabled, label, updated_by, updated_at)
    values (p_vertical, (t->>'months')::int, (t->>'subscription_price')::int, (t->>'whatsapp_price')::int,
            coalesce((t->>'whatsapp_pro_price')::int, (t->>'whatsapp_price')::int * 2),
            coalesce((t->>'is_enabled')::boolean, true),
            case (t->>'months')::int when 1 then 'Monthly' when 6 then '6 months' else '12 months' end,
            v_who, now())
    on conflict (vertical, months) do update set
      subscription_price = excluded.subscription_price,
      whatsapp_price     = excluded.whatsapp_price,
      whatsapp_pro_price = case when t ? 'whatsapp_pro_price' then excluded.whatsapp_pro_price
                                else coalesce(vertical_term_prices.whatsapp_pro_price, excluded.whatsapp_pro_price) end,
      is_enabled         = excluded.is_enabled,
      updated_by         = excluded.updated_by,
      updated_at         = now();
  end loop;

  update vertical_billing set
    commission_percent = p_commission_percent,
    commission_enabled = p_commission_enabled,
    included_doctors   = p_included_doctors,
    extra_doctor_price = p_extra_doctor_price
   where vertical = p_vertical;
end $$;
revoke all on function sehat_admin_set_type_pricing(text, jsonb, numeric, boolean, integer, integer) from public, anon, authenticated;
grant execute on function sehat_admin_set_type_pricing(text, jsonb, numeric, boolean, integer, integer) to authenticated;

-- ── 2. What the clinic switched on ──────────────────────────────────────────
create table if not exists wa_auto_settings (
  business_id uuid primary key references businesses(id) on delete cascade,
  welcome boolean not null default true,
  visit_summary boolean not null default true,
  thank_you boolean not null default true,
  follow_up boolean not null default true,
  thank_you_after_minutes integer not null default 120 check (thank_you_after_minutes between 30 and 1440),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table wa_auto_settings enable row level security;
revoke all on wa_auto_settings from anon;
grant select on wa_auto_settings to authenticated;
drop policy if exists clinic_reads_auto_settings on wa_auto_settings;
create policy clinic_reads_auto_settings on wa_auto_settings for select to authenticated
  using (sehat_caller_owns_business(business_id) or sehat_is_admin());

create or replace function sehat_wa_auto_settings_save(
  p_business uuid, p_welcome boolean, p_visit_summary boolean, p_thank_you boolean, p_follow_up boolean,
  p_thank_you_after_minutes integer
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_caller_is_owner(p_business) then
    raise exception 'Only the owner can change automatic messages.' using errcode = '42501';
  end if;
  insert into wa_auto_settings (business_id, welcome, visit_summary, thank_you, follow_up, thank_you_after_minutes, updated_at, updated_by)
  values (p_business, p_welcome, p_visit_summary, p_thank_you, p_follow_up,
          least(greatest(coalesce(p_thank_you_after_minutes, 120), 30), 1440), now(), auth.uid())
  on conflict (business_id) do update set
    welcome = excluded.welcome, visit_summary = excluded.visit_summary, thank_you = excluded.thank_you,
    follow_up = excluded.follow_up, thank_you_after_minutes = excluded.thank_you_after_minutes,
    updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function sehat_wa_auto_settings_save(uuid, boolean, boolean, boolean, boolean, integer) from public, anon;
grant execute on function sehat_wa_auto_settings_save(uuid, boolean, boolean, boolean, boolean, integer) to authenticated;

-- Is this message switched on for this clinic? Pro, WhatsApp open (0218), and
-- the clinic has not turned it off (on by default).
create or replace function sehat_wa_auto_on(p_business uuid, p_kind text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_wa_accounts a where a.business_id = p_business and a.plan = 'pro')
     and sehat_wa_addon_blocker(p_business) is null
     and coalesce((select case p_kind when 'welcome' then s.welcome when 'visit_summary' then s.visit_summary
                                      when 'thank_you' then s.thank_you when 'follow_up' then s.follow_up end
                     from wa_auto_settings s where s.business_id = p_business), true);
$$;
revoke all on function sehat_wa_auto_on(uuid, text) from public, anon, authenticated;

-- 9 pm to 8 am waits until 9 am.
create or replace function sehat_wa_auto_daytime(p_at timestamptz)
returns timestamptz
language sql immutable as $$
  select case
    when extract(hour from p_at at time zone 'Asia/Kolkata') >= 21
      then (((p_at at time zone 'Asia/Kolkata')::date + 1) + time '09:00') at time zone 'Asia/Kolkata'
    when extract(hour from p_at at time zone 'Asia/Kolkata') < 8
      then (((p_at at time zone 'Asia/Kolkata')::date) + time '09:00') at time zone 'Asia/Kolkata'
    else p_at end;
$$;

-- ── 3. The queue ────────────────────────────────────────────────────────────
create table if not exists wa_auto_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  kind text not null check (kind in ('welcome', 'visit_summary', 'thank_you', 'follow_up')),
  -- One of each kind per patient and day (or follow-up date): a token and an
  -- appointment for the same visit make one message, not two.
  ref_key text not null,
  ref_date date,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  channel text check (channel in ('whatsapp', 'push')),
  why text,
  wa_message_id text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, kind, ref_key)
);
create index if not exists wa_auto_messages_due_idx on wa_auto_messages (due_at) where status in ('pending', 'sending');
create index if not exists wa_auto_messages_business_idx on wa_auto_messages (business_id, created_at desc);
alter table wa_auto_messages enable row level security;
revoke all on wa_auto_messages from anon;
grant select on wa_auto_messages to authenticated;
drop policy if exists clinic_reads_auto_messages on wa_auto_messages;
create policy clinic_reads_auto_messages on wa_auto_messages for select to authenticated
  using (sehat_caller_owns_business(business_id) or sehat_is_admin());

create or replace function sehat_wa_auto_queue(p_business uuid, p_member uuid, p_kind text, p_ref_date date, p_due timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_business is null or p_member is null or not sehat_wa_auto_on(p_business, p_kind) then return; end if;
  insert into wa_auto_messages (business_id, patient_member_id, kind, ref_key, ref_date, due_at)
  values (p_business, p_member, p_kind,
          p_member::text || ':' || coalesce(p_ref_date::text, 'once'), p_ref_date, p_due)
  on conflict (business_id, kind, ref_key) do nothing;
exception when others then
  null;  -- a message must never stop the registration or the visit that caused it
end $$;
revoke all on function sehat_wa_auto_queue(uuid, uuid, text, date, timestamptz) from public, anon, authenticated;

-- ── 4. What puts messages in it ─────────────────────────────────────────────
-- A patient registered at the clinic. Not an import of old records.
create or replace function sehat_wa_auto_on_register()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source is distinct from 'import' then
    perform sehat_wa_auto_queue(new.business_id, new.patient_member_id, 'welcome', null, now() + interval '2 minutes');
  end if;
  return null;
end $$;
drop trigger if exists wa_auto_on_register on business_patients;
create trigger wa_auto_on_register after insert on business_patients
  for each row execute function sehat_wa_auto_on_register();

-- The consultation is over: the prescription and bill shortly (time to finish
-- writing them), the thank-you a couple of hours later.
create or replace function sehat_wa_auto_after_visit(p_business uuid, p_member uuid, p_day date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_after integer := coalesce((select thank_you_after_minutes from wa_auto_settings where business_id = p_business), 120);
begin
  perform sehat_wa_auto_queue(p_business, p_member, 'visit_summary', p_day, now() + interval '15 minutes');
  perform sehat_wa_auto_queue(p_business, p_member, 'thank_you', p_day, sehat_wa_auto_daytime(now() + make_interval(mins => v_after)));
end $$;
revoke all on function sehat_wa_auto_after_visit(uuid, uuid, date) from public, anon, authenticated;

create or replace function sehat_wa_auto_on_token_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform sehat_wa_auto_after_visit(new.business_id, new.patient_member_id, new.queue_date);
  end if;
  return null;
end $$;
drop trigger if exists wa_auto_on_token_done on opd_queue;
create trigger wa_auto_on_token_done after update of status on opd_queue
  for each row execute function sehat_wa_auto_on_token_done();

create or replace function sehat_wa_auto_on_appointment_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.patient_member_id is not null then
    perform sehat_wa_auto_after_visit(new.business_id, new.patient_member_id, (new.slot_datetime at time zone 'Asia/Kolkata')::date);
  end if;
  return null;
end $$;
drop trigger if exists wa_auto_on_appointment_done on appointments;
create trigger wa_auto_on_appointment_done after update of status on appointments
  for each row execute function sehat_wa_auto_on_appointment_done();

-- Every morning: tomorrow's follow-ups, from prescriptions and visit notes.
create or replace function sehat_wa_auto_queue_follow_ups()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_tomorrow date := (now() at time zone 'Asia/Kolkata')::date + 1;
  v_due timestamptz := sehat_wa_auto_daytime(greatest(now(), (((now() at time zone 'Asia/Kolkata')::date) + time '10:00') at time zone 'Asia/Kolkata'));
  v_before integer := (select count(*) from wa_auto_messages where kind = 'follow_up');
  r record;
begin
  for r in
    select distinct business_id, patient_member_id from (
      select p.business_id, p.patient_member_id from prescriptions p
       where p.follow_up_date = v_tomorrow and p.status = 'issued'
      union
      select v.business_id, v.patient_member_id from patient_visits v
       where v.follow_up_due = v_tomorrow and v.business_id is not null and v.patient_member_id is not null) x
  loop
    perform sehat_wa_auto_queue(r.business_id, r.patient_member_id, 'follow_up', v_tomorrow, v_due);
  end loop;
  return (select count(*) from wa_auto_messages where kind = 'follow_up') - v_before;
end $$;
revoke all on function sehat_wa_auto_queue_follow_ups() from public, anon, authenticated;

-- ── 5. Sending: claim what is due, with its words ───────────────────────────
-- Called by wa-auto-send (service role). Every check is repeated here, at the
-- moment of sending: the plan may have lapsed, the clinic may have switched
-- the message off, the patient may have said STOP. A patient with the app gets
-- the app notification right here, and is not returned for WhatsApp.
--
-- Returns, per message for WhatsApp:
--   { id, kind, business_id, phone, name, clinic, campaign, params:[…],
--     rx_id, bill_id, ask_id, link_kind }
-- where params still hold "rx:<token>", "bill:<token>" and "app" for the
-- edge function to turn into full links (it knows the site's address).
create or replace function sehat_wa_auto_claim(p_limit integer default 50)
returns setof jsonb
language plpgsql security definer set search_path = public as $$
declare
  m wa_auto_messages;
  v_phone text;
  v_name text;
  v_first text;
  v_clinic text;
  v_mrn text;
  v_uid uuid;
  v_rx prescriptions;
  v_bill patient_bills;
  v_doc text;
  v_ask uuid;
  v_title text;
  v_body text;
  v_pushed integer;
  v_skip text;
begin
  for m in
    select * from wa_auto_messages
     where (status = 'pending' and due_at <= now())
        or (status = 'sending' and claimed_at < now() - interval '15 minutes' and attempts < 3)
     order by due_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  loop
    v_skip := null; v_rx := null; v_bill := null; v_doc := null; v_ask := null;
    select sehat_normalise_phone(pa.phone), pm.full_name into v_phone, v_name
      from patient_members pm join patients pa on pa.id = pm.patient_id where pm.id = m.patient_member_id;
    v_first := nullif(split_part(btrim(coalesce(v_name, '')), ' ', 1), '');
    select b.name into v_clinic from businesses b where b.id = m.business_id;

    if not sehat_wa_auto_on(m.business_id, m.kind) then v_skip := 'switched off, or the plan is not active';
    elsif v_phone is null then v_skip := 'no mobile number';
    elsif exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(v_phone)) then v_skip := 'the patient said STOP';
    end if;

    if v_skip is null and m.kind = 'welcome' then
      select bp.mrn into v_mrn from business_patients bp where bp.business_id = m.business_id and bp.patient_member_id = m.patient_member_id;

    elsif v_skip is null and m.kind = 'visit_summary' then
      select * into v_rx from prescriptions p
       where p.business_id = m.business_id and p.patient_member_id = m.patient_member_id and p.status = 'issued'
         and (p.issued_at at time zone 'Asia/Kolkata')::date = m.ref_date
         and not ('whatsapp' = any(coalesce(p.sent_channels, '{}')))
       order by p.issued_at desc limit 1;
      select * into v_bill from patient_bills b
       where b.business_id = m.business_id and b.patient_member_id = m.patient_member_id and b.status = 'issued'
         and (b.issued_at at time zone 'Asia/Kolkata')::date = m.ref_date
         and not ('whatsapp' = any(coalesce(b.sent_channels, '{}')))
       order by b.issued_at desc limit 1;
      if v_rx.id is null and v_bill.id is null then v_skip := 'no prescription or bill to send (or already sent)'; end if;

    elsif v_skip is null and m.kind = 'thank_you' then
      if exists (select 1 from rating_asks a where a.business_id = m.business_id and a.phone = v_phone
                    and a.status in ('pending', 'sent', 'rated') and a.created_at > now() - interval '30 days') then
        v_skip := 'already asked in the last 30 days';
      elsif exists (select 1 from ratings r where r.business_id = m.business_id and r.patient_phone_hash = sehat_phone_hash(v_phone)
                       and r.created_at > now() - interval '30 days') then
        v_skip := 'already rated in the last 30 days';
      end if;
      v_doc := coalesce(
        (select p.full_name from opd_queue q join practitioners p on p.id = q.practitioner_id
          where q.business_id = m.business_id and q.patient_member_id = m.patient_member_id and q.queue_date = m.ref_date
          order by q.completed_at desc nulls last limit 1),
        (select p.full_name from appointments a join practitioners p on p.id = a.practitioner_id
          where a.business_id = m.business_id and a.patient_member_id = m.patient_member_id
            and (a.slot_datetime at time zone 'Asia/Kolkata')::date = m.ref_date limit 1),
        v_clinic);

    elsif v_skip is null and m.kind = 'follow_up' then
      v_doc := coalesce(
        (select p.prescriber_name from prescriptions p where p.business_id = m.business_id and p.patient_member_id = m.patient_member_id
            and p.follow_up_date = m.ref_date and p.status = 'issued' order by p.issued_at desc limit 1),
        (select pr.full_name from patient_visits v join practitioners pr on pr.id = v.practitioner_id
          where v.business_id = m.business_id and v.patient_member_id = m.patient_member_id and v.follow_up_due = m.ref_date limit 1),
        'The doctor');
    end if;

    if v_skip is not null then
      update wa_auto_messages set status = 'skipped', why = v_skip where id = m.id;
      continue;
    end if;

    -- The app first: free, and it is where the record lives.
    select a.auth_uid into v_uid from patient_app_accounts a where a.phone = v_phone;
    if v_uid is not null then
      v_title := v_clinic;
      v_body := case m.kind
        when 'welcome' then 'You are registered' || coalesce(' — file number ' || v_mrn, '') || '. Your records from here will appear in the app.'
        when 'visit_summary' then concat_ws(' and ', case when v_rx.id is not null then 'Your prescription' end,
                                             case when v_bill.id is not null then case when v_rx.id is null then 'Your bill' else 'bill' end end) || ' from today are in the app.'
        when 'thank_you' then 'How was your visit? Rate it in one tap.'
        else coalesce(v_doc, 'The doctor') || ' asked to see you again tomorrow (' || to_char(m.ref_date, 'Dy DD Mon') || '). Book a time in the app.'
      end;
      v_pushed := sehat_queue_push(case when m.kind = 'thank_you' then 'review' else 'clinic' end, m.business_id, array[v_uid], v_title, v_body,
        jsonb_build_object('kind', case when m.kind = 'thank_you' then 'review' else m.kind end, 'business_id', m.business_id,
                           'what', 'visit', 'rx', v_rx.id, 'bill', v_bill.id));
      if v_pushed > 0 then
        update wa_auto_messages set status = 'sent', channel = 'push', sent_at = now(), attempts = attempts + 1, claimed_at = now() where id = m.id;
        continue;
      end if;
    end if;

    if m.kind = 'thank_you' then
      insert into rating_asks (business_id, patient_member_id, practitioner_id, phone, visit_on, asked_by, asked_by_name)
      values (m.business_id, m.patient_member_id,
              (select q.practitioner_id from opd_queue q where q.business_id = m.business_id and q.patient_member_id = m.patient_member_id
                  and q.queue_date = m.ref_date order by q.completed_at desc nulls last limit 1),
              v_phone, m.ref_date, null, 'Automatic (WhatsApp Pro)')
      returning id into v_ask;
    end if;

    update wa_auto_messages set status = 'sending', attempts = attempts + 1, claimed_at = now() where id = m.id;

    return next jsonb_build_object(
      'id', m.id, 'kind', m.kind, 'business_id', m.business_id, 'phone', v_phone,
      'name', coalesce(v_first, 'Patient'), 'clinic', v_clinic,
      'campaign', case m.kind
        when 'welcome' then 'AISENSY_WELCOME_CAMPAIGN'
        when 'visit_summary' then case when v_rx.id is not null and v_bill.id is not null then 'AISENSY_VISIT_SUMMARY_CAMPAIGN'
                                       when v_rx.id is not null then 'AISENSY_PRESCRIPTION_CAMPAIGN' else 'AISENSY_BILL_CAMPAIGN' end
        when 'thank_you' then 'AISENSY_RATING_CAMPAIGN'
        else 'AISENSY_FOLLOW_UP_CAMPAIGN' end,
      'params', case m.kind
        when 'welcome' then jsonb_build_array(coalesce(v_name, 'Patient'), v_clinic, coalesce(v_mrn, '—'), 'app')
        when 'visit_summary' then case when v_rx.id is not null and v_bill.id is not null
                                         then jsonb_build_array(coalesce(v_name, 'Patient'), v_clinic, 'rx:' || v_rx.public_token, 'bill:' || v_bill.public_token)
                                       when v_rx.id is not null then jsonb_build_array(coalesce(v_name, 'Patient'), v_clinic, 'rx:' || v_rx.public_token)
                                       else jsonb_build_array(coalesce(v_name, 'Patient'), v_clinic, 'bill:' || v_bill.public_token) end
        when 'thank_you' then jsonb_build_array(coalesce(v_first, 'जी'), v_doc, bot_hi_date(m.ref_date))
        else jsonb_build_array(coalesce(v_name, 'Patient'), v_doc, v_clinic, to_char(m.ref_date, 'Dy DD Mon')) end,
      'rx_id', v_rx.id, 'bill_id', v_bill.id, 'ask_id', v_ask);
  end loop;
end $$;
revoke all on function sehat_wa_auto_claim(integer) from public, anon, authenticated;
grant execute on function sehat_wa_auto_claim(integer) to service_role;

-- What became of one. A send that may succeed on a second go (Meta busy) goes
-- back in the queue for ten minutes, up to three tries.
create or replace function sehat_wa_auto_done(p_id uuid, p_ok boolean, p_message_id text default null,
                                              p_error text default null, p_retry boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare
  m wa_auto_messages;
begin
  select * into m from wa_auto_messages where id = p_id;
  if m.id is null then return; end if;
  if p_ok then
    update wa_auto_messages set status = 'sent', channel = 'whatsapp', sent_at = now(), why = null,
           wa_message_id = nullif(p_message_id, '') where id = p_id;
  elsif p_retry and m.attempts < 3 then
    update wa_auto_messages set status = 'pending', due_at = now() + interval '10 minutes', why = left(p_error, 300) where id = p_id;
  else
    update wa_auto_messages set status = 'failed', why = left(p_error, 300) where id = p_id;
  end if;
end $$;
revoke all on function sehat_wa_auto_done(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function sehat_wa_auto_done(uuid, boolean, text, text, boolean) to service_role;

-- A prescription or bill that went out in the visit summary counts as sent.
create or replace function sehat_wa_auto_mark_documents(p_rx uuid, p_bill uuid)
returns void
language sql security definer set search_path = public as $$
  update prescriptions set sent_at = now(), sent_channels = array(select distinct unnest(coalesce(sent_channels, '{}') || array['whatsapp'])), send_error = null
   where id = p_rx;
  update patient_bills set sent_at = now(), sent_channels = array(select distinct unnest(coalesce(sent_channels, '{}') || array['whatsapp'])), send_error = null
   where id = p_bill;
$$;
revoke all on function sehat_wa_auto_mark_documents(uuid, uuid) from public, anon, authenticated;
grant execute on function sehat_wa_auto_mark_documents(uuid, uuid) to service_role;

-- ── 6. What the clinic sees ─────────────────────────────────────────────────
-- This month, per kind: sent on WhatsApp, sent in the app, skipped, failed; and the last 30.
create or replace function sehat_wa_auto_overview(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not sehat_caller_owns_business(p_business) and not sehat_is_admin() then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'month', (select coalesce(jsonb_object_agg(kind, c), '{}'::jsonb) from (
      select kind, jsonb_build_object(
        'whatsapp', count(*) filter (where status = 'sent' and channel = 'whatsapp'),
        'app', count(*) filter (where status = 'sent' and channel = 'push'),
        'skipped', count(*) filter (where status = 'skipped'),
        'failed', count(*) filter (where status = 'failed'),
        'waiting', count(*) filter (where status in ('pending', 'sending'))) c
        from wa_auto_messages where business_id = p_business and created_at >= v_month group by kind) k),
    'recent', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
      select m.kind, m.status, m.channel, m.why, m.due_at, m.sent_at, m.created_at,
             split_part(btrim(pm.full_name), ' ', 1) as name
        from wa_auto_messages m join patient_members pm on pm.id = m.patient_member_id
       where m.business_id = p_business order by m.created_at desc limit 30) r));
end $$;
revoke all on function sehat_wa_auto_overview(uuid) from public, anon;
grant execute on function sehat_wa_auto_overview(uuid) to authenticated;

-- ── 7. The schedule ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('wa-auto-send', 'wa-auto-follow-ups');
  perform cron.schedule('wa-auto-send', '*/2 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/wa-auto-send',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
    where exists (select 1 from wa_auto_messages where status = 'pending' and due_at <= now())
  $job$);
  -- 04:30 UTC is 10:00 in India.
  perform cron.schedule('wa-auto-follow-ups', '30 4 * * *', $job$ select sehat_wa_auto_queue_follow_ups() $job$);
end $$;
