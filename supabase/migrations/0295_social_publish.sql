-- ============================================================================
-- 0295 — Social posts go to the business's Facebook Page and Instagram
-- ============================================================================
-- AFTER 0294. Safe to re-run.
--
-- Stages 2 and 3 of the build plan, decided 29 Oct 2026 with SN Eye as the
-- pilot:
--
--   CONNECT   the owner presses "Connect Facebook" once. Meta's window lets
--             them pick their Page (and the Instagram account linked to it);
--             social-connect keeps the Page's access key in the Vault.
--   PREVIEW   7 PM IST: tomorrow's post goes to the owner on WhatsApp (image
--             plus OK / Change / Skip), and to the app as a push.
--   PUBLISH   10 AM IST: the day's post goes to the Page and to Instagram.
--
-- Who has to say OK (social_settings.approval):
--   'preview'  the default. The first 7 posts need OK; after that a post the
--              owner does not answer goes out by itself.
--   'ask'      every post needs OK.
--   'auto'     no preview; every post goes out.
-- A post asked for by the owner (their own topic) always needs OK.
--
-- Meta's rule until App Review passes: only people with a role on our Meta
-- app can connect. SN Eye's Page is the user's own, so the pilot runs now.
-- ============================================================================

-- ── The connected Page ──────────────────────────────────────────────────────
create table if not exists social_accounts (
  business_id uuid primary key references businesses(id) on delete cascade,
  page_id text not null,
  page_name text not null,
  -- The Instagram professional account linked to the Page, when there is one.
  ig_user_id text,
  ig_username text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  -- The last thing Meta refused (an expired key, a removed permission).
  last_error text,
  updated_at timestamptz not null default now()
);
alter table social_accounts enable row level security;
grant select on social_accounts to authenticated;
revoke all on social_accounts from anon;
drop policy if exists social_accounts_read on social_accounts;
create policy social_accounts_read on social_accounts for select
  using (sehat_caller_is_owner(business_id) or sehat_is_admin());

-- The keys, one secret per business: the Page's (never expires) and, between
-- the two steps of connecting, the owner's own (to list their Pages).
create or replace function sehat_social_token_set(p_business uuid, p_kind text, p_token text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := 'social_' || p_kind || '_token_' || p_business;
  v_id uuid;
begin
  if p_kind not in ('page', 'user') then raise exception 'bad kind'; end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_token, v_name, 'Facebook access key for one business''s social posts (0295)');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end $$;
revoke all on function sehat_social_token_set(uuid, text, text) from public, anon, authenticated;
grant execute on function sehat_social_token_set(uuid, text, text) to service_role;

create or replace function sehat_social_token(p_business uuid, p_kind text)
returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'social_' || p_kind || '_token_' || p_business;
$$;
revoke all on function sehat_social_token(uuid, text) from public, anon, authenticated;
grant execute on function sehat_social_token(uuid, text) to service_role;

create or replace function sehat_social_token_drop(p_business uuid, p_kind text)
returns void
language sql security definer set search_path = public as $$
  delete from vault.secrets where name = 'social_' || p_kind || '_token_' || p_business;
$$;
revoke all on function sehat_social_token_drop(uuid, text) from public, anon, authenticated;
grant execute on function sehat_social_token_drop(uuid, text) to service_role;

-- ── Settings ────────────────────────────────────────────────────────────────
alter table social_settings add column if not exists approval text not null default 'preview';
alter table social_settings drop constraint if exists social_settings_approval_check;
alter table social_settings add constraint social_settings_approval_check check (approval in ('preview', 'ask', 'auto'));
-- Where the 7 PM preview goes. Empty = the owner's login phone, else the
-- business's phone.
alter table social_settings add column if not exists preview_phone text;
grant update (approval, preview_phone) on social_settings to authenticated;

-- ── Each post: the owner's answer, and what Meta did with it ────────────────
-- approval: null = not answered; 'ok'; 'skip' is status 'skipped' as before;
-- 'change' = the owner asked for something else and a remake is coming.
alter table social_posts add column if not exists approval text;
alter table social_posts drop constraint if exists social_posts_approval_check;
alter table social_posts add constraint social_posts_approval_check check (approval is null or approval in ('ok', 'change'));
alter table social_posts add column if not exists approved_at timestamptz;
-- The owner's own words for a remake ("Change"), kept for the record.
alter table social_posts add column if not exists owner_note text;
-- A post the owner asked for always waits for their OK.
alter table social_posts add column if not exists needs_ok boolean not null default false;
alter table social_posts add column if not exists preview_sent_at timestamptz;
-- The number the preview went to (91XXXXXXXXXX): only that number's buttons
-- and words count as the owner's answer.
alter table social_posts add column if not exists preview_to text;
alter table social_posts add column if not exists preview_error text;
alter table social_posts add column if not exists fb_post_id text;
alter table social_posts add column if not exists ig_media_id text;
alter table social_posts add column if not exists published_at timestamptz;
alter table social_posts add column if not exists publish_error text;

alter table social_posts drop constraint if exists social_posts_status_check;
alter table social_posts add constraint social_posts_status_check
  check (status in ('planned', 'ready', 'failed', 'skipped', 'published'));

-- The owner may answer from the app: OK, or skip (0292).
grant update (approval, approved_at) on social_posts to authenticated;
drop policy if exists social_posts_owner_skips on social_posts;
create policy social_posts_owner_skips on social_posts for update
  using ((sehat_caller_is_owner(business_id) or sehat_is_admin()) and status in ('ready', 'skipped'))
  with check (status in ('ready', 'skipped') and (approval is null or approval = 'ok'));

-- ── The two new daily runs ──────────────────────────────────────────────────
-- 7 PM IST = 13:30 UTC, the preview of tomorrow's post.
-- 10 AM IST = 04:30 UTC, today's post goes out.
do $$
declare
  j record;
begin
  for j in select * from (values
    ('social-posts-preview', '30 13 * * *', '{"action":"preview"}'),
    ('social-posts-publish', '30 4 * * *', '{"action":"publish"}')) as t(name, sched, body)
  loop
    perform cron.unschedule(j.name) where exists (select 1 from cron.job where jobname = j.name);
    perform cron.schedule(j.name, j.sched, format($job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/social-posts',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
          'Content-Type', 'application/json'),
        body := %L::jsonb,
        timeout_milliseconds := 300000)
      where exists (select 1 from social_settings where enabled and not paused)
    $job$, j.body));
  end loop;
end $$;

notify pgrst, 'reload schema';
