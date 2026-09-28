-- ============================================================================
-- Sehatsandhi — schedule the deletions the Privacy Policy promises
--
-- Run AFTER 0171. Safe to re-run.
--
-- Found while bringing the Privacy Policy in line with the DPDP Act 2023 and
-- DPDP Rules 2025 (29 Sep 2026): these purge functions were written long ago
-- but nothing ever called them, so "location records are deleted after 90
-- days" was not true. Each is now a daily pg_cron job, straight SQL, between
-- 03:00 and 03:30 IST beside the existing document and area-search purges.
--
--   purge-visitor-locations   visitor_locations idle 90 days      (0034)
--   purge-site-events         site_events older than 400 days     (0013)
--                             — "about 13 months" in the policy
--   purge-wa-bodies           WhatsApp message bodies 7 days after
--                             the session closed                   (0005)
--   purge-login-codes         used or expired sign-in codes        (0023)
--   purge-contact-inquiries   Contact-page messages after 24 months
--                             (new here; 0165 kept them for good)
-- ============================================================================

do $$
declare j record;
begin
  for j in
    select * from (values
      ('purge-visitor-locations', '5 21 * * *',  $c$ select public.sehat_purge_stale_visitor_locations(90) $c$),
      ('purge-site-events',       '10 21 * * *', $c$ select public.sehat_purge_old_site_events(400) $c$),
      ('purge-wa-bodies',         '15 21 * * *', $c$ select public.sehat_purge_closed_session_bodies(7) $c$),
      ('purge-login-codes',       '20 21 * * *', $c$ select public.sehat_purge_login_codes() $c$),
      ('purge-contact-inquiries', '25 21 * * *', $c$ delete from public.contact_inquiries where created_at < now() - interval '24 months' $c$)
    ) v(name, sched, cmd)
  loop
    begin perform cron.unschedule(j.name);
    exception when others then null; end;
    perform cron.schedule(j.name, j.sched, j.cmd);
  end loop;
end $$;
