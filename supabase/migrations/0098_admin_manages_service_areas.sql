-- ============================================================================
-- Sehatsandhi — admin can open a new area without a deploy
--
-- Run AFTER 0097. Safe to re-run.
--
-- service_areas is the list of places we have launched: it decides what the
-- public Browse page offers, what the signup wizard sells coverage of, and what
-- the per-pincode tiers price. Twenty rows went in as seed data and there has
-- never been a way to add the twenty-first except by writing SQL.
--
-- That is what made the platform feel Yamuna Nagar-shaped. 0094 let a business
-- register anywhere and the previous commit stopped the frontend hardcoding the
-- list — this is the last piece: opening Jaipur should be a form, not a
-- migration.
--
-- ── READ AND WRITE ARE DIFFERENT QUESTIONS ──────────────────────────────────
-- The existing public_read_areas policy is `is_active = true`, which is right
-- for visitors and wrong for the person managing the list: an admin who
-- deactivates an area needs to still see it to turn it back on. So admins get
-- their own policy covering every row.
--
-- ── NO DELETE, ON PURPOSE ───────────────────────────────────────────────────
-- Deactivating and deleting look the same on screen and are not the same at
-- all. Every business that sells into an area carries its pincode in
-- businesses.pin_codes — a plain text array with no foreign key, so a DELETE
-- would leave those entries pointing at nothing, silently, in rows that decide
-- what a clinic is paying for.
--
-- is_active = false removes the area from the public page and from new signups
-- and leaves every existing listing intact and reversible. That is what the
-- screen offers. The policy therefore grants INSERT and UPDATE and not DELETE;
-- an area genuinely created by mistake can still be removed with SQL, which is
-- the right amount of friction for an irreversible act.
--
-- ── THE GRANTS WERE ALREADY WIDE, AND ALREADY INERT ─────────────────────────
-- Measured before writing this: `authenticated` already holds INSERT, UPDATE
-- and DELETE grants on this table, inherited from Supabase's defaults. They do
-- nothing, because RLS is enabled and there was no write policy — a plain
-- authenticated user is refused with 42501, checked on both databases. Adding a
-- policy is what turns a grant into an ability, which is why the policy is
-- written against sehat_is_admin() rather than the grants being widened.
-- ============================================================================

-- Admins see every area, including the ones they have switched off.
drop policy if exists admins_read_all_areas on service_areas;
create policy admins_read_all_areas on service_areas
  for select using (sehat_is_admin());

drop policy if exists admins_add_areas on service_areas;
create policy admins_add_areas on service_areas
  for insert with check (sehat_is_admin());

drop policy if exists admins_edit_areas on service_areas;
create policy admins_edit_areas on service_areas
  for update using (sehat_is_admin()) with check (sehat_is_admin());

comment on table service_areas is
  'Areas we have launched. Drives the public area picker, the coverage a '
  'signup is sold, and per-pincode tier pricing. Managed from the admin '
  'Insights screen since 0098. Deactivate rather than delete: businesses '
  'carry pincodes in a plain text array with no foreign key.';


-- ============================================================================
-- Which tier a population falls in
--
-- pricing_tiers already carries the bands; this saves an admin reading them off
-- a table and picking wrong. Advisory only — the form pre-fills it and the
-- admin can override, because a district headquarters with a small resident
-- count can still be worth a city tier.
-- ============================================================================

create or replace function sehat_tier_for_population(p_population integer)
returns integer
language sql
stable
as $$
  select t.tier_number
    from pricing_tiers t
   where p_population >= coalesce(t.min_population, 0)
     and p_population <= coalesce(t.max_population, 2147483647)
   order by t.tier_number
   limit 1;
$$;

comment on function sehat_tier_for_population is
  'The pricing tier whose population band contains p_population. Advisory: the '
  'admin form pre-fills it and allows an override.';

grant execute on function sehat_tier_for_population(integer) to authenticated;
revoke all on function sehat_tier_for_population(integer) from public, anon;


notify pgrst, 'reload schema';
