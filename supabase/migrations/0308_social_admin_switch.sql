-- ============================================================================
-- 0308 — Admin switch for Social posts
-- ============================================================================
-- AFTER 0307. Safe to re-run.
--
-- social_settings.enabled (0292) is what a business paid for, so no
-- authenticated role may update it — admins included, since column grants
-- apply to them too. Until now it was set by hand in SQL. This lets an admin
-- switch it from the business row in Admin: on creates the settings row with
-- the defaults if there is none; off keeps the row (and the owner's choices)
-- and only clears enabled. Asked 1 Nov 2026, to switch it on for the Meta
-- reviewer's demo clinic and for clinics that buy the add-on.
-- ============================================================================

create or replace function sehat_social_set_enabled(p_business uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not sehat_is_admin() then
    raise exception 'Only a Sehatsandhi admin can switch Social posts.' using errcode = '42501';
  end if;
  insert into social_settings (business_id, enabled) values (p_business, p_on)
  on conflict (business_id) do update set enabled = excluded.enabled, updated_at = now();
  return p_on;
end $$;

revoke all on function sehat_social_set_enabled(uuid, boolean) from public, anon;
grant execute on function sehat_social_set_enabled(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
