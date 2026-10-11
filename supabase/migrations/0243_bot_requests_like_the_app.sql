-- ============================================================================
-- 0243 — On WhatsApp, an ambulance, medicines and insurance work as in the app
-- ============================================================================
-- AFTER 0241 (0242 waits on Meta). Safe to re-run.
--
-- The app sends a request (0189 medicines, 0191 ambulance, 0192 insurance):
-- the nearby pharmacies / ambulances / advisors are all told, and the first to
-- take it answers. The WhatsApp bot still listed phone numbers, and its
-- insurance request carried only a PIN code. The bot now asks what the app's
-- screens ask and makes the same request; these are its doors to the same
-- functions the app uses.
-- ============================================================================

create or replace function bot_ambulance_request_json(
  p_phone text, p_pin text, p_name text, p_kind text, p_address text, p_need text, p_lat text default null, p_lng text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_lat double precision := case when coalesce(p_lat, '') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then p_lat::double precision end;
  v_lng double precision := case when coalesce(p_lng, '') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then p_lng::double precision end;
begin
  r := sehat_create_ambulance_request(p_phone, p_pin, p_name, p_kind, p_address, p_need, 'whatsapp_bot');
  if r ? 'code' and v_lat between -90 and 90 and v_lng between -180 and 180 then
    update ambulance_requests set pickup_lat = v_lat, pickup_lng = v_lng where code = r ->> 'code';
  end if;
  return r;
end $$;

create or replace function bot_medicine_order_json(
  p_phone text, p_pin text, p_name text, p_address text, p_medicines text, p_rx_url text
) returns jsonb language sql security definer set search_path = public as $$
  select sehat_create_medicine_order(p_phone, p_pin, p_name, p_address, p_medicines, p_rx_url, 'whatsapp_bot');
$$;

create or replace function bot_insurance_lead_json(
  p_phone text, p_pin text, p_name text, p_cover text, p_members text, p_call_time text
) returns jsonb language sql security definer set search_path = public as $$
  select sehat_create_insurance_lead(p_phone, p_pin, p_name, p_cover, p_members, p_call_time, 'whatsapp_bot');
$$;

revoke all on function bot_ambulance_request_json(text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function bot_medicine_order_json(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function bot_insurance_lead_json(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function bot_ambulance_request_json(text, text, text, text, text, text, text, text) to service_role;
grant execute on function bot_medicine_order_json(text, text, text, text, text, text) to service_role;
grant execute on function bot_insurance_lead_json(text, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
