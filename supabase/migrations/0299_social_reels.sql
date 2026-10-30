-- ============================================================================
-- 0299 — A Reel with every post
-- ============================================================================
-- AFTER 0298. Safe to re-run.
--
-- Decided 29 Oct 2026: every day's post also becomes a short vertical video
-- (its story design, moving, with music). Instagram gets the Reel at 7:30 PM
-- in place of the image; Facebook keeps the image at 10 AM; no Reel (not made
-- in time, or failed) = Instagram gets the image as before.
--
-- Sehatsandhi's own Reels are read out (ElevenLabs voice, in the image's
-- language) so doctors understand the feature; clinics' Reels have music only.
--
-- A Reel takes a minute or two to make, so it is its own step: every 10
-- minutes from 1:40 PM to 7:20 PM IST the social-posts function makes the
-- next missing one (one per run). Music: the tracks in the social-posts
-- bucket under music/, taken in turn by date.
-- ============================================================================

alter table social_settings add column if not exists reels boolean not null default true;
alter table social_settings add column if not exists voiceover boolean not null default false;
grant update (reels) on social_settings to authenticated;

update social_settings set voiceover = true where business_id = '5e4a75a0-0000-4000-8000-000000000001';

alter table social_posts add column if not exists reel_url text;
alter table social_posts add column if not exists reel_error text;
alter table social_posts add column if not exists reel_attempts smallint not null default 0;
-- What the voice says (Sehatsandhi's), written with the post.
alter table social_posts add column if not exists reel_script text;
alter table social_posts add column if not exists ig_reel_id text;

do $$
begin
  perform cron.unschedule('social-posts-reels') where exists (select 1 from cron.job where jobname = 'social-posts-reels');
  -- 08:10–13:50 UTC = 1:40 PM–7:20 PM IST.
  perform cron.schedule('social-posts-reels', '*/10 8-13 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/social-posts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{"action":"reels"}'::jsonb,
      timeout_milliseconds := 300000)
    where exists (select 1 from social_settings where enabled and not paused and reels)
  $job$);
end $$;

notify pgrst, 'reload schema';
