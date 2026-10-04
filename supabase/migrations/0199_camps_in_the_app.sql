-- ============================================================================
-- Sehatsandhi — health camps and offers, listed in the app
--
-- Run AFTER 0198. Safe to re-run.
--
-- camps_offers has no public read policy: only the WhatsApp bot could list
-- them (bot_camps_offers, as Hindi text). The app needs the same list as rows:
-- approved, not yet over, anywhere in the district of the PIN asked about —
-- the ones covering that PIN itself first, then by start date.
-- Nothing private is returned: the camp as the clinic published it, and the
-- clinic's public name, phone and address.
-- ============================================================================

create or replace function sehat_find_camps(p_pin_code text)
returns table (
  id uuid, kind text, title text, description text, services text,
  date_from date, date_to date, time_slot text, near boolean,
  business_id uuid, business_name text, phone text, address text, city text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_pin  text := bot_pincode(p_pin_code);
  v_pins text[];
begin
  if v_pin is null then return; end if;
  v_pins := sehat_district_pin_codes(v_pin);
  return query
    select c.id, c.camp_type, c.title, c.description, c.services_offered,
           c.date_from, c.date_to, c.time_slot, c.pin_codes @> array[v_pin],
           b.id, b.name, b.phone, b.address, nullif(btrim(b.own_city), '')
      from camps_offers c
      left join businesses b on b.id = c.business_id
     where c.status = 'approved'
       and c.date_to >= (now() at time zone 'Asia/Kolkata')::date
       and c.pin_codes && v_pins
       and (b.id is null or b.status = 'active')
     order by (c.pin_codes @> array[v_pin]) desc, c.date_from
     limit 30;
end $$;

revoke all on function sehat_find_camps(text) from public;
grant execute on function sehat_find_camps(text) to anon, authenticated;

notify pgrst, 'reload schema';
