-- ============================================================================
-- 0323 — International: alerts for new requests and status changes
-- ============================================================================
-- AFTER 0322. Safe to re-run.
--
-- Asked 4 Nov 2026. Until now a patient's request only appeared in Admin, and
-- a patient heard nothing when their request moved on.
--
--   New request (intl_enquiries insert):
--     • an email to Sehatsandhi straight away (email-send 'intl_notice'),
--     • a WhatsApp to each team number in site_settings 'intl_alert_numbers'
--       (comma-separated, with country code; default 918708718705), with the
--       house template intl_team_new_request.
--   Status change (intl_enquiries.status, except to 'new'):
--     • a WhatsApp to the patient (template intl_request_update) and
--     • an email to the patient if they gave one,
--     both with their tracking link.
--
--   intl_alerts      the WhatsApp queue: one row per message. The
--                    intl-alerts function (every 2 minutes) sends pending ones
--                    and retries a failure up to 6 times over about a day —
--                    so messages wait while Meta reviews a new template.
-- Emails go through email_outbox as before.
-- ============================================================================

insert into site_settings (key, value) values ('intl_alert_numbers', '918708718705')
on conflict (key) do nothing;

create table if not exists intl_alerts (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references intl_enquiries(id) on delete cascade,
  kind text not null check (kind in ('team_new', 'patient_status')),
  to_phone text not null,
  status_at text,
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  next_try_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists intl_alerts_due_idx on intl_alerts (next_try_at) where state = 'pending';
create index if not exists intl_alerts_enquiry_idx on intl_alerts (enquiry_id, created_at);

alter table intl_alerts enable row level security;
drop policy if exists intl_alerts_read on intl_alerts;
create policy intl_alerts_read on intl_alerts for select to authenticated using (sehat_is_admin() or sehat_is_staff());
revoke all on intl_alerts from anon;
revoke insert, update, delete on intl_alerts from authenticated;
grant select on intl_alerts to authenticated;

-- The sentence the patient gets for each step.
create or replace function sehat_intl_status_text(p_status text)
returns text language sql immutable as $$
  select case p_status
    when 'reports' then 'Your reports are now with the doctors at the hospitals you chose. We will share their opinions and quotes soon.'
    when 'quotes' then 'Your written quotes are ready. Your coordinator will go through them with you so you can choose.'
    when 'visa' then 'Your hospital is preparing your e-Medical visa invitation letter.'
    when 'travel' then 'Your travel is booked. Airport pickup and your stay are arranged.'
    when 'arrived' then 'Welcome to India. Your coordinator will meet you and take you to the hospital.'
    when 'discharged' then 'You have been discharged. Please keep your discharge summary, reports and fit-to-fly note safe.'
    when 'followup' then 'Your online follow-ups with your doctor are booked.'
    when 'closed' then 'Your request is complete. Thank you for trusting Sehatsandhi.'
    when 'cancelled' then 'Your request has been closed. Message us any time if you need help again.'
    else null end
$$;

create or replace function sehat_intl_enquiry_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_num text; v_proc text; v_text text;
begin
  if tg_op = 'INSERT' then
    select name into v_proc from intl_procedures where code = new.procedure_code;
    for v_num in
      select regexp_replace(btrim(x), '[^0-9]', '', 'g')
        from unnest(string_to_array(coalesce((select value from site_settings where key = 'intl_alert_numbers'), ''), ',')) x
       where length(regexp_replace(btrim(x), '[^0-9]', '', 'g')) >= 10
    loop
      insert into intl_alerts (enquiry_id, kind, to_phone) values (new.id, 'team_new', v_num);
    end loop;
    insert into email_outbox (kind, business_id, payload)
    values ('intl_notice', null, jsonb_build_object('to', 'admin',
      'subject', 'New international request — ' || new.name || coalesce(' (' || new.country || ')', ''),
      'lines', jsonb_build_array(
        new.name || coalesce(' from ' || new.country, '') || ' asked for ' || coalesce(v_proc, 'help (not sure of the treatment)') || '.',
        coalesce('WhatsApp: ' || new.phone, '') || coalesce('  Email: ' || new.email, ''),
        coalesce('They wrote: ' || left(new.problem, 600), ''),
        case when cardinality(new.shortlist) > 0 then 'Shortlisted ' || cardinality(new.shortlist) || ' hospital(s).' else '' end,
        case when new.legal_ack then 'Legal notes for this treatment were accepted.' else '' end,
        'Please reply within 24 hours: Admin → International → Patient requests.')));
    return new;
  end if;

  if new.status is distinct from old.status and new.status <> 'new' then
    v_text := sehat_intl_status_text(new.status);
    if v_text is null then return new; end if;
    if length(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g')) >= 8 then
      insert into intl_alerts (enquiry_id, kind, to_phone, status_at)
      values (new.id, 'patient_status', regexp_replace(new.phone, '[^0-9]', '', 'g'), new.status);
    end if;
    if new.email is not null then
      insert into email_outbox (kind, business_id, payload)
      values ('intl_notice', null, jsonb_build_object('to', 'patient', 'email', new.email, 'name', new.name, 'token', new.token,
        'subject', 'An update on your request — Sehatsandhi International',
        'lines', jsonb_build_array('Hello ' || split_part(new.name, ' ', 1) || ',', v_text,
                                   'Reply to this email or message us on WhatsApp (+91 87087 18705) if you need any help.')));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists intl_enquiry_alerts on intl_enquiries;
create trigger intl_enquiry_alerts after insert or update of status on intl_enquiries
  for each row execute function sehat_intl_enquiry_alerts();

-- The admin's alert numbers, editable with the fee and exchange rates.
-- Called with null: returns the current list without changing it.
drop function if exists sehat_intl_admin_alert_numbers(text);
create or replace function sehat_intl_admin_alert_numbers(p_numbers text default null)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_numbers is not null then
    insert into site_settings (key, value) values ('intl_alert_numbers',
      coalesce((select string_agg(n, ',') from (select regexp_replace(btrim(x), '[^0-9]', '', 'g') n
                  from unnest(string_to_array(p_numbers, ',')) x) y where length(n) >= 10), ''))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return (select value from site_settings where key = 'intl_alert_numbers');
end $$;
revoke all on function sehat_intl_admin_alert_numbers(text) from public, anon;
grant execute on function sehat_intl_admin_alert_numbers(text) to authenticated;

-- Every 2 minutes: send the pending WhatsApp alerts.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'intl-alerts';
  perform cron.schedule('intl-alerts', '*/2 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/intl-alerts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 60000)
    where exists (select 1 from intl_alerts where state = 'pending' and next_try_at <= now())
  $job$);
end $$;

notify pgrst, 'reload schema';
