-- ============================================================================
-- Sehatsandhi — the backend the WhatsApp bot calls
--
-- Run AFTER 0043. Safe to re-run.
--
-- The AiSensy flow (6 branches + the booking path) is built and has nothing to
-- talk to. This is the Supabase half: the searches it runs, the two things it
-- writes, and the notification a booking owes the business.
--
-- NAMING: bot_* rather than sehat_*, against the convention every other
-- function here follows. These names are a contract with something outside this
-- repo — each is typed into an AiSensy API Request node — so they match the
-- bot spec exactly rather than matching us.
--
-- ── WHAT THE SPEC ASSUMED, AND WHAT IS ACTUALLY HERE ────────────────────────
--
-- The spec was written against the old `doctors` table, where a listing, a
-- person and a billing account were one row and a pharmacy was a "speciality".
-- 0037 split that into businesses / practitioners / business_practitioners, so
-- the two questions the spec said to confirm before implementing now have
-- different answers than it expected:
--
-- 1. WHAT IS STORED AS A SPECIALITY
--    practitioners.speciality, on the PERSON, holding the short code from
--    SPECIALITIES in src/types/index.ts: GEN, SKIN, DENT, EYE, PAED, GYN, IVF,
--    ORTH, CARD, ENT, GAST, NEUR, URO, ONC, PSY, DIAB, PHYS, ALT.
--
--    So an AiSensy list item must send 'SKIN', not 'Skin (Dermatology)' and not
--    the Hindi label. Because that fails SILENTLY — the exact trap the spec
--    warned about — bot_speciality_code() also accepts the English labels and
--    the obvious synonyms, and anything it cannot resolve is written to
--    unmet_demand_log so a mis-configured list item shows up as data instead of
--    as an empty answer nobody hears about.
--
--    This is also why searching for a doctor is a join and not a filter: the
--    speciality belongs to the person, the pincode belongs to the business, and
--    the fee belongs to the affiliation between them. Searching `businesses`
--    for a cardiologist would find only clinics whose signup happened to be
--    done by one.
--
-- 2. WHERE LABS AND PHARMACIES LIVE
--    businesses.vertical — its own column, lowercase:
--    clinic | hospital | pharmacy | lab | insurance | ambulance. NOT a
--    speciality code. 0037 is explicit that a pharmacy is not a speciality, and
--    0040 settled the spelling as 'clinic'.
--
--    CONSEQUENCE, AND IT IS A REAL LIMITATION: nothing records which tests a
--    lab actually performs. MRI, CT, Ultrasound and X-Ray all return every
--    active lab covering the pincode. Filtering by test type needs a column the
--    signup wizard would have to collect; until then the bot should name the
--    test in its own message so the patient can ask the lab directly.
--
-- ── WHERE THE SPEC'S SQL DOES NOT SURVIVE CONTACT WITH THE SCHEMA ───────────
--
--   • doctors.rating_avg does not exist. Ratings are in the rating_aggregate
--     view and are of the BUSINESS — the place a patient was seen (0041 says
--     why). The bot ranks as the website does: top-rated, then rating, then
--     newest.
--   • row_number() inside string_agg() is not legal SQL — a window function
--     cannot be an aggregate's argument. Numbering happens in a subquery.
--   • camps_offers has no dates_and_location column: date_from, date_to,
--     time_slot, and business_id since 0037.
--   • appointments.status is CHECK-constrained to
--     booked|confirmed|completed|cancelled|no_show, so a bot booking is
--     'booked'. 'pending' would be rejected outright.
--   • The writes return text, not void: the bot has to say something, and a
--     full slot has to come back as a sentence rather than a 500.
--
-- ── THE PART THE SPEC COULD NOT HAVE ANTICIPATED ────────────────────────────
-- The bot holds 4 custom attributes and none of them can hold an id, so "2" has
-- to be resolved server-side. bot_bookable() is the one ranked query, shared by
-- the search that prints the list and the resolver that reads the tap back,
-- with id breaking the last tie — the row the patient saw and the row we book
-- cannot come apart. It also carries BOTH ids: a doctor booking names a
-- practitioner at a business, a lab booking names only the business.
-- ============================================================================


-- ============================================================================
-- insurance_leads — a patient asked about cover, and someone must ring back.
--
-- The spec called this "the same pattern as doctor_leads". There is no
-- doctor_leads table; the nearest thing, unmet_demand_log, records a search
-- that found nothing. This is the opposite: a person who wants to be contacted.
-- That deserves its own table with a status, because the only failure mode that
-- matters is a lead nobody worked.
--
-- The phone is stored in the clear, unlike unmet_demand_log's hash: an agent
-- has to be able to dial it. The patient asked us to arrange the call, which is
-- an inbound service request, not marketing — see 0005 on why those two are
-- tracked separately and must not be conflated.
-- ============================================================================

create table if not exists insurance_leads (
  id uuid primary key default gen_random_uuid(),
  patient_phone text not null,             -- normalised: 91XXXXXXXXXX
  pincode text,
  source text default 'whatsapp_bot',
  status text default 'new',               -- new|contacted|closed
  agent_business_id uuid references businesses(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

do $$ begin
  alter table insurance_leads add constraint insurance_leads_status_check
    check (status in ('new','contacted','closed')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists insurance_leads_open_idx
  on insurance_leads (created_at desc) where status = 'new';

comment on table insurance_leads is
  'Patients who asked about health insurance on WhatsApp. Written only by '
  'bot_submit_insurance_lead(); read by admins. status is the follow-up state — '
  'a lead left at ''new'' is one nobody has rung.';

alter table insurance_leads enable row level security;

-- No policy for anon or authenticated. The RPC that inserts is SECURITY
-- DEFINER, so it does not need one, and a patient's phone number is not
-- something the anon key should be able to list.
drop policy if exists "admins_read_insurance_leads" on insurance_leads;
create policy "admins_read_insurance_leads" on insurance_leads
  for select using (sehat_is_admin());

drop policy if exists "admins_update_insurance_leads" on insurance_leads;
create policy "admins_update_insurance_leads" on insurance_leads
  for update using (sehat_is_admin()) with check (sehat_is_admin());


-- ============================================================================
-- Formatting helpers. The flow is Hindi, so dates are Hindi.
-- ============================================================================

create or replace function bot_hi_month(p_month integer)
returns text language sql immutable as $$
  select case p_month
    when 1 then 'जनवरी'  when 2  then 'फ़रवरी'  when 3  then 'मार्च'
    when 4 then 'अप्रैल' when 5  then 'मई'      when 6  then 'जून'
    when 7 then 'जुलाई'  when 8  then 'अगस्त'   when 9  then 'सितंबर'
    when 10 then 'अक्टूबर' when 11 then 'नवंबर' when 12 then 'दिसंबर'
  end;
$$;

create or replace function bot_hi_date(p_date date)
returns text language sql immutable as $$
  select case extract(dow from p_date)::int
           when 0 then 'रवि' when 1 then 'सोम' when 2 then 'मंगल' when 3 then 'बुध'
           when 4 then 'गुरु' when 5 then 'शुक्र' else 'शनि'
         end
      || ' ' || extract(day from p_date)::int
      || ' ' || bot_hi_month(extract(month from p_date)::int);
$$;

-- STABLE, not IMMUTABLE: to_char's output depends on DateStyle/lc_time.
create or replace function bot_hi_when(p_ts timestamptz)
returns text language sql stable as $$
  select bot_hi_date(d::date) || ' — ' || to_char(d, 'HH12:MI AM')
    from (select p_ts at time zone 'Asia/Kolkata' as d) s;
$$;

-- The public profile link, in the format links.ts builds and the resolver
-- matches: /doctor/<name-slug>-<first 8 of the id>. NOT /doctor/<id>, which the
-- spec assumed and which the resolver would not match.
--
-- This is the only place in the repo that names the domain. If the site ever
-- moves, it moves here.
create or replace function bot_profile_url(p_id uuid, p_name text)
returns text language sql immutable as $$
  select 'https://sehatsandhi.com/doctor/'
      || coalesce(
           nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''),
           'listing')
      || '-' || left(p_id::text, 8);
$$;


-- ============================================================================
-- Resolving what an AiSensy list item sent.
--
-- Two functions because 0037 split one concept into two: a speciality is what a
-- PERSON practises, a vertical is what a BUSINESS is. The old code smuggled
-- both into doctors.speciality, which is exactly what that migration set out to
-- stop — so nothing here maps 'PHARMACY' to a speciality.
-- ============================================================================

create or replace function bot_speciality_code(p_value text)
returns text language sql immutable as $$
  select case
    when v.raw = '' then null
    when v.raw in ('GEN','SKIN','DENT','EYE','PAED','GYN','IVF','ORTH','CARD',
                   'ENT','GAST','NEUR','URO','ONC','PSY','DIAB','PHYS','ALT') then v.raw
    when v.raw like '%DERMAT%'  or v.raw like 'SKIN%'                        then 'SKIN'
    when v.raw like '%DENTAL%'  or v.raw like '%DENTIST%'                    then 'DENT'
    when v.raw like '%OPHTHAL%' or v.raw like 'EYE%'                         then 'EYE'
    when v.raw like '%CHILD%'   or v.raw like '%DIATRIC%'                    then 'PAED'
    when v.raw like '%GYNAEC%'  or v.raw like '%GYNEC%' or v.raw like '%MATERNITY%' then 'GYN'
    when v.raw like '%IVF%'     or v.raw like '%FERTILIT%'                   then 'IVF'
    when v.raw like '%ORTHO%'   or v.raw like '%BONE%'                       then 'ORTH'
    when v.raw like '%CARDIO%'  or v.raw like '%HEART%'                      then 'CARD'
    when v.raw like 'ENT%'      or v.raw like '%EAR NOSE%'                   then 'ENT'
    when v.raw like '%GASTRO%'  or v.raw like '%STOMACH%'                    then 'GAST'
    when v.raw like '%NEURO%'   or v.raw like '%BRAIN%' or v.raw like '%SPINE%' then 'NEUR'
    when v.raw like '%UROLOG%'  or v.raw like '%KIDNEY%'                     then 'URO'
    when v.raw like '%ONCOLOG%' or v.raw like '%CANCER%'                     then 'ONC'
    when v.raw like '%PSYCH%'   or v.raw like '%MENTAL%'                     then 'PSY'
    when v.raw like '%DIABET%'                                               then 'DIAB'
    when v.raw like '%PHYSIO%'                                               then 'PHYS'
    when v.raw like '%AYURVED%' or v.raw like '%HOMEO%' or v.raw like '%UNANI%' then 'ALT'
    when v.raw like '%GENERAL%' or v.raw like '%FAMILY%' or v.raw like '%PHYSICIAN%' then 'GEN'
    else null
  end
  from (select upper(btrim(coalesce(p_value, ''))) as raw) v;
$$;

comment on function bot_speciality_code is
  'An AiSensy list value mapped to the code stored in practitioners.speciality. '
  'Configure list items with the code itself; the synonyms exist so a label '
  'sent by mistake still finds doctors instead of silently finding none. '
  'Returns null for a business vertical — a pharmacy is not a speciality.';

create or replace function bot_vertical_code(p_value text)
returns text language sql immutable as $$
  select case
    when v.raw = '' then null
    when v.raw in ('clinic','hospital','pharmacy','lab','insurance','ambulance') then v.raw
    when v.raw like '%pharmac%' or v.raw like '%chemist%'
      or v.raw like '%medical store%' or v.raw like '%medicine%'             then 'pharmacy'
    -- Every diagnostic ask lands on 'lab': there is no test-type column to
    -- narrow it with, so MRI and Blood Test find the same labs.
    when v.raw like '%diagnost%'  or v.raw like '%lab%'   or v.raw like '%blood%'
      or v.raw like '%test%'      or v.raw like '%mri%'   or v.raw like '%ct%'
      or v.raw like '%scan%'      or v.raw like '%ultrasound%' or v.raw like '%sono%'
      or v.raw like '%x-ray%'     or v.raw like '%xray%'                     then 'lab'
    when v.raw like '%ambulance%'                                            then 'ambulance'
    when v.raw like '%insur%'     or v.raw like '%policy%'                   then 'insurance'
    when v.raw like '%hospital%'                                             then 'hospital'
    else null
  end
  from (select lower(btrim(coalesce(p_value, ''))) as raw) v;
$$;

comment on function bot_vertical_code is
  'An AiSensy list value mapped to businesses.vertical. Lowercase, and '
  '''clinic'' not ''doctors'' — 0040 settled that spelling.';

-- Six digits, or nothing. City names are out of scope until there is
-- area-to-PIN data to resolve them with (spec §6), and an unmatched name must
-- not be searched as if it were a pincode.
create or replace function bot_pincode(p_value text)
returns text language sql immutable as $$
  select case when d ~ '^[1-9][0-9]{5}$' then d else null end
    from (select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g') as d) s;
$$;


-- ============================================================================
-- bot_bookable — the one ranked result set.
--
-- Shared by the search that prints the numbered list and by the resolver that
-- reads the tap back, so the two cannot disagree about who "2" is. Ranked as
-- SpecialityLanding ranks: top-rated first, then rating, then newest, with id
-- breaking the last tie so the order is stable between the two calls.
--
-- Carries both ids. A doctor booking is with a person AT a business; a lab
-- booking is with the business and nobody in particular, which is exactly what
-- appointments.practitioner_id being nullable is for.
--
-- p_kind 'doctor' filters on the practitioner's speciality; any other value is
-- read as a business vertical.
--
-- Capped at 8: a WhatsApp interactive list holds 10 rows, and the flow's own
-- speciality lists already spend 8-10 of them.
-- ============================================================================

create or replace function bot_bookable(p_kind text, p_filter text, p_pincode text)
returns table (
  rn integer, business_id uuid, practitioner_id uuid,
  title text, subtitle text, phone text, address text,
  consultation_fee integer, avg_rating numeric, total_reviews bigint
)
language sql stable security definer set search_path = public as $$
  with ranked as (
    -- A doctor: speciality is the person's, pincode is the business's, fee is
    -- the affiliation's. public_practitioner_businesses already joins the three
    -- and filters all of them to active.
    select v.business_id, v.practitioner_id,
           v.full_name as title, v.business_name as subtitle,
           b.phone, b.address, v.consultation_fee,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at
      from public_practitioner_businesses v
      join businesses b on b.id = v.business_id
      left join rating_aggregate r on r.business_id = v.business_id
     where p_kind = 'doctor'
       and v.speciality = p_filter
       and b.pin_codes @> array[p_pincode]::text[]
    union all
    -- A business in its own right: a lab, a pharmacy, an ambulance service.
    select b.id, null::uuid,
           b.name, null::text,
           b.phone, b.address, 0,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at
      from businesses b
      left join rating_aggregate r on r.business_id = b.id
     where p_kind <> 'doctor'
       and b.vertical = p_filter
       and b.status = 'active'
       and b.pin_codes @> array[p_pincode]::text[]
  )
  select row_number() over (
           order by coalesce(ranked.is_top_rated, false) desc,
                    ranked.avg_rating desc nulls last,
                    ranked.created_at desc nulls last,
                    ranked.business_id
         )::integer,
         ranked.business_id, ranked.practitioner_id,
         ranked.title, ranked.subtitle, ranked.phone, ranked.address,
         ranked.consultation_fee, ranked.avg_rating, ranked.total_reviews
    from ranked
   order by 1
   limit 8;
$$;

comment on function bot_bookable is
  'One ranked page of results for the bot: doctors of a speciality, or '
  'businesses of a vertical, covering a pincode. Shared by the search and the '
  'selection resolver — the number the patient taps must mean the same row in '
  'both.';


-- ============================================================================
-- 3.1 / 3.2 Doctor and lab search — the numbered list the booking path needs.
--
-- Returns null when there is nothing to show, which is the flow's signal to run
-- its "nobody yet — shall we tell you when someone joins?" branch. Every null
-- also writes an unmet_demand_log row with source 'bot', so the same report
-- that already shows unserved demand from the website now shows it from the
-- bot: that is what the empty answer is worth.
-- ============================================================================

create or replace function bot_search_bookable(p_kind text, p_filter text, p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin  text := bot_pincode(p_pincode);
  v_code text := case when p_kind = 'doctor'
                      then bot_speciality_code(p_filter)
                      else bot_vertical_code(coalesce(nullif(btrim(p_filter), ''), p_kind)) end;
  v_out  text;
begin
  if v_code is not null and v_pin is not null then
    select string_agg(l.line, E'\n\n' order by l.rn) into v_out
      from (
        select b.rn,
               b.rn || '. ' || b.title
            || case when coalesce(b.subtitle, '') not in ('', b.title)
                    then ' — ' || b.subtitle else '' end
            || case when b.avg_rating is not null
                    then ' (' || b.avg_rating || '★, ' || b.total_reviews || ' समीक्षाएँ)'
                    else ' (नया)' end
            || case when coalesce(b.consultation_fee, 0) > 0
                    then E'\n   फ़ीस ₹' || b.consultation_fee else '' end
            || E'\n   ' || bot_profile_url(b.business_id, coalesce(b.subtitle, b.title)) as line
          from bot_bookable(p_kind, v_code, v_pin) b
      ) l;
  end if;

  if v_out is null then
    -- Logged even when the input was unusable: a pincode field full of city
    -- names, or a list value that resolves to nothing, is worth seeing.
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot',
            coalesce(v_pin, nullif(left(btrim(coalesce(p_pincode, '')), 20), '')),
            coalesce(v_code, nullif(left(btrim(coalesce(p_filter, '')), 40), '')),
            false);
  end if;

  return v_out;
end $$;

create or replace function bot_search_doctors(p_speciality text, p_pincode text)
returns text language sql security definer set search_path = public as $$
  select bot_search_bookable('doctor', p_speciality, p_pincode);
$$;

comment on function bot_search_doctors is
  'Numbered, ranked doctors of a speciality in a pincode. Null means nothing to '
  'show — the flow runs its notify-me branch — and every null is recorded in '
  'unmet_demand_log as bot demand.';


-- ============================================================================
-- 3.3 Lab call-back, 3.4 pharmacy, 3.5 ambulance — read the phone number out,
-- no booking. These always return a sentence: there is no second branch in the
-- flow for them, so returning null would leave the patient with silence.
-- ============================================================================

create or replace function bot_partner_lines(p_vertical text, p_pincode text, p_limit integer default 5)
returns text language sql stable security definer set search_path = public as $$
  select string_agg(t.line, E'\n\n' order by t.rn)
    from (
      select b.rn,
             b.rn || '. ' || b.title
          || case when coalesce(b.phone, '') <> '' then E'\n   ☎ ' || b.phone else '' end
          || case when coalesce(b.address, '') <> '' then E'\n   ' || b.address else '' end as line
        from bot_bookable('business', p_vertical, p_pincode) b
       where b.rn <= greatest(p_limit, 1)
    ) t;
$$;

-- Shared shape for the three read-out branches: log the miss, say something
-- either way.
create or replace function bot_partner_answer(
  p_vertical text, p_pincode text, p_limit integer, p_lead text, p_empty text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin text := bot_pincode(p_pincode);
  v_out text;
begin
  if v_pin is not null then
    v_out := bot_partner_lines(p_vertical, v_pin, p_limit);
  end if;

  if v_out is null then
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot', coalesce(v_pin, nullif(left(btrim(coalesce(p_pincode, '')), 20), '')),
            p_vertical, false);
    return p_empty;
  end if;

  return p_lead || E'\n\n' || v_out;
end $$;

create or replace function bot_lab_callback(p_pincode text)
returns text language sql security definer set search_path = public as $$
  select bot_partner_answer('lab', p_pincode, 5,
    'ये लैब आपके क्षेत्र में सैंपल लेती हैं। कॉल करके टेस्ट का नाम बता दें:',
    'आपके पिनकोड में अभी कोई जांच पार्टनर नहीं है। '
    || 'हमारी टीम आपको WhatsApp पर संपर्क करेगी — कृपया टेस्ट का नाम यहीं भेज दें।');
$$;

create or replace function bot_pharmacy(p_pincode text)
returns text language sql security definer set search_path = public as $$
  select bot_partner_answer('pharmacy', p_pincode, 5,
    'ये दवाई की दुकानें आपके क्षेत्र में हैं:',
    'आपके पिनकोड में अभी कोई दवाई पार्टनर नहीं है। '
    || 'आप अपनी पर्ची यहीं भेज दें — हम पास की दुकान से मिलवाने की कोशिश करेंगे।');
$$;

-- The one branch where speed is the feature. Three numbers at most, phone
-- first, nothing else to read — and a fallback that is an actual ambulance
-- rather than an apology: 108 is the free government service, everywhere.
create or replace function bot_ambulance(p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin text := bot_pincode(p_pincode);
  v_out text;
begin
  if v_pin is not null then
    select string_agg(t.line, E'\n' order by t.rn) into v_out
      from (
        select b.rn, '🚑 ' || b.title
            || case when coalesce(b.phone, '') <> '' then ' — ☎ ' || b.phone else '' end as line
          from bot_bookable('business', 'ambulance', v_pin) b
         where b.rn <= 3
      ) t;
  end if;

  if v_out is null then
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot', coalesce(v_pin, nullif(left(btrim(coalesce(p_pincode, '')), 20), '')),
            'ambulance', false);
    return 'इस पिनकोड में हमारा कोई एम्बुलेंस पार्टनर नहीं है। '
        || 'कृपया तुरंत 108 पर कॉल करें — यह मुफ़्त सरकारी एम्बुलेंस सेवा है।';
  end if;

  return 'अभी कॉल करें:' || E'\n' || v_out
      || E'\n\nकोई जवाब न मिले तो 108 पर कॉल करें (मुफ़्त सरकारी एम्बुलेंस)।';
end $$;


-- ============================================================================
-- 3.7 Camps and offers — must always return something.
--
-- Real columns: title, description, services_offered, date_from, date_to,
-- time_slot, camp_type, and business_id since 0037. Only approved camps that
-- have not finished, matching what the public policy already publishes.
-- ============================================================================

create or replace function bot_camps_offers(p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin text := bot_pincode(p_pincode);
  v_out text;
begin
  if v_pin is not null then
    select string_agg(t.line, E'\n\n' order by t.date_from) into v_out
      from (
        select c.date_from,
               case when c.camp_type = 'free_camp' then '🏥 निःशुल्क कैंप — ' else '🎁 ऑफर — ' end
            || c.title
            || case when coalesce(b.name, '') <> '' then E'\n   ' || b.name else '' end
            || E'\n   ' || bot_hi_date(c.date_from)
            || case when c.date_to > c.date_from then ' से ' || bot_hi_date(c.date_to) || ' तक' else '' end
            || case when coalesce(c.time_slot, '') <> '' then ', ' || c.time_slot else '' end
            || case when coalesce(c.services_offered, '') <> ''
                    then E'\n   ' || left(c.services_offered, 120) else '' end as line
          from camps_offers c
          left join businesses b on b.id = c.business_id
         where c.status = 'approved'
           and c.date_to >= (now() at time zone 'Asia/Kolkata')::date
           and c.pin_codes @> array[v_pin]::text[]
         order by c.date_from
         limit 5
      ) t;
  end if;

  if v_out is null then
    return 'अभी आपके इलाके में कोई कैंप या ऑफर नहीं है। '
        || 'नया कैंप लगते ही हम आपको WhatsApp पर बता देंगे — '
        || 'तब तक डॉक्टर, दवाई या जांच के लिए मेन्यू में वापस जाएँ।';
  end if;

  return 'आपके क्षेत्र में ये कैंप और ऑफर चल रहे हैं:' || E'\n\n' || v_out;
end $$;


-- ============================================================================
-- 4. One node instead of six.
--
-- AiSensy caps API Request nodes at 5 on the current plan. This is the single
-- search node; the flow passes p_type as a literal on each branch, so no custom
-- attribute is spent carrying it.
--
-- p_filter_value is the speciality on the doctor branch and the test type on
-- the lab branches; it is ignored by the rest.
--
-- Return contract, which differs on purpose:
--   doctor / lab_booking  — numbered list, or NULL when empty (the flow branches
--                           into notify-me, and the miss is logged as demand)
--   everything else       — always a sentence, because those branches have
--                           nowhere else to go
-- ============================================================================

create or replace function bot_generic_search(
  p_type text,
  p_filter_value text,
  p_pincode text
) returns text language sql security definer set search_path = public as $$
  select case lower(btrim(coalesce(p_type, '')))
    when 'doctor'       then bot_search_bookable('doctor', p_filter_value, p_pincode)
    when 'lab_booking'  then bot_search_bookable('business', 'lab', p_pincode)
    when 'lab_callback' then bot_lab_callback(p_pincode)
    when 'pharmacy'     then bot_pharmacy(p_pincode)
    when 'ambulance'    then bot_ambulance(p_pincode)
    when 'camps'        then bot_camps_offers(p_pincode)
    else null
  end;
$$;

comment on function bot_generic_search is
  'The bot''s one search endpoint. p_type: doctor|lab_booking|lab_callback|'
  'pharmacy|ambulance|camps. Doctor and lab_booking return null when nothing '
  'matches; the others always return text.';


-- ============================================================================
-- 3.8 Slots, and the plumbing between "2" and somebody's diary.
--
-- Slot maths is not reimplemented. sehat_open_windows is the same source the
-- capacity trigger enforces against (0043 keeps the two reading availability
-- the same way), so what the bot offers and what the database accepts cannot
-- drift.
-- ============================================================================

-- The nth row from the same ranked search the patient read, as the pair of ids
-- a booking needs. Also accepts a business id, or a name, in case the flow is
-- configured to send either.
create or replace function bot_pick(p_kind text, p_filter text, p_pincode text, p_selection text)
returns table (business_id uuid, practitioner_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_pin  text := bot_pincode(p_pincode);
  v_code text := case when p_kind = 'doctor'
                      then bot_speciality_code(p_filter)
                      else bot_vertical_code(coalesce(nullif(btrim(p_filter), ''), p_kind)) end;
  v_sel  text := btrim(coalesce(p_selection, ''));
  v_n    integer;
begin
  if v_code is null or v_pin is null or v_sel = '' then return; end if;

  v_n := nullif(substring(v_sel from '^[0-9]+'), '')::integer;
  if v_n is not null then
    return query
      select b.business_id, b.practitioner_id
        from bot_bookable(p_kind, v_code, v_pin) b where b.rn = v_n;
    if found then return; end if;
  end if;

  -- A whole row title, a name, or an id pasted back.
  return query
    select b.business_id, b.practitioner_id
      from bot_bookable(p_kind, v_code, v_pin) b
     where v_sel ilike '%' || b.title || '%'
        or b.title ilike '%' || v_sel || '%'
        or b.business_id::text = v_sel
     order by b.rn
     limit 1;
end $$;

-- Open windows over the next few days, numbered. Capped at 10 (a WhatsApp list
-- holds no more) and never inside 30 minutes — a slot the patient cannot
-- physically reach is not an available slot.
create or replace function bot_slot_options(
  p_business_id uuid, p_practitioner_id uuid default null, p_days integer default 7
)
returns table (rn integer, slot_start timestamptz, label text)
language sql stable security definer set search_path = public as $$
  with days as (
    select ((now() at time zone 'Asia/Kolkata')::date + g) as d
      from generate_series(0, greatest(coalesce(p_days, 7), 1) - 1) g
  ),
  open_windows as (
    select w.window_start
      from days
      cross join lateral sehat_open_windows(p_business_id, days.d, p_practitioner_id) w
     where w.seats_left > 0
       and w.window_start > now() + interval '30 minutes'
  ),
  numbered as (
    select row_number() over (order by window_start)::integer as rn, window_start
      from open_windows
  )
  select n.rn, n.window_start, bot_hi_when(n.window_start)
    from numbered n
   where n.rn <= 10
   order by n.rn;
$$;

create or replace function bot_available_slots(
  p_speciality text, p_pincode text, p_selection text, p_type text default 'doctor'
) returns text language sql stable security definer set search_path = public as $$
  select string_agg(s.rn || '. ' || s.label, E'\n' order by s.rn)
    from bot_pick(case when p_type = 'lab_booking' then 'business' else 'doctor' end,
                  case when p_type = 'lab_booking' then 'lab' else p_speciality end,
                  p_pincode, p_selection) k
    cross join lateral bot_slot_options(k.business_id, k.practitioner_id) s;
$$;

comment on function bot_available_slots is
  'Numbered open windows for whichever row the patient tapped, from '
  'sehat_open_windows so the offer and the capacity check agree. Null means no '
  'free window in the next 7 days.';


-- ============================================================================
-- 3.9 Booking (WRITE)
--
-- Returns the confirmation to send, or the reason it could not book. Both are
-- sentences: an exception here would reach the patient as an AiSensy error
-- node, which says nothing useful and loses the booking.
-- ============================================================================

create or replace function bot_book_at(
  p_business_id uuid,
  p_practitioner_id uuid,
  p_patient_info text,          -- "Sunita, 34" — one attribute holding two fields
  p_slot_datetime timestamptz,
  p_phone text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_info  text := btrim(coalesce(p_patient_info, ''));
  v_name  text;
  v_age   integer;
  v_biz   record;
  v_who   text;
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

  -- Name the doctor when there is one, the business otherwise — the same choice
  -- 0039 made for the change notifications.
  select coalesce(
           (select p.full_name from practitioners p where p.id = p_practitioner_id),
           v_biz.name)
    into v_who;

  -- "Sunita, 34" and "Sunita 34" both happen, and so does a name with no age.
  v_name := nullif(btrim(split_part(v_info, ',', 1)), '');
  v_age  := nullif(substring(v_info from '([0-9]{1,3})[^0-9]*$'), '')::integer;
  if v_age is not null and (v_age < 1 or v_age > 120) then v_age := null; end if;
  if v_info not like '%,%' and v_age is not null then
    v_name := nullif(btrim(regexp_replace(v_name, '[0-9]{1,3}[^0-9]*$', '')), '');
  end if;

  insert into appointments (
    patient_phone, patient_name, patient_age, business_id, practitioner_id,
    slot_datetime, status, booked_via, last_actor, last_actor_detail
  ) values (
    v_phone, v_name, v_age, v_biz.id, p_practitioner_id,
    p_slot_datetime, 'booked', 'whatsapp_bot', 'patient', 'whatsapp_bot'
  );
  -- location_id is left to sehat_default_appointment_location, which puts the
  -- booking at the business's primary branch.

  return 'आपका अपॉइंटमेंट बुक हो गया ✅'
      || E'\n\n' || v_who
      || case when v_who <> v_biz.name then E'\n' || v_biz.name else '' end
      || E'\n' || bot_hi_when(p_slot_datetime)
      || case when coalesce(v_biz.address, '') <> '' then E'\n' || v_biz.address else '' end
      || E'\n\nकृपया 10 मिनट पहले पहुँचें। बदलाव के लिए यहीं मैसेज करें।';

exception
  -- sehat_check_appointment_capacity raises check_violation when the window
  -- filled between the list being shown and this call.
  when check_violation then
    return 'यह समय अभी-अभी भर गया। कृपया दूसरा समय चुनें।';
end $$;

-- What the flow calls: selection numbers, not ids and timestamps.
--
-- The slot is matched on its printed label first and only then on its number.
-- Labels are unambiguous; a number can shift if someone else books while the
-- patient is typing their name, and booking the wrong hour is worse than
-- asking again.
create or replace function bot_book_appointment(
  p_speciality text,
  p_pincode text,
  p_selection text,             -- Any_Selection: which row
  p_patient_info text,          -- customer_name: "Sunita, 34"
  p_slot_selection text,        -- slot_selection: "2" or the whole row title
  p_phone text,
  p_type text default 'doctor'  -- 'doctor' | 'lab_booking'
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
  v_pract    uuid;
  v_sel  text := btrim(coalesce(p_slot_selection, ''));
  v_slot timestamptz;
  v_n    integer;
begin
  select k.business_id, k.practitioner_id into v_business, v_pract
    from bot_pick(case when p_type = 'lab_booking' then 'business' else 'doctor' end,
                  case when p_type = 'lab_booking' then 'lab' else p_speciality end,
                  p_pincode, p_selection) k;

  if v_business is null then
    return 'आपका चयन समझ नहीं आया। कृपया सूची में से दोबारा चुनें।';
  end if;

  select s.slot_start into v_slot
    from bot_slot_options(v_business, v_pract) s
   where v_sel = s.label or v_sel like '%' || s.label || '%'
   order by s.rn
   limit 1;

  if v_slot is null then
    v_n := nullif(substring(v_sel from '^[0-9]+'), '')::integer;
    if v_n is not null then
      select s.slot_start into v_slot
        from bot_slot_options(v_business, v_pract) s
       where s.rn = v_n;
    end if;
  end if;

  if v_slot is null then
    return 'वह समय अब उपलब्ध नहीं है। कृपया सूची में से दोबारा समय चुनें।';
  end if;

  return bot_book_at(v_business, v_pract, p_patient_info, v_slot, p_phone);
end $$;


-- ============================================================================
-- 3.6 Insurance lead (WRITE)
--
-- Writes first, reads second: the lead is the point. Whether an agent covers
-- the pincode changes what we say, not whether we record that someone asked.
-- ============================================================================

create or replace function bot_submit_insurance_lead(p_phone text, p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_pin   text := bot_pincode(p_pincode);
  v_out   text;
begin
  if v_phone is null then
    return 'हमें आपका मोबाइल नंबर सही से नहीं मिला। कृपया 10 अंकों का नंबर भेजें।';
  end if;

  -- A patient who walks the branch twice is one lead, not two. Duplicates cost
  -- an agent a second call to someone they already rang.
  insert into insurance_leads (patient_phone, pincode, source, status)
  select v_phone, v_pin, 'whatsapp_bot', 'new'
   where not exists (
     select 1 from insurance_leads l
      where l.patient_phone = v_phone
        and l.status = 'new'
        and l.created_at > now() - interval '24 hours');

  if v_pin is not null then
    v_out := bot_partner_lines('insurance', v_pin, 3);
  end if;

  if v_out is null then
    return 'आपकी जानकारी दर्ज हो गई है। आपके पिनकोड में अभी कोई बीमा सलाहकार नहीं है — '
        || 'हमारी टीम आपसे WhatsApp पर संपर्क करेगी।';
  end if;

  return 'आपकी जानकारी दर्ज हो गई है। ये सलाहकार आपके क्षेत्र में हैं:'
      || E'\n\n' || v_out;
end $$;


-- ============================================================================
-- 5. The business learns about a booking without anyone remembering to tell it.
--
-- 0008 made audit and notification unskippable for every appointment CHANGE,
-- but its trigger is AFTER UPDATE — a new booking wrote nothing to
-- appointment_events and queued nothing to anybody. So the bot's whole purpose,
-- a patient arriving somewhere that expects them, rested on someone opening the
-- dashboard.
--
-- Same mechanism as 0008 rather than a new one: a row in notification_outbox,
-- drained by the appointment-notify edge function. A queue, because the
-- transaction that books cannot also guarantee an HTTP call.
--
-- Only the business is told, and only when the business is not the one who
-- booked. The patient already has the confirmation — the bot replied with it in
-- the same thread — and messaging them twice is how a helpful bot becomes an
-- annoying one. 0039 draws the same line for changes: tell the party who did
-- not do it.
-- ============================================================================

create or replace function sehat_appointment_booked()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  v_who text;
  v_phone text;
begin
  -- Imports and backfills land historic rows. Telling a business about an
  -- appointment that already happened is noise, not news.
  if new.slot_datetime is null or new.slot_datetime < now() then
    return new;
  end if;
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  insert into appointment_events (
    appointment_id, business_id, practitioner_id, event, actor, actor_detail,
    to_status, to_slot
  ) values (
    new.id, new.business_id, new.practitioner_id, 'booked',
    coalesce(new.last_actor, 'patient'),
    coalesce(new.last_actor_detail, new.booked_via),
    new.status, new.slot_datetime
  );

  -- A business booking at its own front desk does not need telling about it.
  if coalesce(new.last_actor, 'patient') in ('clinic', 'admin') then
    return new;
  end if;

  select coalesce(
           (select p.full_name from practitioners p where p.id = new.practitioner_id),
           b.name),
         b.phone
    into v_who, v_phone
    from businesses b where b.id = new.business_id;

  insert into notification_outbox (appointment_id, recipient, phone, event, payload)
  values (
    new.id, 'clinic', v_phone, 'booked',
    jsonb_build_object(
      'patient_name', new.patient_name,
      'patient_phone', new.patient_phone,
      'doctor_name', v_who,
      'new_slot', new.slot_datetime,
      'booked_via', new.booked_via
    )
  );

  return new;
end $$;

comment on function sehat_appointment_booked is
  'Queues the business''s "new appointment" message and its audit row, for '
  'every booking channel. Skips past-dated rows so an import cannot page a '
  'clinic about last month.';

drop trigger if exists appointments_booked on appointments;
create trigger appointments_booked after insert on appointments
  for each row execute function sehat_appointment_booked();


-- ============================================================================
-- 5. Asking for the rating, without waiting for anyone to mark a visit done.
--
-- Ratings were never requested because the request hung off an appointment
-- being marked 'completed', and nobody marks appointments completed. Time is
-- the better signal: three hours after the slot, the visit either happened or
-- it did not, and either way the patient can say.
--
-- Bounded to the last 7 days. The first run on a live database would otherwise
-- message every patient who ever booked, which is exactly the kind of blast
-- that costs a WhatsApp number its quality rating.
--
-- DO NOT SCHEDULE THIS YET. It asks a patient to reply with a score, and
-- nothing on the AiSensy side currently listens for that reply — so today it
-- would send a question into a flow that cannot write the ratings row it asks
-- for. The function is here, unscheduled, so that turning ratings on is one
-- cron line once the flow has that branch.
-- ============================================================================

create or replace function sehat_queue_rating_requests(p_hours integer default 3)
returns integer language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  insert into notification_outbox (appointment_id, recipient, phone, event, payload)
  select a.id, 'patient', a.patient_phone, 'rating_request',
         jsonb_build_object(
           'patient_name', a.patient_name,
           'doctor_name', coalesce(p.full_name, b.name),
           'new_slot', a.slot_datetime
         )
    from appointments a
    join businesses b on b.id = a.business_id
    left join practitioners p on p.id = a.practitioner_id
   where a.status in ('booked', 'confirmed', 'completed')
     and a.slot_datetime < now() - make_interval(hours => greatest(coalesce(p_hours, 3), 1))
     and a.slot_datetime > now() - interval '7 days'
     and coalesce(a.patient_phone, '') <> ''
     and not exists (select 1 from ratings r where r.appointment_id = a.id)
     and not exists (
       select 1 from notification_outbox o
        where o.appointment_id = a.id and o.event = 'rating_request')
     and not exists (
       select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(a.patient_phone));

  get diagnostics n = row_count;
  return n;
end $$;

comment on function sehat_queue_rating_requests is
  'Queues one rating request per visit whose slot passed p_hours ago, skipping '
  'anyone already rated, already asked, or opted out. Bounded to the last 7 '
  'days so the first run is not a blast. Not scheduled until the flow can '
  'receive the reply.';


-- ============================================================================
-- Who may call what.
--
-- Postgres grants EXECUTE to PUBLIC by default, so a write has to be revoked
-- from PUBLIC and not only from anon — revoking from anon alone leaves the
-- inherited PUBLIC grant in place, which is why sehat_wa_handle_inbound is
-- re-revoked here.
-- ============================================================================

-- Reads: the same posture as sehat_open_windows. These return what an active
-- listing already publishes to anyone holding the anon key.
grant execute on function bot_hi_month(integer)                        to anon, authenticated;
grant execute on function bot_hi_date(date)                            to anon, authenticated;
grant execute on function bot_hi_when(timestamptz)                     to anon, authenticated;
grant execute on function bot_profile_url(uuid, text)                  to anon, authenticated;
grant execute on function bot_speciality_code(text)                    to anon, authenticated;
grant execute on function bot_vertical_code(text)                      to anon, authenticated;
grant execute on function bot_pincode(text)                            to anon, authenticated;
grant execute on function bot_bookable(text, text, text)               to anon, authenticated;
grant execute on function bot_search_bookable(text, text, text)        to anon, authenticated;
grant execute on function bot_search_doctors(text, text)               to anon, authenticated;
grant execute on function bot_partner_lines(text, text, integer)       to anon, authenticated;
grant execute on function bot_partner_answer(text, text, integer, text, text) to anon, authenticated;
grant execute on function bot_lab_callback(text)                       to anon, authenticated;
grant execute on function bot_pharmacy(text)                           to anon, authenticated;
grant execute on function bot_ambulance(text)                          to anon, authenticated;
grant execute on function bot_camps_offers(text)                       to anon, authenticated;
grant execute on function bot_generic_search(text, text, text)         to anon, authenticated;
grant execute on function bot_pick(text, text, text, text)             to anon, authenticated;
grant execute on function bot_slot_options(uuid, uuid, integer)        to anon, authenticated;
grant execute on function bot_available_slots(text, text, text, text)  to anon, authenticated;

-- Writes: service role only. Both create records that cost someone money or
-- time to work, and neither should be callable by anyone holding the anon key
-- that ships in the website bundle.
revoke all on function bot_book_at(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function bot_book_appointment(text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function bot_submit_insurance_lead(text, text)
  from public, anon, authenticated;
revoke all on function sehat_queue_rating_requests(integer)
  from public, anon, authenticated;
revoke all on function sehat_wa_handle_inbound(text, text, text, text, text, text)
  from public, anon, authenticated;


-- ============================================================================
-- CONFIGURING THE AiSensy SIDE
--
-- Four API Request nodes, one under the cap of five:
--
--   1. search   POST /rest/v1/rpc/bot_generic_search        anon key
--        {"p_type": "doctor", "p_filter_value": "SKIN", "p_pincode": "{{Any_Pincode}}"}
--        p_type is a literal per branch: doctor | lab_booking | lab_callback |
--        pharmacy | ambulance | camps. A null response on the doctor and
--        lab_booking branches is the notify-me path.
--
--   2. slots    POST /rest/v1/rpc/bot_available_slots       anon key
--        {"p_speciality": "SKIN", "p_pincode": "{{Any_Pincode}}",
--         "p_selection": "{{Any_Selection}}", "p_type": "doctor"}
--
--   3. book     POST /rest/v1/rpc/bot_book_appointment      SERVICE ROLE key
--        {"p_speciality": "SKIN", "p_pincode": "{{Any_Pincode}}",
--         "p_selection": "{{Any_Selection}}", "p_patient_info": "{{customer_name}}",
--         "p_slot_selection": "{{slot_selection}}", "p_phone": "{{contact.phone}}",
--         "p_type": "doctor"}
--
--   4. insurance POST /rest/v1/rpc/bot_submit_insurance_lead SERVICE ROLE key
--        {"p_phone": "{{contact.phone}}", "p_pincode": "{{Any_Pincode}}"}
--
-- On the MRI/CT/Ultrasound/X-Ray branch send p_type 'lab_booking' to all three
-- of search, slots and book. p_speciality is then ignored.
--
-- Spend no custom attribute on the speciality: it is a literal in each branch's
-- request body, which keeps the flow at the four attributes it uses today.
--
-- Set each speciality list item's VALUE to the code (SKIN, CARD, GEN …); the
-- Hindi label is display text and is never sent.
--
-- SCHEDULING (pg_cron, alongside the jobs 0005 and 0008 describe):
--   Nothing new for booking notifications — 'booked' rows are drained by the
--   appointment-notify job 0008 already describes.
--
--   Rating requests, ONLY once the flow can receive a 1-5 reply and write it
--   to ratings:
--     select cron.schedule('queue-rating-requests', '0 * * * *',
--       $$select sehat_queue_rating_requests()$$);
-- ============================================================================
