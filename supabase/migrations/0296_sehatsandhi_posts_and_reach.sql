-- ============================================================================
-- 0296 — Sehatsandhi's own daily posts, and posts that reach more people
-- ============================================================================
-- AFTER 0295. Safe to re-run.
--
-- Asked for 29 Oct 2026:
--
-- 1. SEHATSANDHI POSTS. Sehatsandhi posts every day too (Hindi and English,
--    taking turns), for doctors, clinic and hospital owners: what the
--    software does and the everyday problems it solves. It is a business row
--    of its own so the whole posts machine (topics, words, image, preview,
--    Facebook, Instagram) works unchanged; it is run from Admin, never from a
--    clinic dashboard. Status 'pending' keeps it out of every listing, the
--    bot and search (they all want 'active'). Creating it queues an "admin new
--    business" email and a partner credit, both removed here: no partner
--    signed Sehatsandhi up.
--
--      social_settings.audience  'patients' (clinics, as before) or 'doctors'
--      social_settings.profile   what the post shows when the business has no
--                                website of its own: name, phone, website,
--                                logo, colour, city, tagline
--
-- 2. REACH. Every post also goes to Facebook and Instagram Stories, and
--    Instagram gets it at 7:30 PM, when people in India are on it most;
--    Facebook stays at 10 AM. (The words — hashtag mix, an easy question to
--    answer — are the writer's rules in social-posts.)
-- ============================================================================

-- ── Sehatsandhi as a business, for its posts only ──────────────────────────
insert into businesses (id, name, status)
values ('5e4a75a0-0000-4000-8000-000000000001', 'Sehatsandhi (social posts only — never approve)', 'pending')
on conflict (id) do update set name = excluded.name;

-- It shows in Admin's Pending list. Approving it would list Sehatsandhi as a
-- clinic, so it stays pending whatever is pressed.
create or replace function sehat_house_stays_pending()
returns trigger language plpgsql as $$
begin
  if new.id = '5e4a75a0-0000-4000-8000-000000000001' then new.status := 'pending'; end if;
  return new;
end $$;
drop trigger if exists businesses_house_stays_pending on businesses;
create trigger businesses_house_stays_pending before update of status on businesses
  for each row execute function sehat_house_stays_pending();
delete from email_outbox where business_id = '5e4a75a0-0000-4000-8000-000000000001';
delete from business_partner_credits where business_id = '5e4a75a0-0000-4000-8000-000000000001';

alter table social_settings add column if not exists audience text not null default 'patients';
alter table social_settings drop constraint if exists social_settings_audience_check;
alter table social_settings add constraint social_settings_audience_check check (audience in ('patients', 'doctors'));
alter table social_settings add column if not exists profile jsonb not null default '{}'::jsonb;

insert into social_settings (business_id, enabled, languages, audience, profile)
values ('5e4a75a0-0000-4000-8000-000000000001', true, 'both', 'doctors', jsonb_build_object(
  'name', 'Sehatsandhi',
  'phone', '70153 99355',
  'website', 'sehatsandhi.com',
  'logo', 'https://www.sehatsandhi.com/logo.png',
  'brand', '#0f4c5c',
  'tagline', 'Clinic and hospital software, made in India'))
on conflict (business_id) do update set audience = 'doctors', profile = excluded.profile;

-- ── Stories, and Instagram in the evening ──────────────────────────────────
alter table social_posts add column if not exists fb_story_id text;
alter table social_posts add column if not exists ig_story_id text;

do $$
begin
  perform cron.unschedule('social-posts-publish-ig') where exists (select 1 from cron.job where jobname = 'social-posts-publish-ig');
  -- 7:30 PM IST = 14:00 UTC.
  perform cron.schedule('social-posts-publish-ig', '0 14 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/social-posts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{"action":"publish","channel":"instagram"}'::jsonb,
      timeout_milliseconds := 300000)
    where exists (select 1 from social_settings where enabled and not paused)
  $job$);
  -- The 10 AM run (0295) is Facebook's from now on.
  perform cron.unschedule('social-posts-publish') where exists (select 1 from cron.job where jobname = 'social-posts-publish');
  perform cron.schedule('social-posts-publish', '30 4 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/social-posts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{"action":"publish","channel":"facebook"}'::jsonb,
      timeout_milliseconds := 300000)
    where exists (select 1 from social_settings where enabled and not paused)
  $job$);
end $$;

notify pgrst, 'reload schema';
