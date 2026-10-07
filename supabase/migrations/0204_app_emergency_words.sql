-- 0204: the app's offline emergency check (0201 plan §5B).
--
-- The app keeps a copy of the emergency words so that, with no network or a
-- slow one, "saans nahi aa rahi" still opens the 108 screen. This hands out the
-- normalised words only — the same list the matcher uses, nothing else; the
-- table itself stays admin-only.
create or replace function sehat_emergency_terms()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(normalized_term order by normalized_term), '{}')
    from emergency_keywords where is_active;
$$;
revoke all on function sehat_emergency_terms() from public;
grant execute on function sehat_emergency_terms() to anon, authenticated;
notify pgrst, 'reload schema';
