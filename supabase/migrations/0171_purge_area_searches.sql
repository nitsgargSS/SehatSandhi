-- ============================================================================
-- Sehatsandhi — area searches are kept 12 months, then deleted
--
-- Run AFTER 0170. Safe to re-run.
--
-- The Privacy Policy (updated with 0170's coverage card) says each area search
-- record is deleted after 12 months. This is that deletion: daily at 03:10 IST,
-- straight SQL, no edge function. 12 months is also the longest range the
-- Leads panel's "Area interest" offers, so nothing it shows is lost early.
-- (Written as its own migration because 0170 was already applied on
-- production when this was added.)
-- ============================================================================

do $$
begin
  begin perform cron.unschedule('purge-area-searches');
  exception when others then null; end;
  perform cron.schedule('purge-area-searches', '40 21 * * *',
    $job$ delete from public.area_searches where created_at < now() - interval '12 months' $job$);
end $$;
