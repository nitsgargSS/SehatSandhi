-- ============================================================================
-- 0344 — Treatment on EMI: automatic WhatsApp alerts
-- ============================================================================
-- AFTER 0330. Safe to re-run. Same pattern as International (0323).
--
-- Until now every party had to open Sehatsandhi to find out a case had moved,
-- and the patient's link went only by the hospital's "Send on WhatsApp" button.
-- Each step of a case is already written to finance_case_events; a trigger on
-- that table now queues the WhatsApp the step calls for:
--
--   created / confirmed (hospital)   → patient: the link to choose a lender
--   requested (patient)              → hospital: confirm the estimate
--   shared_with_lender (patient)     → that lender: a new case
--   offered / declined (lender)      → patient: status
--   sanctioned (lender)              → patient: status; hospital: confirm the
--                                      admission date (if not yet confirmed)
--   disbursed (lender)               → patient: status; hospital: check the
--                                      bank and mark the money received
--   admission_confirmed (hospital)   → each lender still on the case
--   withdrawn                        → the other side (patient ↔ hospital) and
--                                      the lenders that had the case
--   expired (system)                 → patient; the lenders that had the case
--   money_received (hospital)        → patient; the lender that paid
--
--   finance_alerts   the queue: one row per message. The finance-alerts
--                    function (every 2 minutes) writes the text from the case
--                    as it is then, sends it from the main number with the
--                    templates in _shared/financeTemplates.ts, and retries a
--                    failure up to 6 times over about a day (so messages wait
--                    while Meta reviews the templates).
--
-- Phones: the patient's on the case; a hospital's or lender's business phone.
-- Off production, finance-alerts only sends to the numbers in site_settings
-- 'finance_alert_test_numbers' and skips the rest — sandbox cases use real
-- hospitals' numbers (SN Eye) and must not message them.
-- ============================================================================

insert into site_settings (key, value) values ('finance_alert_test_numbers', '918708718705')
on conflict (key) do nothing;

create table if not exists finance_alerts (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references finance_cases(id) on delete cascade,
  event_id    bigint references finance_case_events(id) on delete set null,
  event       text not null,
  audience    text not null check (audience in ('patient', 'hospital', 'lender')),
  lender_id   uuid references businesses(id) on delete set null,
  to_phone    text not null,
  state       text not null default 'pending' check (state in ('pending', 'sent', 'failed', 'skipped')),
  attempts    integer not null default 0,
  error       text,
  next_try_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists finance_alerts_due_idx on finance_alerts (next_try_at) where state = 'pending';
create index if not exists finance_alerts_case_idx on finance_alerts (case_id, created_at);

alter table finance_alerts enable row level security;
drop policy if exists finance_alerts_read on finance_alerts;
create policy finance_alerts_read on finance_alerts for select to authenticated using (sehat_is_admin());
revoke all on finance_alerts from anon;
revoke insert, update, delete on finance_alerts from authenticated;
grant select on finance_alerts to authenticated;

-- Digits with country code; a bare 10-digit Indian number gets 91. Null when
-- there is nothing usable.
create or replace function sehat_finance_wa_number(p_phone text)
returns text language sql immutable as $$
  select case
    when length(d) = 10 then '91' || d
    when length(d) = 11 and d like '0%' then '91' || substr(d, 2)
    when length(d) between 11 and 15 then d
    else null end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') d) x
$$;

create or replace function sehat_finance_event_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
declare c finance_cases; v_hosp text; v_pat text; r record;
begin
  select * into c from finance_cases where id = new.case_id;
  if c.id is null then return new; end if;
  v_pat  := sehat_finance_wa_number(c.patient_phone);
  v_hosp := sehat_finance_wa_number((select phone from businesses where id = c.business_id));

  -- To the patient
  if new.event in ('created', 'confirmed', 'offered', 'sanctioned', 'declined', 'disbursed', 'expired', 'money_received')
     or (new.event = 'withdrawn' and new.actor <> 'patient') then
    if v_pat is not null then
      insert into finance_alerts (case_id, event_id, event, audience, lender_id, to_phone)
      values (c.id, new.id, new.event, 'patient', new.lender_id, v_pat);
    end if;
  end if;

  -- To the hospital
  if new.event in ('requested', 'disbursed')
     or (new.event = 'sanctioned' and c.admission_confirmed_at is null)
     or (new.event = 'withdrawn' and new.actor <> 'hospital') then
    if v_hosp is not null then
      insert into finance_alerts (case_id, event_id, event, audience, lender_id, to_phone)
      values (c.id, new.id, new.event, 'hospital', new.lender_id, v_hosp);
    end if;
  end if;

  -- To lenders
  for r in
    select l.lender_id, sehat_finance_wa_number(b.phone) phone
      from finance_case_lenders l join businesses b on b.id = l.lender_id
     where l.case_id = c.id
       and case new.event
             when 'shared_with_lender'  then l.lender_id = new.lender_id
             when 'money_received'      then l.lender_id = new.lender_id
             when 'admission_confirmed' then l.status in ('shared', 'offered', 'sanctioned')
             -- withdraw and expiry set the lenders still on the case to 'withdrawn' first
             when 'withdrawn'           then l.status = 'withdrawn'
             when 'expired'             then l.status = 'withdrawn'
             else false end
  loop
    if r.phone is not null then
      insert into finance_alerts (case_id, event_id, event, audience, lender_id, to_phone)
      values (c.id, new.id, new.event, 'lender', r.lender_id, r.phone);
    end if;
  end loop;
  return new;
exception when others then
  -- An alert must never stop the step itself from being saved.
  raise warning 'finance alert not queued for case % (%): %', new.case_id, new.event, sqlerrm;
  return new;
end $$;

drop trigger if exists finance_event_alerts on finance_case_events;
create trigger finance_event_alerts after insert on finance_case_events
  for each row execute function sehat_finance_event_alerts();

-- Every 2 minutes: send the pending alerts.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'finance-alerts';
  perform cron.schedule('finance-alerts', '*/2 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/finance-alerts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 60000)
    where exists (select 1 from finance_alerts where state = 'pending' and next_try_at <= now())
  $job$);
end $$;

notify pgrst, 'reload schema';
