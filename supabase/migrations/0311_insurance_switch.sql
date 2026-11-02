-- ============================================================================
-- 0311 — Insurance switched off (reversibly)
-- ============================================================================
-- AFTER 0310. Safe to re-run.
--
-- Decided 2 Nov 2026: the health-insurance offering is hidden everywhere until
-- the insurance strategy is final — the website, the WhatsApp bot and the app.
-- Existing insurance data (advisors, leads, wallets, ratings) is kept as it is.
--
--   site_settings 'insurance_enabled'   'off' now; 'on' brings it all back.
--   sehat_insurance_enabled()           what the website, the app (anon) and
--                                       the bot read to show or hide it.
--   insurance_leads_switch trigger      the backstop: while off, no new
--                                       insurance request can be made by any
--                                       path — an old app build, an old link,
--                                       a bot keyword — whatever the screens show.
-- Admin screens and the existing leads' own lifecycle (expiry cron, tracking
-- page) are left as they are.
-- ============================================================================

insert into site_settings (key, value) values ('insurance_enabled', 'off')
on conflict (key) do update set value = 'off', updated_at = now();

create or replace function sehat_insurance_enabled()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'on' from site_settings where key = 'insurance_enabled'), false)
$$;
revoke all on function sehat_insurance_enabled() from public;
grant execute on function sehat_insurance_enabled() to anon, authenticated, service_role;

create or replace function sehat_insurance_leads_switch()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_insurance_enabled() then
    raise exception 'Help with health insurance is not available right now.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists insurance_leads_switch on insurance_leads;
create trigger insurance_leads_switch before insert on insurance_leads
  for each row execute function sehat_insurance_leads_switch();

notify pgrst, 'reload schema';
