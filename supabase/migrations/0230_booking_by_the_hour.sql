-- ============================================================================
-- 0230 — A clinic that books by the hour is offered, and confirmed, by the hour
-- ============================================================================
-- AFTER 0229. Safe to re-run.
--
-- A clinic can take several patients in one window — "11 to 12, five
-- patients" — and the window closes when it is full (slot_capacity, 0098).
-- The bot showed and confirmed only the window's START: five patients were
-- each told "11:00 AM", and would all have come at eleven. Decided 11 Oct
-- 2026: a window of half an hour or more is said as a window, in the list of
-- times and in the confirmation, with a line that the turn goes by arrival.
-- A short slot (15 minutes) is still said as a time, with "come 10 minutes
-- early".
-- ============================================================================

-- "सोम 12 अक्टूबर — 11:00 AM – 12:00 PM" for a window; the start alone for a short slot.
create or replace function bot_hi_window(p_start timestamptz, p_end timestamptz)
returns text
language sql stable set search_path = public as $$
  select case when p_end is not null and p_end - p_start >= interval '30 minutes'
              then bot_hi_when(p_start) || ' – ' || to_char(p_end at time zone 'Asia/Kolkata', 'HH12:MI AM')
              else bot_hi_when(p_start) end;
$$;

CREATE OR REPLACE FUNCTION public.bot_slot_options(p_business_id uuid, p_practitioner_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 7)
 RETURNS TABLE(rn integer, slot_start timestamp with time zone, label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with days as (
    select ((now() at time zone 'Asia/Kolkata')::date + g) as d
      from generate_series(0, greatest(coalesce(p_days, 7), 1) - 1) g
  ),
  open_windows as (
    select w.window_start, w.window_end
      from days
      cross join lateral sehat_open_windows(p_business_id, days.d, p_practitioner_id) w
     where w.seats_left > 0
       and w.window_start > now() + interval '30 minutes'
  ),
  numbered as (
    select row_number() over (order by window_start)::integer as rn, window_start, window_end
      from open_windows
  )
  select n.rn, n.window_start, bot_hi_window(n.window_start, n.window_end)
    from numbered n
   where n.rn <= 10
   order by n.rn;
$function$;

CREATE OR REPLACE FUNCTION public.bot_book_at(p_business_id uuid, p_practitioner_id uuid, p_patient_info text, p_slot_datetime timestamp with time zone, p_phone text, p_pin_code text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_info  text := btrim(coalesce(p_patient_info, ''));
  v_pin   text := case when p_pin_code ~ '^[1-9][0-9]{5}$' then p_pin_code end;
  v_name  text;
  v_age   integer;
  v_biz   record;
  v_who   text;
  v_end   timestamptz;
begin
  if v_phone is null then
    return 'हमें आपका मोबाइल नंबर सही से नहीं मिला। कृपया 10 अंकों का नंबर भेजें।';
  end if;
  if p_business_id is null or p_slot_datetime is null then
    return 'आपका चयन समझ नहीं आया। कृपया सूची में से दोबारा चुनें।';
  end if;

  select b.id, b.name, b.address, b.phone
    into v_biz
    from businesses b
   where b.id = p_business_id and b.status = 'active';
  if not found then
    return 'यह लिस्टिंग अभी उपलब्ध नहीं है। कृपया सूची में से कोई और चुनें।';
  end if;

  select coalesce(
           (select p.full_name from practitioners p where p.id = p_practitioner_id),
           v_biz.name)
    into v_who;

  v_name := nullif(btrim(split_part(v_info, ',', 1)), '');
  v_age  := nullif(substring(v_info from '([0-9]{1,3})[^0-9]*$'), '')::integer;
  if v_age is not null and (v_age < 1 or v_age > 120) then v_age := null; end if;
  if v_info not like '%,%' and v_age is not null then
    v_name := nullif(btrim(regexp_replace(v_name, '[0-9]{1,3}[^0-9]*$', '')), '');
  end if;

  -- 0230: where this time's window ends (an hour for a clinic that books by the hour).
  select w.window_end into v_end
    from sehat_open_windows(p_business_id, (p_slot_datetime at time zone 'Asia/Kolkata')::date, p_practitioner_id) w
   where w.window_start = p_slot_datetime limit 1;

  insert into appointments (
    patient_phone, patient_name, patient_age, business_id, practitioner_id,
    slot_datetime, status, booked_via, last_actor, last_actor_detail, patient_pin_code
  ) values (
    v_phone, v_name, v_age, v_biz.id, p_practitioner_id,
    p_slot_datetime, 'booked', 'whatsapp_bot', 'patient', 'whatsapp_bot', v_pin
  );

  return 'आपका अपॉइंटमेंट बुक हो गया ✅'
      || E'\n\n' || v_who
      || case when v_who <> v_biz.name then E'\n' || v_biz.name else '' end
      -- 0230: an hour's window is said as a window, with when within it to come.
      || E'\n' || bot_hi_window(p_slot_datetime, v_end)
      || case when v_end - p_slot_datetime >= interval '30 minutes' then E'\nइस समय के बीच कभी भी आएँ — आपकी बारी पहुँचने के क्रम से आएगी।' else '' end
      || case when coalesce(v_biz.address, '') <> '' then E'\n' || v_biz.address else '' end
      || case when v_end - p_slot_datetime >= interval '30 minutes' then E'\n\nबदलाव के लिए यहीं मैसेज करें।'
              else E'\n\nकृपया 10 मिनट पहले पहुँचें। बदलाव के लिए यहीं मैसेज करें।' end
      || E'\n\n⭐ डॉक्टर से मिलने के बाद यहीं 1 से 5 तक एक नंबर भेजकर रेटिंग दें। '
      || 'इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलती है।';
exception
  when check_violation then
    return 'यह समय अभी-अभी भर गया। कृपया दूसरा समय चुनें।';
end $function$;

notify pgrst, 'reload schema';
