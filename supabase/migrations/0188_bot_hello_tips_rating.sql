-- ============================================================================
-- Sehatsandhi — the bot's search node also saves "Hi", the tips opt-in and
--               ratings (no webhook needed)
--
-- Run AFTER 0187. Safe to re-run.
--
-- Decided 1 Oct 2026: AiSensy's plan has no webhook, and all five API nodes are
-- in use — so, as with the QR opt-in (0143) and STOP/START (0173), three more
-- things ride bot_generic_search_json, chosen by p_type:
--
--   hello   at the start of the chat: the WhatsApp number and name are saved
--           (sehat_wa_handle_inbound, 0005) — every enquiry, booked or not.
--   tips    the "✅ Yes, send me health tips" button: platform marketing
--           consent (sehat_wa_platform_optin, 0187).
--   rating  a 1–5 reply after a visit (bot_record_rating_json, 0164).
--
-- The node is public (search needs the anon key), so these three only act when
-- p_filter_value starts with the flow key — a secret held in bot_flow_settings
-- and typed once into the AiSensy flow:  "<key>|<the value>". Without it,
-- anyone could opt other people's numbers into marketing or rate visits they
-- never had. (STOP and START stay keyless: their harm is nil.)
--
--   p_type 'hello'  p_filter_value '<key>|{{name}}'          p_pincode {{phone}}
--   p_type 'tips'   p_filter_value '<key>|{{button text}}'   p_pincode {{phone}}
--   p_type 'rating' p_filter_value '<key>|{{message}}'       p_pincode {{phone}}
-- ============================================================================

create table if not exists bot_flow_settings (
  id integer primary key default 1 check (id = 1),
  flow_key text not null,
  updated_at timestamptz not null default now()
);
alter table bot_flow_settings enable row level security;
revoke all on bot_flow_settings from anon, authenticated;
insert into bot_flow_settings (id, flow_key) values (1, encode(gen_random_bytes(9), 'hex'))
on conflict (id) do nothing;

-- The value after "<key>|", or null when the key is missing or wrong.
create or replace function sehat_bot_keyed(p_value text)
returns text language sql stable security definer set search_path = public as $$
  select case when split_part(coalesce(p_value, ''), '|', 1) = s.flow_key
              then substr(p_value, length(s.flow_key) + 2) end
    from bot_flow_settings s where s.id = 1;
$$;
revoke all on function sehat_bot_keyed(text) from public, anon, authenticated;

create or replace function bot_generic_search_json(p_type text, p_filter_value text, p_pincode text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  r jsonb;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_val text;
begin
  -- 0143: the QR opt-in rides this node (all five AiSensy API nodes are used).
  if v_type = 'optin' then
    r := bot_clinic_optin(p_filter_value, p_pincode, null);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  -- 0173: STOP and START ride it too.
  if v_type = 'stop' then
    r := bot_opt_out(p_pincode, p_filter_value);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  if v_type = 'start' then
    r := bot_opt_in_again(p_pincode);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;

  -- 0188: hello / tips / rating — only with the flow key.
  if v_type in ('hello', 'tips', 'rating') then
    v_val := sehat_bot_keyed(p_filter_value);
    if v_val is null then
      return jsonb_build_object('found', false, 'route', 'info', 'text', '');
    end if;
    if v_type = 'hello' then
      begin
        perform sehat_wa_handle_inbound(p_pincode, nullif(btrim(v_val), ''), null, 'Hi', null, null);
        return jsonb_build_object('found', true, 'route', 'hello', 'text', '');
      exception when others then
        return jsonb_build_object('found', false, 'route', 'hello', 'text', '');   -- never stop the welcome
      end;
    elsif v_type = 'tips' then
      r := sehat_wa_platform_optin(p_pincode, v_val, null);
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text',
        case when coalesce((r ->> 'ok')::boolean, false)
          then 'धन्यवाद! 🙏 अब आपको अपने एरिया के क्लिनिक्स से हेल्थ टिप्स और ऑफ़र मिलेंगे। बंद करने के लिए कभी भी STOP भेजें।'
               || E'\n\n' || 'Thank you! You''ll get health tips and offers from clinics near you. Send STOP any time to stop.'
          else 'हमें आपका नंबर समझ नहीं आया। / We could not read your number.' end);
    else
      r := bot_record_rating_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    end if;
  end if;

  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;
-- Grants unchanged (anon, authenticated): create or replace keeps them.

notify pgrst, 'reload schema';
