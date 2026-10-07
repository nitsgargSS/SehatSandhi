-- 0201: understanding what a patient types — rules first, no AI.
--
-- One matcher for every channel. match_message(text, pin_hint) reads the
-- keyword tables below and says what the patient wants: an emergency, or a
-- branch (doctor of a speciality, lab, medicine, ambulance, insurance, camps),
-- with a place and a day when it can tell. It writes nothing. Each channel has
-- a thin wrapper that calls it and logs the message to free_text_log:
--
--   WhatsApp  bot_generic_search_json(p_type 'text') → sehat_free_text_whatsapp
--             (the flow's one search node; AiSensy has no incoming-message
--             webhook on our plan, so the flow sends what the patient typed)
--   App       sehat_match_text(text, pin)            — RPC, signed in or guest
--   Webhook   (later, once AiSensy's partner plan gives us incoming messages:
--             an Edge Function receiving every message would call
--             sehat_free_text_whatsapp(phone, '<PIN>|<text>') exactly as the
--             search node does — the matcher does not change.)
--
-- A word added once (admin review, source 'learned') improves every channel.
-- The bot's older matchers (bot_speciality_code, bot_vertical_code) keep
-- serving the button menu until the test suite passes and the flow switches.
--
-- Never a diagnosis and never a medicine: the replies route, doctors advise.

create extension if not exists pg_trgm;

-- ── 1. Text in one shape ─────────────────────────────────────────────────────
-- Lower case; Devanagari kept as typed (no transliteration) apart from nukta,
-- zero-width joiners and chandrabindu → anusvara; punctuation, emoji and danda
-- become spaces; 3+ repeated characters become 2 ("bukhaaaar" → "bukhaar"), so
-- trigram similarity still finds the word. IMMUTABLE: the keyword tables store
-- its output in generated columns, so changing it means re-generating those.
create or replace function normalize_text(p text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               translate(lower(coalesce(p, '')), U&'\0901\093C\200C\200D', U&'\0902'),
               '[^a-z0-9ऀ-ॣ०-ॿ]+', ' ', 'g'),
             '(.)\1\1+', '\1\1', 'g'),
           '\s+', ' ', 'g'));
$$;

create or replace function tokenize_text(p text)
returns text[] language sql immutable parallel safe as $$
  select case when normalize_text(p) = '' then '{}'::text[] else string_to_array(normalize_text(p), ' ') end;
$$;

-- ── 2. Specialities by name ──────────────────────────────────────────────────
-- The codes doctors are stored under (practitioners.speciality). The website
-- keeps its own list in src/types (SPECIALITIES); this is the database's copy
-- for the bot's replies. plain_hi is how a patient would say it.
create table if not exists speciality_names (
  code      text primary key,
  name_en   text not null,
  name_hi   text not null,
  plain_hi  text,
  bookable  boolean not null default true
);
insert into speciality_names (code, name_en, name_hi, plain_hi, bookable) values
  ('GEN',  'General / Family Doctor',    'सामान्य डॉक्टर',   'सामान्य डॉक्टर (फ़िज़िशियन)', true),
  ('SKIN', 'Skin (Dermatology)',         'त्वचा रोग',        'त्वचा (स्किन) के डॉक्टर', true),
  ('DENT', 'Dental',                     'दंत चिकित्सा',     'दांतों के डॉक्टर', true),
  ('EYE',  'Eye (Ophthalmology)',        'नेत्र रोग',        'आँखों के डॉक्टर', true),
  ('PAED', 'Child Specialist',           'बाल रोग',          'बच्चों के डॉक्टर', true),
  ('GYN',  'Gynaecology / Maternity',    'स्त्री रोग',       'महिला रोग विशेषज्ञ', true),
  ('IVF',  'IVF / Fertility',            'बांझपन / आईवीएफ',  'संतान (IVF) विशेषज्ञ', true),
  ('ORTH', 'Orthopaedics / Bones',       'हड्डी रोग',        'हड्डी और जोड़ों के डॉक्टर', true),
  ('CARD', 'Heart (Cardiology)',         'हृदय रोग',         'दिल के डॉक्टर', true),
  ('ENT',  'ENT (Ear Nose Throat)',      'कान नाक गला',      'कान, नाक, गले के डॉक्टर', true),
  ('GAST', 'Gastro / Stomach',           'पेट रोग',          'पेट के डॉक्टर', true),
  ('NEUR', 'Neuro / Brain & Spine',      'मस्तिष्क रोग',     'दिमाग और नसों के डॉक्टर', true),
  ('URO',  'Urology / Kidney',           'मूत्र रोग',        'गुर्दे और पेशाब के डॉक्टर', true),
  ('ONC',  'Oncology / Cancer',          'कैंसर',           'कैंसर विशेषज्ञ', true),
  ('PSY',  'Psychiatry / Mental Health', 'मनोरोग',           'मानसिक स्वास्थ्य के डॉक्टर', true),
  ('DIAB', 'Diabetologist',              'मधुमेह रोग',       'शुगर (डायबिटीज़) के डॉक्टर', true),
  ('PHYS', 'Physiotherapy',              'फिजियोथेरेपी',     'फिजियोथेरेपिस्ट', true),
  ('ALT',  'Ayurveda / Homeopathy',      'आयुर्वेद',         'आयुर्वेद / होम्योपैथी', true),
  ('PATH', 'Pathology',                  'पैथोलॉजी',         null, false),
  ('RAD',  'Radiology',                  'रेडियोलॉजी',       null, false)
on conflict (code) do update
  set name_en = excluded.name_en, name_hi = excluded.name_hi, plain_hi = excluded.plain_hi, bookable = excluded.bookable;

-- ── 3. The vocabulary ────────────────────────────────────────────────────────
create table if not exists intent_keywords (
  id              bigserial primary key,
  term            text not null check (btrim(term) <> ''),
  normalized_term text generated always as (normalize_text(term)) stored,
  script          text generated always as (case when term ~ '[ऀ-ॿ]' then 'devanagari' else 'latin' end) stored,
  intent          text not null check (intent in ('doctor', 'lab', 'medicine', 'ambulance', 'insurance', 'camps')),
  speciality      text references speciality_names(code),
  lab_test_hint   text,
  weight          numeric not null default 1 check (weight > 0 and weight <= 3),
  source          text not null default 'seed' check (source in ('seed', 'learned')),
  is_active       boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  check (speciality is null or intent = 'doctor')
);
create unique index if not exists intent_keywords_term_uq on intent_keywords (normalized_term, intent, coalesce(speciality, ''));
create index if not exists intent_keywords_trgm on intent_keywords using gin (normalized_term gin_trgm_ops);

create table if not exists emergency_keywords (
  id              bigserial primary key,
  term            text not null check (btrim(term) <> ''),
  normalized_term text generated always as (normalize_text(term)) stored,
  severity        text not null default 'critical' check (severity in ('critical', 'urgent')),
  source          text not null default 'seed' check (source in ('seed', 'learned')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists emergency_keywords_term_uq on emergency_keywords (normalized_term);
create index if not exists emergency_keywords_trgm on emergency_keywords using gin (normalized_term gin_trgm_ops);

-- Places as patients write them. service_areas allows one area per PIN, so a
-- second place on the same PIN (Jagadhri Workshop on Radaur's 135002,
-- Khizrabad on Chhachhrauli's 135021) lives here as an alias.
create table if not exists location_aliases (
  id               bigserial primary key,
  alias            text not null check (btrim(alias) <> ''),
  normalized_alias text generated always as (normalize_text(alias)) stored,
  pin_code         text not null check (pin_code ~ '^[1-9][0-9]{5}$'),
  location_name    text not null,
  location_name_hi text,
  source           text not null default 'seed' check (source in ('seed', 'learned')),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
create unique index if not exists location_aliases_uq on location_aliases (normalized_alias);
create index if not exists location_aliases_trgm on location_aliases using gin (normalized_alias gin_trgm_ops);

-- 'previous': the word negates what came before it ("bukhar nahi hai").
-- 'next': what comes after it ("no fever", "bina dard").
create table if not exists negation_terms (
  id              bigserial primary key,
  term            text not null,
  normalized_term text generated always as (normalize_text(term)) stored,
  negates         text not null default 'previous' check (negates in ('previous', 'next', 'both'))
);
create unique index if not exists negation_terms_uq on negation_terms (normalized_term);

create table if not exists time_expressions (
  id              bigserial primary key,
  term            text not null,
  normalized_term text generated always as (normalize_text(term)) stored,
  day_offset      integer check (day_offset between 0 and 7),
  time_window     text check (time_window in ('morning', 'afternoon', 'evening')),
  is_urgent       boolean not null default false
);
create unique index if not exists time_expressions_uq on time_expressions (normalized_term);

-- Wording the admin can change without a release. {placeholders} are filled
-- by sehat_ft_fill: spec_hi, spec_plain, what, details ("(जगाधरी · कल सुबह)").
create table if not exists bot_reply_templates (
  key        text primary key,
  text_hi    text not null,
  note       text,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into bot_reply_templates (key, text_hi, note) values
  ('emergency', '🚨 यह इमरजेंसी लगती है। अभी 108 (एम्बुलेंस) या 112 पर कॉल करें — दोनों मुफ़्त हैं।', 'Never anything else first.'),
  ('emergency_partners', 'पास की एम्बुलेंस:', 'Followed by bot_ambulance() numbers when there are any.'),
  ('confirm_doctor', 'क्या आप {spec_plain} से मिलना चाहते हैं? {details}' || E'\n' || 'हाँ / नहीं', null),
  ('confirm_other', 'क्या आपको {what} चाहिए? {details}' || E'\n' || 'हाँ / नहीं', null),
  ('proceed_doctor', 'समझ गए: {spec_plain} {details}', 'One line, then the list.'),
  ('proceed_other', 'समझ गए: {what} {details}', null),
  ('proceed_doctor_any', 'आप किस तरह के डॉक्टर से मिलना चाहते हैं? कृपया नीचे से चुनें।', 'Doctor wanted, speciality not said.'),
  ('ask_pin', 'कृपया अपना 6 अंकों का PIN कोड या शहर का नाम भेजें (जैसे 135001 या जगाधरी)।', null),
  ('menu', 'माफ़ कीजिए, हम समझ नहीं पाए। कृपया नीचे से चुनें:', null),
  ('secondary', '{what} भी चाहिए तो मेन्यू से चुनें।', 'A second need in the same message.')
on conflict (key) do nothing;

-- ── 4. The log ───────────────────────────────────────────────────────────────
-- Typed messages only; button searches stay in bot_search_log. The phone is
-- never stored: a salted SHA-256 (salt in Vault). Raw text is cleared after 90
-- days (sehat_purge_free_text), the structured result kept.
create table if not exists free_text_log (
  id                    bigserial primary key,
  channel               text not null check (channel in ('whatsapp', 'app', 'web')),
  phone_hash            text,
  user_id               uuid,
  raw_text              text,
  normalized_text       text,
  matched_intent        text,
  matched_speciality    text,
  matched_pin           text,
  matched_place         text,
  matched_when          date,
  time_window           text,
  secondary_intents     text[],
  matched_terms         text[],
  is_emergency          boolean not null default false,
  confidence            numeric,
  action                text,
  method                text not null default 'rules' check (method in ('rules', 'confirm', 'fallback_menu', 'claude')),
  needs_review          boolean not null default false,
  bot_search_log_id     bigint references bot_search_log(id) on delete set null,
  corrected_intent      text,
  corrected_speciality  text,
  reviewed_at           timestamptz,
  reviewed_by           uuid,
  raw_purged_at         timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists free_text_log_review on free_text_log (created_at desc) where needs_review and reviewed_at is null;
create index if not exists free_text_log_user on free_text_log (user_id, created_at desc) where user_id is not null;
create index if not exists free_text_log_purge on free_text_log (created_at) where raw_purged_at is null;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'free_text_phone_salt') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'free_text_phone_salt',
      'Salt for free_text_log.phone_hash (0201). Changing it unlinks old rows from their phone.');
  end if;
end $$;

create or replace function sehat_ft_phone_hash(p_phone text)
returns text language sql stable security definer set search_path = public as $$
  select case when d = '' then null
    else encode(sha256(convert_to(coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'free_text_phone_salt'), '') || d, 'utf8')), 'hex') end
    from (select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) as d) s;
$$;

-- Thresholds, editable without a release.
insert into site_settings (key, value) values ('free_text_high', '0.7'), ('free_text_low', '0.4')
on conflict (key) do nothing;

-- ── 5. Who may touch it ──────────────────────────────────────────────────────
-- Nothing public. Admins (sehat_is_admin) read and review; everything else
-- goes through the security-definer functions below.
alter table speciality_names    enable row level security;
alter table intent_keywords     enable row level security;
alter table emergency_keywords  enable row level security;
alter table location_aliases    enable row level security;
alter table negation_terms      enable row level security;
alter table time_expressions    enable row level security;
alter table bot_reply_templates enable row level security;
alter table free_text_log       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['speciality_names', 'intent_keywords', 'emergency_keywords', 'location_aliases',
                           'negation_terms', 'time_expressions', 'bot_reply_templates', 'free_text_log'] loop
    execute format('drop policy if exists %I on %I', t || '_admin', t);
    execute format('create policy %I on %I for all to authenticated using (sehat_is_admin()) with check (sehat_is_admin())', t || '_admin', t);
  end loop;
end $$;
revoke all on speciality_names, intent_keywords, emergency_keywords, location_aliases, negation_terms,
              time_expressions, bot_reply_templates, free_text_log from anon;

-- ── 6. Fill a reply template ─────────────────────────────────────────────────
create or replace function sehat_ft_fill(p_key text, p_vars jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text; k text;
begin
  select text_hi into v from bot_reply_templates where key = p_key;
  if v is null then return null; end if;
  for k in select jsonb_object_keys(coalesce(p_vars, '{}'::jsonb)) loop
    v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, ''));
  end loop;
  return btrim(regexp_replace(regexp_replace(v, '\{[a-z_]+\}', '', 'g'), ' +([?।\n])', '\1', 'g'));
end $$;

-- How alike two phrases are, word by word: 0 when they have different numbers
-- of words; one word → its trigram similarity; several → the weakest pair,
-- where a short word (≤ 3 letters) must be identical unless both are joining
-- words (me / mein / ka / ki / में / का …). Whole-phrase similarity let
-- "daant ka doctor" pass for "dil ka doctor" and "aankh mein dard" for
-- "seene mein dard".

-- Is the phrase at tokens s..e negated? A 'previous' word (nahi, नहीं) after
-- it, or a 'next' word (no, without, bina) before it — reaching only through
-- filler words, so "daant me dard nahi" is negated but in "baal jhadna band
-- nahi ho raha" the nahi belongs to "band".
create or replace function sehat_ft_negated(p_tok text[], p_s int, p_e int)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  j int;
  v_fill text[] := array['me', 'mein', 'mai', 'main', 'ka', 'ki', 'ke', 'ko', 'se', 'pe', 'par', 'mera', 'meri', 'mere',
                         'dard', 'pain', 'hai', 'he', 'h', 'ho', 'hua', 'hui', 'raha', 'rahi', 'rahe', 'rha', 'rhi', 'rhe',
                         'koi', 'bhi', 'to', 'toh', 'is', 'have', 'has', 'a', 'any',
                         'में', 'मे', 'का', 'की', 'के', 'को', 'से', 'पर', 'दर्द', 'है', 'हो', 'रहा', 'रही', 'रहे', 'कोई', 'भी'];
begin
  for j in p_e + 1 .. least(coalesce(array_length(p_tok, 1), 0), p_e + 3) loop
    if exists (select 1 from negation_terms nt where nt.normalized_term = p_tok[j] and nt.negates in ('previous', 'both')) then return true; end if;
    exit when not (p_tok[j] = any (v_fill));
  end loop;
  for j in reverse p_s - 1 .. greatest(1, p_s - 3) loop
    if exists (select 1 from negation_terms nt where nt.normalized_term = p_tok[j] and nt.negates in ('next', 'both')) then return true; end if;
    exit when not (p_tok[j] = any (v_fill));
  end loop;
  return false;
end $$;
create or replace function sehat_ft_words_sim(p_term text, p_gram text)
returns numeric language sql immutable parallel safe as $$
  select case
    when coalesce(array_length(x.t, 1), 0) <> coalesce(array_length(x.g, 1), 0) then 0
    when array_length(x.t, 1) = 1 then similarity(p_term, p_gram)::numeric
    else (select min(case
                       when x.t[i] = x.g[i] then 1
                       when length(x.t[i]) <= 3 or length(x.g[i]) <= 3 then
                         case when x.t[i] = any (x.joins) and x.g[i] = any (x.joins) then 1
                              -- Hinglish drops vowels: nhi = nahi, rhi = rahi; dil ≠ daant.
                              when x.t[i] ~ '^[a-z]+$' and x.g[i] ~ '^[a-z]+$'
                               and regexp_replace(x.t[i], '[aeiou]', '', 'g') = regexp_replace(x.g[i], '[aeiou]', '', 'g')
                               and regexp_replace(x.t[i], '[aeiou]', '', 'g') <> '' then 0.9
                              else 0 end
                       else similarity(x.t[i], x.g[i]) end)::numeric
            from generate_subscripts(x.t, 1) i)
  end
  from (select string_to_array(p_term, ' ') as t, string_to_array(p_gram, ' ') as g,
               array['me', 'mein', 'mai', 'main', 'mei', 'ka', 'ki', 'ke', 'ko', 'se', 'par', 'pe', 'pr',
                     'में', 'मे', 'का', 'की', 'के', 'को', 'से', 'पर', 'पे'] as joins) x;
$$;

-- ── 7. The matcher ───────────────────────────────────────────────────────────
-- In order: emergency (exact or trigram ≥ 0.5, unless negated next to it —
-- false alarms are preferred to a miss); places and days (taken out first so a
-- town is never read as a symptom); then keywords, longest phrase first, exact
-- = full weight, trigram ≥ 0.45 = weight × similarity, words of 3 letters or
-- fewer exact only, a near-spelling only word by word (sehat_ft_words_sim),
-- skipped when negated (sehat_ft_negated).
-- Confidence = top score (capped at 1), reduced when a second intent or a
-- second speciality competes. Writes nothing; the callers log.
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

-- ── 8. Logging (every channel) ───────────────────────────────────────────────
create or replace function sehat_ft_log(p_channel text, p_text text, p_phone text, p_user uuid, m jsonb, p_search_log bigint default null)
returns bigint language sql security definer set search_path = public as $$
  insert into free_text_log (channel, phone_hash, user_id, raw_text, normalized_text,
    matched_intent, matched_speciality, matched_pin, matched_place, matched_when, time_window,
    secondary_intents, matched_terms, is_emergency, confidence, action, method, needs_review, bot_search_log_id)
  values (p_channel, sehat_ft_phone_hash(p_phone), p_user, left(p_text, 1000), m ->> 'normalized_text',
    m ->> 'intent', m ->> 'speciality', m ->> 'pincode', m ->> 'location', (m ->> 'target_date')::date, m ->> 'time_window',
    array(select jsonb_array_elements_text(coalesce(m -> 'secondary_intents', '[]'))),
    array(select jsonb_array_elements_text(coalesce(m -> 'matched_terms', '[]'))),
    coalesce((m ->> 'is_emergency')::boolean, false), (m ->> 'confidence')::numeric, m ->> 'action',
    case m ->> 'action' when 'menu' then 'fallback_menu' when 'confirm' then 'confirm' else 'rules' end,
    not coalesce((m ->> 'is_emergency')::boolean, false) and coalesce((m ->> 'confidence')::numeric, 0) < 0.7,
    p_search_log)
  returning id;
$$;

-- ── 9. WhatsApp: one call returns everything the flow needs ──────────────────
-- p_payload is '<PIN attribute>|<what they typed — may contain |>'.
-- route: 'emergency' | 'list' (numbered list, as the doctor/lab search) |
--        'info' (text only) | 'branch' (open that branch's first step) |
--        'ask_pin' | 'confirm' (हाँ / नहीं) | 'menu'.
-- search_type / filter_value / pincode are what the flow sends to the normal
-- search node when the patient says हाँ, or after it asks for the PIN.
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
  v_pin := m ->> 'pincode';
  v_branch := m ->> 'next_branch';
  -- What the normal search node takes for this branch.
  v_type := case v_branch when 'doctor_search' then 'doctor' when 'lab_booking' then 'lab_booking'
                          when 'medicine' then 'pharmacy' when 'ambulance' then 'ambulance' when 'camps' then 'camps' end;
  v_filter := case when v_branch = 'doctor_search' then m ->> 'speciality' else v_type end;

  if (m ->> 'is_emergency')::boolean then
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

-- The search node, as 0192, plus p_type 'text'. Keyed like 'medicine':
-- p_filter_value = '<flow key>|<PIN>|<text>', p_pincode = the contact's phone.
-- Without the key an emergency still gets 108 — nothing is logged.
create or replace function bot_generic_search_json(p_type text, p_filter_value text, p_pincode text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  r jsonb;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_val text;
begin
  -- 0201: what the patient typed.
  if v_type = 'text' then
    v_val := sehat_bot_keyed(p_filter_value);
    if v_val is null then
      r := match_message(array_to_string((string_to_array(coalesce(p_filter_value, ''), '|'))[3:], '|'), split_part(coalesce(p_filter_value, ''), '|', 2));
      return jsonb_build_object('found', false, 'route', case when (r ->> 'is_emergency')::boolean then 'emergency' else 'menu' end,
        'text', case when (r ->> 'is_emergency')::boolean then sehat_ft_fill('emergency', '{}') else sehat_ft_fill('menu', '{}') end);
    end if;
    return sehat_free_text_whatsapp(p_pincode, v_val);
  end if;

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

  -- 0188: hello / tips / rating, 0189: medicine, 0191: ambulance_request, 0192: insurance_lead — only with the flow key.
  if v_type in ('hello', 'tips', 'rating', 'medicine', 'ambulance_request', 'insurance_lead') then
    v_val := sehat_bot_keyed(p_filter_value);
    if v_val is null then
      -- An ambulance request without the key still gets the numbers: never leave an emergency empty-handed.
      if v_type = 'ambulance_request' then
        return jsonb_build_object('found', false, 'route', 'info', 'text', coalesce(bot_ambulance(split_part(coalesce(p_filter_value, ''), '|', 2)), 'Call 108.'));
      end if;
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
    elsif v_type = 'medicine' then
      r := sehat_create_medicine_order(p_pincode,
             split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 4),
             nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''),
             split_part(v_val, '|', 3), 'whatsapp_bot');
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    elsif v_type = 'ambulance_request' then
      begin
        r := sehat_create_ambulance_request(p_pincode,
               split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 3), split_part(v_val, '|', 4),
               nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''), 'whatsapp_bot');
      exception when others then
        r := jsonb_build_object('ok', false, 'text', coalesce(bot_ambulance(split_part(v_val, '|', 1)), 'Call 108.'));
      end;
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    elsif v_type = 'insurance_lead' then
      r := sehat_create_insurance_lead(p_pincode,
             split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 3), split_part(v_val, '|', 4),
             nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''), 'whatsapp_bot');
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    else
      r := bot_record_rating_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    end if;
  end if;

  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;

-- ── 10. The app ──────────────────────────────────────────────────────────────
-- Signed in (user_id logged) or a guest. 30 a minute per person; guests share
-- 300 a minute between them. The app maps next_branch to a screen itself.
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
  v_log := sehat_ft_log('app', p_text, null, v_uid, m);
  return m || jsonb_build_object('log_id', v_log);
end $$;

-- ── 11. Places the bot understands everywhere ────────────────────────────────
-- 0141 + the aliases, so "jagadri" typed into the PIN question works too.
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
      limit 1)
  );
$function$;

-- ── 12. Raw text for 90 days ─────────────────────────────────────────────────
create or replace function sehat_purge_free_text(p_days integer default 90)
returns integer language sql security definer set search_path = public as $$
  with x as (
    update free_text_log set raw_text = null, normalized_text = null, raw_purged_at = now()
     where raw_purged_at is null and created_at < now() - make_interval(days => p_days)
    returning 1)
  select count(*)::int from x;
$$;
do $$ begin
  begin perform cron.unschedule('purge-free-text');
  exception when others then null; end;
  perform cron.schedule('purge-free-text', '48 21 * * *', $job$ select public.sehat_purge_free_text(90) $job$);
end $$;

-- ── 13. Grants ───────────────────────────────────────────────────────────────
revoke all on function match_message(text, text) from public, anon, authenticated;
revoke all on function sehat_ft_log(text, text, text, uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function sehat_free_text_whatsapp(text, text) from public, anon, authenticated;
revoke all on function sehat_ft_phone_hash(text) from public, anon, authenticated;
revoke all on function sehat_ft_fill(text, jsonb) from public, anon, authenticated;
revoke all on function sehat_ft_negated(text[], int, int) from public, anon, authenticated;
revoke all on function sehat_purge_free_text(integer) from public, anon, authenticated;
revoke all on function sehat_match_text(text, text) from public;
grant execute on function sehat_match_text(text, text) to anon, authenticated;
grant execute on function bot_generic_search_json(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
