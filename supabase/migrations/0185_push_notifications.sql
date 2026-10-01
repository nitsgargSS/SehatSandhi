-- ============================================================================
-- Sehatsandhi — push notifications to the business app
--
-- Run AFTER 0184. Safe to re-run.
--
-- Decided 1 Oct 2026: the app tells staff what they would otherwise learn from
-- a WhatsApp message we pay for, or by looking at a screen —
--   • a token is given        → the token's doctor ("New patient in your queue")
--   • an appointment is booked → the doctor, and the clinic's owner
-- Sent through Expo's push service (free). Nothing about the patient beyond a
-- first-line name and the reason goes in the notification.
--
--   push_devices   one row per phone (Expo push token), owned by the login.
--                  The app registers on sign-in and removes it on sign-out.
--   push_outbox    what to send, to whom. Written by triggers; push-send (edge
--                  function) delivers it at once (pg_net, fired by the trigger)
--                  and a one-minute job retries anything left.
-- ============================================================================

-- ── Devices ─────────────────────────────────────────────────────────────────
create table if not exists push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null unique,
  platform text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on push_devices (user_id) where enabled;
alter table push_devices enable row level security;
revoke all on push_devices from anon, authenticated;
grant select on push_devices to authenticated;
drop policy if exists "own_push_devices" on push_devices;
create policy "own_push_devices" on push_devices for select using (user_id = auth.uid());

-- A phone signs in as one login at a time: re-registering moves the token.
create or replace function sehat_register_push_device(p_token text, p_platform text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if coalesce(p_token, '') !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'Not an Expo push token.' using errcode = 'P0001';
  end if;
  insert into push_devices (user_id, token, platform)
  values (auth.uid(), p_token, left(p_platform, 20))
  on conflict (token) do update
    set user_id = auth.uid(), platform = excluded.platform, enabled = true, last_seen_at = now();
end $$;
revoke all on function sehat_register_push_device(text, text) from public, anon;
grant execute on function sehat_register_push_device(text, text) to authenticated;

create or replace function sehat_unregister_push_device(p_token text)
returns void language sql volatile security definer set search_path = public as $$
  delete from push_devices where token = p_token and user_id = auth.uid();
$$;
revoke all on function sehat_unregister_push_device(text) from public, anon;
grant execute on function sehat_unregister_push_device(text) to authenticated;

-- ── Outbox ──────────────────────────────────────────────────────────────────
create table if not exists push_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists push_outbox_pending_idx on push_outbox (created_at) where status = 'pending';
alter table push_outbox enable row level security;
revoke all on push_outbox from anon, authenticated;

-- Ask push-send to deliver now. Best effort: no pg_net or no vault secrets just
-- means the one-minute job picks it up.
create or replace function sehat_kick_push()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push-send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'),
    body := '{}'::jsonb);
exception when others then null;
end $$;
revoke all on function sehat_kick_push() from public, anon, authenticated;

-- Queue one message for each login among the given people that has a phone
-- registered. Practitioners are reached through their login (auth_uid).
create or replace function sehat_queue_push(
  p_kind text, p_business uuid, p_users uuid[], p_title text, p_body text, p_data jsonb
) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into push_outbox (kind, business_id, user_id, title, body, data)
  select p_kind, p_business, u, left(p_title, 120), left(p_body, 240), coalesce(p_data, '{}'::jsonb)
    from (select distinct unnest(p_users) u) x
   where u is not null and exists (select 1 from push_devices d where d.user_id = u and d.enabled);
  get diagnostics n = row_count;
  if n > 0 then perform sehat_kick_push(); end if;
  return n;
end $$;
revoke all on function sehat_queue_push(text, uuid, uuid[], text, text, jsonb) from public, anon, authenticated;

-- ── Triggers ────────────────────────────────────────────────────────────────
-- A token: its doctor; with no doctor on it, the clinic's owner.
create or replace function sehat_push_on_token()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_owner uuid; v_name text;
begin
  select p.auth_uid into v_doc from practitioners p where p.id = new.practitioner_id;
  select b.auth_uid into v_owner from businesses b where b.id = new.business_id;
  select split_part(m.full_name, ' ', 1) || coalesce(' ' || nullif(split_part(m.full_name, ' ', 2), ''), '')
    into v_name from patient_members m where m.id = new.patient_member_id;
  perform sehat_queue_push('queue', new.business_id,
    array[coalesce(v_doc, v_owner)],
    'New patient in your queue',
    '#' || new.token_number || ' ' || coalesce(v_name, 'Patient') || coalesce(' — ' || nullif(btrim(new.reason), ''), ''),
    jsonb_build_object('kind', 'queue', 'queue_id', new.id));
  return null;
exception when others then return null;   -- a notification must never block a token
end $$;
drop trigger if exists push_on_token on opd_queue;
create trigger push_on_token after insert on opd_queue
  for each row execute function sehat_push_on_token();

-- An appointment: the doctor and the owner (once, if they are the same person).
create or replace function sehat_push_on_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_owner uuid; v_when text;
begin
  if new.business_id is null then return null; end if;
  select p.auth_uid into v_doc from practitioners p where p.id = new.practitioner_id;
  select b.auth_uid into v_owner from businesses b where b.id = new.business_id;
  v_when := to_char(new.slot_datetime at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM');
  perform sehat_queue_push('appointment', new.business_id, array[v_doc, v_owner],
    'New appointment',
    coalesce(split_part(new.patient_name, ' ', 1), 'A patient') || ' · ' || coalesce(v_when, '')
      || case when new.booked_via is not null and new.booked_via <> 'desk' then ' · via ' || new.booked_via else '' end,
    jsonb_build_object('kind', 'appointment', 'appointment_id', new.id));
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_on_appointment on appointments;
create trigger push_on_appointment after insert on appointments
  for each row execute function sehat_push_on_appointment();

-- ── The one-minute retry ────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; drain-push-outbox not scheduled';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'drain-push-outbox';
  perform cron.schedule(
    'drain-push-outbox',
    '* * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/push-send',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
    where exists (select 1 from public.push_outbox where status = 'pending')
    $job$
  );
end $$;

notify pgrst, 'reload schema';
