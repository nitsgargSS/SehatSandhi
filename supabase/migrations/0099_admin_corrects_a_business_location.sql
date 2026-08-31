-- ============================================================================
-- Sehatsandhi — admin can correct where a business is
--
-- Run AFTER 0098. Safe to re-run.
--
-- 0094 stopped new businesses being filed at the front of their coverage array
-- and 0095 asked them where they are. Neither helps the ones already on the
-- platform: they were never asked, so they still sit at whichever Yamuna Nagar
-- pincode happened to sort first, and the area report reports them there.
--
-- The backfill in 0094 deliberately did not invent corrections — a pincode
-- nobody chose is unasked, not known-wrong, and guessing would have replaced a
-- visible error with an invisible one. So it needs a human, and this is what
-- the human uses.
--
-- ── ONE CALL, TWO TABLES ────────────────────────────────────────────────────
-- A location lives in two places and both have to move together:
--
--   businesses.own_*              what the business told us
--   practice_locations (primary)  what every report reads
--
-- Admin already holds ALL on both — businesses_admin_all and
-- admins_manage_locations, checked before writing this — so a screen could
-- update them directly. It should not. Two writes from a browser is two chances
-- to land one and lose the other, and the failure is silent: the reports would
-- say Pune while the business record still said Yamuna Nagar, and nobody would
-- know which was believed. One function, one transaction, no drift.
--
-- ── THE SAME FALLBACK AS REGISTRATION ───────────────────────────────────────
-- A blank district or state is filled from service_areas when the pincode is
-- one we have launched, exactly as sehat_create_primary_location does. An admin
-- correcting a pincode to one we already price should not have to retype what
-- we already know about it.
-- ============================================================================

create or replace function sehat_admin_set_business_location(
  p_business uuid,
  p_pin_code text,
  p_city     text default null,
  p_district text default null,
  p_state    text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_pin      text := nullif(btrim(coalesce(p_pin_code, '')), '');
  v_city     text := nullif(btrim(coalesce(p_city, '')), '');
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_state    text := nullif(btrim(coalesce(p_state, '')), '');
  v_name     text;
  v_rows     integer;
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  select b.name into v_name from businesses b where b.id = p_business;
  if not found then
    raise exception 'No such business' using errcode = 'P0002';
  end if;

  -- A pincode is the one thing worth insisting on: it is what the reports group
  -- by, and a location with a town and no pincode groups under Unmapped anyway.
  if v_pin is null then
    return 'A pincode is needed — it is what the area reports group by.';
  end if;
  if v_pin !~ '^[1-9][0-9]{5}$' then
    return 'That is not an Indian pincode: six digits, not starting with zero.';
  end if;

  -- Fill the blanks from the curated areas, same rule registration uses.
  v_district := coalesce(v_district,
    (select a.district from service_areas a where a.pin_code = v_pin limit 1));
  v_state := coalesce(v_state,
    (select a.state from service_areas a where a.pin_code = v_pin limit 1));
  v_city := coalesce(v_city,
    (select a.area_name from service_areas a where a.pin_code = v_pin limit 1));

  update businesses
     set own_pin_code = v_pin,
         own_city     = v_city,
         own_district = v_district,
         own_state    = v_state,
         updated_at   = now()
   where id = p_business;

  update practice_locations
     set pin_code   = v_pin,
         city       = v_city,
         district   = v_district,
         state      = v_state,
         updated_at = now()
   where business_id = p_business and is_primary;

  get diagnostics v_rows = row_count;

  -- A business with no primary branch should not exist — the trigger makes one
  -- at registration — but a row that predates it, or one deactivated by hand,
  -- would otherwise leave this function reporting success having moved nothing.
  if v_rows = 0 then
    insert into practice_locations
      (business_id, name, address, pin_code, city, district, state, phone, is_primary)
    select p_business, coalesce(nullif(btrim(b.name), ''), 'Main branch'), b.address,
           v_pin, v_city, v_district, v_state, b.phone, true
      from businesses b where b.id = p_business;
    return v_name || ' had no main branch — one has been created at ' || v_pin || '.';
  end if;

  return v_name || ' is now recorded at ' || v_pin
       || coalesce(' (' || v_district || ', ' || v_state || ')', '') || '.';
end;
$$;

comment on function sehat_admin_set_business_location is
  'Corrects where a business IS — businesses.own_* and its primary '
  'practice_location together, in one transaction, so the reports and the '
  'business record cannot disagree. Does not touch businesses.pin_codes, which '
  'is coverage. Admin only.';

grant execute on function sehat_admin_set_business_location(uuid, text, text, text, text)
  to authenticated;
revoke all on function sehat_admin_set_business_location(uuid, text, text, text, text)
  from public, anon;


notify pgrst, 'reload schema';
