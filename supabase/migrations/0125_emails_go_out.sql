-- ============================================================================
-- Sehatsandhi — a business that registers hears from us, and so does admin
--
-- Run AFTER 0124. Safe to re-run.
--
-- Until now a registration sent nothing to anybody: the business got no
-- confirmation, and admin found out only by opening the Pending tab. This adds
-- an email queue and fills it from a trigger:
--
--   business_welcome     to the business's own address — what happens next and
--                        how to log in. Skipped when they gave no email.
--   admin_new_business   to admin@sehatsandhi.com — who registered, where, and
--                        what they chose.
--
-- The email-send function drains the queue every two minutes. It sends from
-- no-reply@sehatsandhi.com through ZeptoMail, with replies going to
-- contact@sehatsandhi.com; the addresses live in the function, not here.
--
-- ── WHY A QUEUE, NOT A CALL FROM THE BROWSER ────────────────────────────────
-- Registration happens before anybody is logged in, so a browser call would be
-- an open endpoint that mails whatever it is pointed at. The trigger fires on
-- the insert itself — including a listing admin creates — and cannot be skipped
-- by a page that closes early.
--
-- ── WHY A ROW WAITS A MINUTE ────────────────────────────────────────────────
-- The listing is inserted first; its doctors and plan choice are written just
-- after. The function reads the business fresh at send time, and only picks up
-- rows at least a minute old, so the email describes the finished registration.
--
-- The key is resolved from Vault at run time, as in 0075; nothing secret here.
-- ============================================================================

create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  business_id uuid references businesses(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

do $$ begin
  alter table email_outbox add constraint email_outbox_kind_check
    check (kind in ('business_welcome', 'admin_new_business'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table email_outbox add constraint email_outbox_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
exception when duplicate_object then null; end $$;

create index if not exists email_outbox_pending_idx
  on email_outbox (created_at) where status = 'pending';

-- One welcome and one alert per listing, however often the trigger is replayed.
create unique index if not exists email_outbox_once_idx
  on email_outbox (kind, business_id);

alter table email_outbox enable row level security;

drop policy if exists email_outbox_admin_read on email_outbox;
create policy email_outbox_admin_read on email_outbox
  for select to authenticated using (sehat_is_admin());

revoke all on email_outbox from anon;


create or replace function sehat_queue_registration_emails()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(new.email, '')), '') is not null then
    insert into email_outbox (kind, business_id)
    values ('business_welcome', new.id)
    on conflict do nothing;
  end if;
  insert into email_outbox (kind, business_id)
  values ('admin_new_business', new.id)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists businesses_queue_registration_emails on businesses;
create trigger businesses_queue_registration_emails
  after insert on businesses
  for each row execute function sehat_queue_registration_emails();


-- ── The drain ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; drain-email-outbox not scheduled';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'drain-email-outbox';
  perform cron.schedule(
    'drain-email-outbox',
    '*/2 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/email-send',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
    where exists (select 1 from public.email_outbox where status = 'pending')
    $job$
  );
  raise notice 'scheduled drain-email-outbox (every 2 minutes, only when something is queued)';
end $$;

notify pgrst, 'reload schema';
