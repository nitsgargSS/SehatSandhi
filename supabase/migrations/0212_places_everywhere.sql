-- ============================================================================
-- 0212 — Places outside Yamuna Nagar, in typed messages (WhatsApp and the app)
-- ============================================================================
-- AFTER 0211. Safe to re-run.
--
-- 0201's matcher knew only the Yamuna Nagar place list (location_aliases), so
-- "dentist in Delhi" or "karnal me skin doctor" lost the place and asked
-- "which area?". Now:
--   * place_names: every district in the PIN directory (one PIN for each — the
--     lowest), the everyday names 0170's area search uses (Gurgaon, Noida,
--     Bangalore…), towns near us that are not districts (Rishikesh, Zirakpur,
--     Paonta…), and Hindi spellings of the nearby ones. Delhi's districts
--     (East, West, Central…) are not listed by themselves: "Delhi" means
--     New Delhi.
--   * match_message: Yamuna Nagar places first, as before; otherwise a
--     place_names entry — exact, or close for 6+ letters (gurgoan, chandigar).
--     Names that are also ordinary words or people's names (gaya, puri,
--     mandi, Anand, Sagar…: needs_cue) count only after in / at / near or
--     before me / mein / में ("Anand se milna hai" is a person). A word that is one of our keywords is never taken as a place.
--     New fields: place_live (false = a place we are not in yet), district,
--     state.
--   * WhatsApp: asked for somewhere we are not in yet → "not there yet — we
--     are in Yamuna Nagar district", not a list from far away. Counted as
--     unmet demand (bot_search_log) and as area interest (area_searches, the
--     admin's Leads → Area interest). The app does the same (sehat_match_text).
--   * bot_pincode: the answer to "which area?" may be any district too.
-- ============================================================================

create table if not exists place_names (
  normalized_name text primary key,
  label      text not null,
  label_hi   text,
  district   text not null,
  state      text not null,
  pin_code   text not null,
  needs_cue  boolean not null default false,
  source     text not null check (source in ('district', 'common', 'town', 'hindi'))
);
create index if not exists place_names_trgm on place_names using gin (normalized_name gin_trgm_ops);
alter table place_names enable row level security;
drop policy if exists place_names_admin on place_names;
create policy place_names_admin on place_names for all using (sehat_is_admin()) with check (sehat_is_admin());
revoke all on place_names from anon;
-- Built entirely from the lists below: rebuilt on every run.
truncate place_names;

-- Districts: the largest of two same-named ones (Aurangabad, Bilaspur…) wins.
insert into place_names (normalized_name, label, district, state, pin_code, source)
select distinct on (n) n, district, district, state, pin, 'district'
  from (select normalize_text(district) n, district, state, min(pin_code) pin, count(*) c
          from pincode_directory
         where not (state = 'Delhi' and district <> 'New Delhi')
         group by district, state) d
 where n <> '' and n not in (select normalized_alias from location_aliases)
 order by n, c desc
on conflict (normalized_name) do nothing;

-- Everyday names (0170's list), squashed → a district.
insert into place_names (normalized_name, label, district, state, pin_code, source)
select distinct on (c.k) c.k, initcap(c.k), pn.district, pn.state, pn.pin_code, 'common'
  from (values ('gurgaon', 'gurugram'), ('gurgram', 'gurugram'), ('bangalore', 'bengaluruurban'), ('bangalore', 'bengalururural'), ('bengaluru', 'bengaluruurban'), ('bengaluru', 'bengalururural'), ('bengalore', 'bengaluruurban'), ('bengalore', 'bengalururural'), ('bombay', 'mumbai'), ('bombay', 'mumbaisuburban'), ('mumbai', 'mumbai'), ('mumbai', 'mumbaisuburban'), ('navimumbai', 'thane'), ('noida', 'gautambuddhanagar'), ('greaternoida', 'gautambuddhanagar'), ('calcutta', 'kolkata'), ('madras', 'chennai'), ('poona', 'pune'), ('mysore', 'mysuru'), ('allahabad', 'prayagraj'), ('cochin', 'ernakulam'), ('kochi', 'ernakulam'), ('vizag', 'visakhapatanam'), ('visakhapatnam', 'visakhapatanam'), ('baroda', 'vadodara'), ('trivandrum', 'thiruvananthapuram'), ('ahmedabad', 'ahmadabad'), ('mohali', 'sasnagar'), ('kanpur', 'kanpurnagar'), ('secunderabad', 'hyderabad'), ('jagadhri', 'yamunanagar'), ('benares', 'varanasi'), ('banaras', 'varanasi'), ('pondicherry', 'puducherry')) c(k, d)
  join place_names pn on pn.source = 'district' and sehat_squash(pn.district) = c.d
 where c.k not in (select normalized_alias from location_aliases)
 order by c.k, pn.pin_code
on conflict (normalized_name) do nothing;

-- Towns near us, and common spellings.
insert into place_names (normalized_name, label, district, state, pin_code, source)
select distinct on (normalize_text(t.name)) normalize_text(t.name), initcap(t.name), pn.district, pn.state, pn.pin_code, 'town'
  from (values ('rishikesh', 'Dehradun', 'Uttarakhand'), ('mussoorie', 'Dehradun', 'Uttarakhand'), ('roorkee', 'Haridwar', 'Uttarakhand'), ('zirakpur', 'S.A.S Nagar', 'Punjab'), ('kharar', 'S.A.S Nagar', 'Punjab'), ('ambala cantt', 'Ambala', 'Haryana'), ('ambala cantonment', 'Ambala', 'Haryana'), ('naraingarh', 'Ambala', 'Haryana'), ('pehowa', 'Kurukshetra', 'Haryana'), ('thanesar', 'Kurukshetra', 'Haryana'), ('ladwa', 'Kurukshetra', 'Haryana'), ('nahan', 'Sirmaur', 'Himachal Pradesh'), ('paonta sahib', 'Sirmaur', 'Himachal Pradesh'), ('paonta', 'Sirmaur', 'Himachal Pradesh'), ('deoband', 'Saharanpur', 'Uttar Pradesh'), ('behat', 'Saharanpur', 'Uttar Pradesh'), ('gangoh', 'Saharanpur', 'Uttar Pradesh'), ('kalka', 'Panchkula', 'Haryana'), ('pinjore', 'Panchkula', 'Haryana'), ('delhi', 'New Delhi', 'Delhi'), ('new delhi', 'New Delhi', 'Delhi'), ('dilli', 'New Delhi', 'Delhi'), ('faridabad', 'Faridabad', 'Haryana'), ('ghaziabad', 'Ghaziabad', 'Uttar Pradesh')) t(name, district, state)
  join place_names pn on pn.source = 'district' and pn.district = t.district and pn.state = t.state
on conflict (normalized_name) do nothing;

-- Hindi spellings.
insert into place_names (normalized_name, label, label_hi, district, state, pin_code, source)
select normalize_text(h.hi), case when h.district = 'New Delhi' then 'Delhi' else pn.label end, h.hi, pn.district, pn.state, pn.pin_code, 'hindi'
  from (values ('दिल्ली', 'New Delhi', 'Delhi'), ('नई दिल्ली', 'New Delhi', 'Delhi'), ('गुड़गांव', 'Gurugram', 'Haryana'), ('गुडगाँव', 'Gurugram', 'Haryana'), ('गुरुग्राम', 'Gurugram', 'Haryana'), ('चंडीगढ़', 'Chandigarh', 'Chandigarh'), ('अंबाला', 'Ambala', 'Haryana'), ('अम्बाला', 'Ambala', 'Haryana'), ('करनाल', 'Karnal', 'Haryana'), ('कुरुक्षेत्र', 'Kurukshetra', 'Haryana'), ('पानीपत', 'Panipat', 'Haryana'), ('पंचकूला', 'Panchkula', 'Haryana'), ('कैथल', 'Kaithal', 'Haryana'), ('सोनीपत', 'Sonipat', 'Haryana'), ('रोहतक', 'Rohtak', 'Haryana'), ('हिसार', 'Hisar', 'Haryana'), ('सहारनपुर', 'Saharanpur', 'Uttar Pradesh'), ('देहरादून', 'Dehradun', 'Uttarakhand'), ('हरिद्वार', 'Haridwar', 'Uttarakhand'), ('शिमला', 'Shimla', 'Himachal Pradesh'), ('मोहाली', 'S.A.S Nagar', 'Punjab'), ('लुधियाना', 'Ludhiana', 'Punjab'), ('मेरठ', 'Meerut', 'Uttar Pradesh'), ('नोएडा', 'Gautam Buddha Nagar', 'Uttar Pradesh'), ('मुंबई', 'Mumbai', 'Maharashtra'), ('जयपुर', 'Jaipur', 'Rajasthan'), ('लखनऊ', 'Lucknow', 'Uttar Pradesh'), ('पटियाला', 'Patiala', 'Punjab'), ('नाहन', 'Sirmaur', 'Himachal Pradesh'), ('पांवटा', 'Sirmaur', 'Himachal Pradesh')) h(hi, district, state)
  join place_names pn on pn.source = 'district' and pn.district = h.district and pn.state = h.state
on conflict (normalized_name) do nothing;
update place_names set label = 'Delhi' where district = 'New Delhi' and source in ('town', 'district');

-- Ordinary words and people's names.
update place_names set needs_cue = true where normalized_name in ('gaya', 'guna', 'puri', 'pali', 'dhar', 'mau', 'una', 'mon', 'dang', 'diu', 'mahe', 'kota', 'doda', 'tapi', 'banda', 'basti', 'mandi', 'sagar', 'anand', 'hassan', 'vaishali', 'panna', 'bhandara', 'thane', 'samba', 'kheda', 'salem', 'banka', 'saran', 'nalanda', 'karim', 'raja', 'leh', 'beed', 'rewa', 'durg', 'etah', 'tonk', 'phek', 'moga', 'nuh', 'jind');

-- Counted as area interest (Leads → Area interest), one row per message.
create or replace function sehat_ft_note_place(m jsonb, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into area_searches (session_id, query, method, found, kind, label, district, state, live)
  values ('ft:' || p_channel, left(coalesce(m ->> 'location', ''), 60), 'typed', true, 'district',
          left(m ->> 'location', 80), left(m ->> 'district', 80), left(m ->> 'state', 60), false);
end $$;
revoke all on function sehat_ft_note_place(jsonb, text) from public, anon, authenticated;

insert into bot_reply_templates (key, text_hi, note) values
  ('not_live_place', 'माफ़ कीजिए, Sehatsandhi अभी {place} में उपलब्ध नहीं है — अभी हम यमुनानगर ज़िले (जगाधरी, यमुनानगर, रादौर, बिलासपुर, छछरौली, साढौरा) में हैं। {place} में {what} की आपकी ज़रूरत हमने दर्ज कर ली है, ताकि हम वहाँ जल्दी शुरू कर सकें।' || E'\n' || 'यमुनानगर ज़िले में चाहिए तो वहाँ का PIN कोड या जगह का नाम भेजें।',
   '0212: a place we are not in yet. {place}, {what}.')
on conflict (key) do nothing;

create or replace function match_message(p_text text, p_pin_hint text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_norm   text := normalize_text(left(coalesce(p_text, ''), 1000));
  v_tok    text[] := tokenize_text(left(coalesce(p_text, ''), 1000));
  v_n      int := coalesce(array_length(tokenize_text(left(coalesce(p_text, ''), 1000)), 1), 0);
  v_used   boolean[];
  v_high   numeric := coalesce((select value::numeric from site_settings where key = 'free_text_high'), 0.7);
  v_low    numeric := coalesce((select value::numeric from site_settings where key = 'free_text_low'), 0.4);
  r        record;
  i        int;
  v_pin    text;
  v_place  text;
  v_place_hi text;
  v_place_live boolean;            -- 0212: false = a place we are not in yet
  v_district text; v_state text;
  v_day    int;
  v_window text;
  v_urgent boolean := false;
  v_int    jsonb := '{}'::jsonb;   -- intent → score
  v_spec   jsonb := '{}'::jsonb;   -- speciality → score
  v_hint   text;
  v_terms  text[] := '{}';
  v_spans  text[] := '{}';         -- accepted "s-e" spans: other keywords on the same words count too
  v_top    text; v_top_s numeric := 0; v_second_s numeric := 0;
  v_sp     text; v_sp_s numeric := 0; v_sp2_s numeric := 0;
  v_conf   numeric := 0;
  v_action text;
  v_secondary text[] := '{}';
  v_date   date;
  v_when   text := '';
  v_what   text;
  v_sname  text; v_splain text;
  v_reply  text;
  v_branch text;
begin
  if v_n = 0 then
    return jsonb_build_object('is_emergency', false, 'intent', null, 'confidence', 0, 'action', 'menu',
      'next_branch', null, 'reply_text', sehat_ft_fill('menu', '{}'), 'normalized_text', v_norm, 'secondary_intents', '[]'::jsonb);
  end if;
  v_used := array_fill(false, array[v_n]);

  -- 1. Emergency first.
  for r in
    with g as (
      select s, e, array_to_string(v_tok[s:e], ' ') as gram
        from generate_series(1, v_n) s, generate_series(s, least(v_n, s + 4)) e
    )
    select ek.term, ek.severity, g.s, g.e,
           case when ek.normalized_term = g.gram then 1.0 else similarity(ek.normalized_term, g.gram) end as sim
      from g join emergency_keywords ek
        on ek.is_active
       and array_length(string_to_array(ek.normalized_term, ' '), 1) = g.e - g.s + 1
       and (ek.normalized_term = g.gram
            or (length(g.gram) >= 5 and length(ek.normalized_term) >= 5 and similarity(ek.normalized_term, g.gram) >= 0.5
                and sehat_ft_words_sim(ek.normalized_term, g.gram) >= 0.5))
     order by ek.severity = 'critical' desc, sim desc
  loop
    if not sehat_ft_negated(v_tok, r.s, r.e) then
      v_pin := coalesce((select t from unnest(v_tok) t where t ~ '^[1-9][0-9]{5}$' limit 1), bot_pincode(p_pin_hint));
      return jsonb_build_object(
        'is_emergency', true, 'severity', r.severity, 'intent', 'ambulance', 'speciality', null,
        'pincode', v_pin, 'confidence', 1, 'action', 'emergency', 'next_branch', 'ambulance',
        'matched_terms', jsonb_build_array(r.term), 'secondary_intents', '[]'::jsonb,
        'reply_text', sehat_ft_fill('emergency', '{}'), 'normalized_text', v_norm);
    end if;
  end loop;

  -- 2a. A PIN typed in the message.
  for i in 1..v_n loop
    if v_tok[i] ~ '^[1-9][0-9]{5}$' then v_pin := v_tok[i]; v_used[i] := true; exit; end if;
  end loop;
  -- 2b. A place.
  for r in
    with g as (
      select s, e, array_to_string(v_tok[s:e], ' ') as gram
        from generate_series(1, v_n) s, generate_series(s, least(v_n, s + 2)) e
    )
    select la.pin_code, la.location_name, la.location_name_hi, g.s, g.e,
           case when la.normalized_alias = g.gram then 1.0 else similarity(la.normalized_alias, g.gram) end as sim
      from g join location_aliases la
        on la.is_active
       and (la.normalized_alias = g.gram
            or (length(g.gram) >= 5 and la.normalized_alias % g.gram and similarity(la.normalized_alias, g.gram) >= 0.55
                and sehat_ft_words_sim(la.normalized_alias, g.gram) >= 0.55))
     order by g.e - g.s desc, sim desc
     limit 1
  loop
    v_place := r.location_name; v_place_hi := coalesce(r.location_name_hi, r.location_name);
    v_pin := coalesce(v_pin, r.pin_code);
    for i in r.s..r.e loop v_used[i] := true; end loop;
  end loop;
  if v_place is not null then v_place_live := true; end if;
  -- 2b'. 0212: anywhere else in India — a district, an everyday city name
  -- (Gurgaon, Noida, Delhi) or its Hindi spelling. Only when no Yamuna Nagar
  -- place and no PIN were typed. Names that are also ordinary words or
  -- people's names (gaya, puri, mandi, Anand, Sagar…) count only next to
  -- "in / me / mein / में"; a gram that is itself one of our keywords never.
  if v_place is null and v_pin is null then
    for r in
      with g as (
        select s, e, array_to_string(v_tok[s:e], ' ') as gram
          from generate_series(1, v_n) s, generate_series(s, least(v_n, s + 2)) e
      )
      select pn.label, pn.label_hi, pn.district, pn.state, pn.pin_code, pn.needs_cue, g.s, g.e,
             case when pn.normalized_name = g.gram then 1.0 else similarity(pn.normalized_name, g.gram) end as sim
        from g join place_names pn
          on pn.normalized_name = g.gram
          or (length(g.gram) >= 6 and length(pn.normalized_name) >= 6 and not pn.needs_cue
              and pn.normalized_name % g.gram and similarity(pn.normalized_name, g.gram) >= 0.7
              and sehat_ft_words_sim(pn.normalized_name, g.gram) >= 0.7)
       where not exists (select 1 from intent_keywords k where k.is_active and k.normalized_term = g.gram)
         and not exists (select 1 from time_expressions te where te.normalized_term = g.gram)
       order by g.e - g.s desc, sim desc, length(pn.normalized_name) desc
    loop
      if true = any (v_used[r.s:r.e]) then continue; end if;
      if r.needs_cue and not (
           (r.s > 1 and v_tok[r.s - 1] in ('in', 'at', 'near'))
           or (r.e < v_n and v_tok[r.e + 1] in ('me', 'mein', 'mai', 'mei', 'main', 'में', 'मे'))) then
        continue;
      end if;
      v_place := r.label; v_place_hi := coalesce(r.label_hi, r.label);
      v_district := r.district; v_state := r.state;
      v_place_live := exists (select 1 from service_areas sa where sa.is_active
                                and lower(sa.district) = lower(r.district) and lower(sa.state) = lower(r.state));
      v_pin := case when v_place_live then
                 coalesce((select sa.pin_code from service_areas sa where sa.is_active and lower(sa.district) = lower(r.district)
                            order by sa.population desc nulls last limit 1), r.pin_code)
               else r.pin_code end;
      for i in r.s..r.e loop v_used[i] := true; end loop;
      exit;
    end loop;
  end if;
  v_pin := coalesce(v_pin, bot_pincode(p_pin_hint));
  if v_place is null and v_pin is not null then
    select coalesce(la.location_name_hi, la.location_name) into v_place_hi
      from location_aliases la where la.pin_code = v_pin and la.is_active order by la.id limit 1;
  end if;

  -- 2c. Days and times.
  for r in
    with g as (
      select s, e, array_to_string(v_tok[s:e], ' ') as gram
        from generate_series(1, v_n) s, generate_series(s, least(v_n, s + 1)) e
    )
    select te.day_offset, te.time_window, te.is_urgent, g.s, g.e
      from g join time_expressions te
        on te.normalized_term = g.gram
        or (length(g.gram) >= 5 and length(te.normalized_term) >= 5 and similarity(te.normalized_term, g.gram) >= 0.6
            and sehat_ft_words_sim(te.normalized_term, g.gram) >= 0.6)
     order by g.e - g.s desc
  loop
    if not (true = any (v_used[r.s:r.e])) then
      v_day := coalesce(greatest(v_day, r.day_offset), r.day_offset, v_day);
      v_window := coalesce(r.time_window, v_window);
      v_urgent := v_urgent or r.is_urgent;
      for i in r.s..r.e loop v_used[i] := true; end loop;
    end if;
  end loop;

  -- 3. Keywords, longest phrase first (up to four words: "bachha nahi ho raha").
  for r in
    with g as (
      select s, e, array_to_string(v_tok[s:e], ' ') as gram
        from generate_series(1, v_n) s, generate_series(s, least(v_n, s + 3)) e
    )
    select k.term, k.intent, k.speciality, k.lab_test_hint, k.weight, g.s, g.e,
           case when k.normalized_term = g.gram then 1.0 else similarity(k.normalized_term, g.gram) end as sim
      from g join intent_keywords k
        on k.is_active
       and (k.normalized_term = g.gram
            or (length(g.gram) >= 4 and length(k.normalized_term) >= 4
                and k.normalized_term % g.gram and similarity(k.normalized_term, g.gram) >= 0.45
                and sehat_ft_words_sim(k.normalized_term, g.gram) >= 0.45))
     order by g.e - g.s desc, sim desc, k.weight desc
  loop
    -- The same words may count once for each intent / speciality (one word,
    -- one need) — never twice for the same one through two spellings of it.
    if (r.s || '-' || r.e || ':' || r.intent || ':' || coalesce(r.speciality, '')) = any (v_spans) then continue; end if;
    if (true = any (v_used[r.s:r.e])) and not ((r.s || '-' || r.e) = any (v_spans)) then continue; end if;
    -- Negated: "bukhar nahi hai", "no fever".
    if sehat_ft_negated(v_tok, r.s, r.e) then
      for i in r.s..r.e loop v_used[i] := true; end loop;
      continue;
    end if;
    for i in r.s..r.e loop v_used[i] := true; end loop;
    v_spans := array_cat(v_spans, array[r.s || '-' || r.e, r.s || '-' || r.e || ':' || r.intent || ':' || coalesce(r.speciality, '')]);
    v_terms := array_append(v_terms, r.term);
    v_int := jsonb_set(v_int, array[r.intent], to_jsonb(coalesce((v_int ->> r.intent)::numeric, 0) + r.weight * r.sim));
    if r.speciality is not null then
      v_spec := jsonb_set(v_spec, array[r.speciality], to_jsonb(coalesce((v_spec ->> r.speciality)::numeric, 0) + r.weight * r.sim));
    end if;
    if r.lab_test_hint is not null and v_hint is null then v_hint := r.lab_test_hint; end if;
  end loop;

  -- 4. Scores → one answer.
  select key, value::numeric into v_top, v_top_s from jsonb_each_text(v_int) order by value::numeric desc limit 1;
  select coalesce(max(value::numeric), 0) into v_second_s from jsonb_each_text(v_int) where key <> coalesce(v_top, '');
  if v_top = 'doctor' then
    select key, value::numeric into v_sp, v_sp_s from jsonb_each_text(v_spec) order by value::numeric desc limit 1;
    select coalesce(max(value::numeric), 0) into v_sp2_s from jsonb_each_text(v_spec) where key <> coalesce(v_sp, '');
  end if;
  if v_top is not null then
    v_conf := least(1, v_top_s)
      * (case when v_second_s > 0 then 0.5 + 0.5 * v_top_s / (v_top_s + v_second_s) else 1 end)
      * (case when v_sp2_s > 0 then 0.5 + 0.5 * v_sp_s / (v_sp_s + v_sp2_s) else 1 end);
    v_conf := round(v_conf, 2);
    select coalesce(array_agg(key order by value::numeric desc), '{}') into v_secondary
      from jsonb_each_text(v_int) where key <> v_top and value::numeric >= 0.6;
  end if;
  v_action := case when v_top is null then 'menu' when v_conf >= v_high then 'proceed' when v_conf >= v_low then 'confirm' else 'menu' end;

  -- 5. Words for the reply.
  if v_day is not null or v_window is not null then
    v_date := (now() at time zone 'Asia/Kolkata')::date + coalesce(v_day, 0);
    v_when := btrim(case coalesce(v_day, 0) when 0 then 'आज' when 1 then 'कल' when 2 then 'परसों' else to_char(v_date, 'DD/MM') end
              || case v_window when 'morning' then ' सुबह' when 'afternoon' then ' दोपहर' when 'evening' then ' शाम' else '' end);
  end if;
  if v_sp is not null then select name_hi, coalesce(plain_hi, name_hi) into v_sname, v_splain from speciality_names where code = v_sp; end if;
  v_what := case v_top
    when 'lab' then 'जांच (टेस्ट) लैब' when 'medicine' then 'दवाई' when 'ambulance' then 'एम्बुलेंस'
    when 'insurance' then 'हेल्थ इंश्योरेंस' when 'camps' then 'हेल्थ कैंप / ऑफ़र' when 'doctor' then 'डॉक्टर' end;
  v_branch := case v_top
    when 'doctor' then 'doctor_search' when 'lab' then 'lab_booking' when 'medicine' then 'medicine'
    when 'ambulance' then 'ambulance' when 'insurance' then 'insurance' when 'camps' then 'camps' end;
  v_reply := case
    when v_action = 'menu' then sehat_ft_fill('menu', '{}')
    when v_top = 'doctor' and v_sp is null then sehat_ft_fill('proceed_doctor_any', '{}')
    else sehat_ft_fill(
      case when v_action = 'confirm' then (case when v_sp is not null then 'confirm_doctor' else 'confirm_other' end)
           else (case when v_sp is not null then 'proceed_doctor' else 'proceed_other' end) end,
      jsonb_build_object('spec_hi', v_sname, 'spec_plain', v_splain, 'what', v_what,
        'details', coalesce('(' || nullif(concat_ws(' · ', v_place_hi, nullif(v_when, '')), '') || ')', '')))
  end;
  if v_action <> 'menu' and cardinality(v_secondary) > 0 then
    v_reply := v_reply || E'\n' || sehat_ft_fill('secondary', jsonb_build_object('what',
      case v_secondary[1] when 'lab' then 'जांच (टेस्ट)' when 'medicine' then 'दवाई' when 'doctor' then 'डॉक्टर'
        when 'insurance' then 'इंश्योरेंस' when 'camps' then 'कैंप / ऑफ़र' when 'ambulance' then 'एम्बुलेंस' end));
  end if;

  return jsonb_build_object(
    'is_emergency', false,
    'intent', v_top,
    'speciality', v_sp,
    'speciality_name_hi', v_sname,
    'lab_test_hint', v_hint,
    'location', v_place,
    'location_hi', v_place_hi,
    'place_live', v_place_live,
    'district', v_district,
    'state', v_state,
    'pincode', v_pin,
    'target_date', v_date,
    'time_window', v_window,
    'urgent', v_urgent,
    'secondary_intents', to_jsonb(v_secondary),
    'confidence', v_conf,
    'action', v_action,
    'next_branch', case when v_action = 'menu' then null else v_branch end,
    'reply_text', v_reply,
    'matched_terms', to_jsonb(v_terms),
    'normalized_text', v_norm);
end $$;

create or replace function sehat_free_text_whatsapp(p_phone text, p_payload text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pin_hint text := nullif(btrim(split_part(coalesce(p_payload, ''), '|', 1)), '');
  v_text     text := btrim(substr(coalesce(p_payload, ''), length(split_part(coalesce(p_payload, ''), '|', 1)) + 2));
  m          jsonb;
  v_pin      text;
  v_branch   text;
  v_type     text;
  v_filter   text;
  v_list     text;
  v_log      bigint;
  v_search   bigint;
  v_route    text;
  v_out      text;
begin
  m := match_message(v_text, v_pin_hint);
  if (m ->> 'place_live')::boolean is false and m ->> 'intent' is null and not coalesce((m ->> 'is_emergency')::boolean, false) then
    perform sehat_ft_note_place(m, 'whatsapp');   -- a bare "Mumbai": still interest
  end if;
  v_pin := m ->> 'pincode';
  v_branch := m ->> 'next_branch';
  -- What the normal search node takes for this branch.
  v_type := case v_branch when 'doctor_search' then 'doctor' when 'lab_booking' then 'lab_booking'
                          when 'medicine' then 'pharmacy' when 'ambulance' then 'ambulance' when 'camps' then 'camps' end;
  v_filter := case when v_branch = 'doctor_search' then m ->> 'speciality' else v_type end;

  if not coalesce((m ->> 'is_emergency')::boolean, false) and (m ->> 'place_live')::boolean is false
     and m ->> 'intent' is not null then
    -- 0212: asked for somewhere we are not in yet — say so, and count it.
    perform sehat_ft_note_place(m, 'whatsapp');
    insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
    values (coalesce(v_type, m ->> 'intent'), case when v_type = 'doctor' then v_filter end, v_pin, m ->> 'location', false)
    returning id into v_search;
    v_route := 'info';
    v_out := sehat_ft_fill('not_live_place', jsonb_build_object('place', coalesce(m ->> 'location_hi', m ->> 'location'),
               'what', coalesce(m ->> 'speciality_name_hi', case m ->> 'intent' when 'lab' then 'जांच (टेस्ट) लैब' when 'medicine' then 'दवाई'
                 when 'insurance' then 'हेल्थ इंश्योरेंस' when 'camps' then 'हेल्थ कैंप' when 'ambulance' then 'एम्बुलेंस' else 'डॉक्टर' end)));
  elsif (m ->> 'is_emergency')::boolean then
    v_list := bot_ambulance(v_pin);
    v_out := sehat_ft_fill('emergency', '{}') || case when v_list is not null then E'\n\n' || v_list else '' end;
    v_route := 'emergency';
  elsif m ->> 'action' = 'proceed' then
    if v_branch = 'doctor_search' and m ->> 'speciality' is null then
      v_route := 'branch'; v_out := m ->> 'reply_text';
    elsif v_branch in ('insurance', 'medicine') then
      v_route := 'branch'; v_out := m ->> 'reply_text';
    elsif v_pin is null then
      v_route := 'ask_pin'; v_out := (m ->> 'reply_text') || E'\n' || sehat_ft_fill('ask_pin', '{}');
    else
      -- The same search the buttons run; bot_search_bookable logs unmet demand.
      v_list := bot_generic_search(v_type, v_filter, v_pin);
      insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
      values (v_type, case when v_type = 'doctor' then v_filter end, v_pin, null, v_list is not null)
      returning id into v_search;
      v_route := case when v_list is null then 'info' when v_type in ('doctor', 'lab_booking') then 'list' else 'info' end;
      v_out := (m ->> 'reply_text') || E'\n\n' || coalesce(v_list,
        case when v_type = 'lab_booking' then 'आपके क्षेत्र में अभी कोई जांच लैब उपलब्ध नहीं है। कृपया पास का PIN कोड आज़माएँ।'
             else 'आपके क्षेत्र में अभी इस स्पेशलिटी के डॉक्टर उपलब्ध नहीं हैं। कृपया दूसरी स्पेशलिटी या पास का PIN कोड आज़माएँ।' end);
    end if;
  elsif m ->> 'action' = 'confirm' then
    v_route := 'confirm'; v_out := m ->> 'reply_text';
  else
    v_route := 'menu'; v_out := m ->> 'reply_text';
  end if;

  v_log := sehat_ft_log('whatsapp', v_text, p_phone, null, m, v_search);

  return jsonb_build_object(
    'found', v_route in ('list', 'info', 'emergency'),
    'route', v_route,
    'text', v_out,
    'action', m ->> 'action',
    'next_branch', coalesce(v_branch, ''),
    'search_type', coalesce(v_type, ''),
    'filter_value', coalesce(v_filter, ''),
    'pincode', coalesce(v_pin, ''),
    'speciality', coalesce(m ->> 'speciality', ''),
    'target_date', coalesce(m ->> 'target_date', ''),
    'is_emergency', coalesce((m ->> 'is_emergency')::boolean, false),
    'confidence', m -> 'confidence',
    'log_id', v_log);
end $$;

create or replace function sehat_match_text(p_text text, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  m jsonb;
  v_log bigint;
begin
  if coalesce(btrim(p_text), '') = '' then raise exception 'Type what you need.' using errcode = 'P0001'; end if;
  if v_uid is not null then
    if (select count(*) from free_text_log where user_id = v_uid and created_at > now() - interval '1 minute') >= 30 then
      raise exception 'Too many searches — wait a minute.' using errcode = 'P0001';
    end if;
  elsif (select count(*) from free_text_log where channel = 'app' and user_id is null and created_at > now() - interval '1 minute') >= 300 then
    raise exception 'Too many searches — wait a minute.' using errcode = 'P0001';
  end if;
  m := match_message(p_text, p_pin);
  if (m ->> 'place_live')::boolean is false then perform sehat_ft_note_place(m, 'app'); end if;
  v_log := sehat_ft_log('app', p_text, null, v_uid, m);
  return m || jsonb_build_object('log_id', v_log);
end $$;

create or replace function bot_pincode(p_value text)
returns text
language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select coalesce(b.own_pin_code, b.pin_codes[1], '000000')
       from businesses b
      where b.qr_code = substring(upper(coalesce(p_value, '')) from 'SS-[A-Z0-9]{5}')),
    (select d from (select substring(coalesce(p_value, '') from '[1-9][0-9]{5}') as d) s
      where d is not null),
    (select a.pin_code
       from service_areas a
      where regexp_replace(lower(a.area_name), '[^a-z]', '', 'g')
          = nullif(regexp_replace(lower(coalesce(p_value, '')), '[^a-z]', '', 'g'), '')
      order by a.population desc nulls last
      limit 1),
    (select la.pin_code from location_aliases la
      where la.is_active and la.normalized_alias = nullif(normalize_text(p_value), '')
      limit 1),
    (select pn.pin_code from place_names pn
      where pn.normalized_name = nullif(normalize_text(p_value), '')
      limit 1)
  );
$function$;

revoke all on function match_message(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
