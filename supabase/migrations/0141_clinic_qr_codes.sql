-- ============================================================================
-- Sehatsandhi — every business gets a QR code that brings patients to it
--
-- Run AFTER 0140. Safe to re-run.
--
-- Decided 26 Sep 2026. Each business has a short code, SS-XXXXX. Its QR poster
-- (and the OPD slip) opens WhatsApp to Sehatsandhi's bot number with the
-- message pre-filled: "Hi SS-7K3Q2 (SN Eye Glaucoma Center)". When a clinic
-- gets its own WhatsApp number (AiSensy partner plan), the QR switches to that
-- number; the code in the message stays the same, so printed posters work.
--
-- THE BOT: the code is accepted wherever the bot takes a speciality or an area.
-- bot_speciality_code('… SS-7K3Q2 …') returns 'SS-7K3Q2'; bot_pincode(same)
-- returns that clinic's own PIN; bot_bookable lists that clinic's doctors for
-- it. So the existing list → pick → slot → book chain books straight into the
-- clinic with no new API node. Until the AiSensy flow sends the code there,
-- a scan simply runs the normal flow.
--
-- OPT-IN: bot_clinic_optin(code, phone, name) registers the patient with that
-- clinic (source 'qr_reception') and records their WhatsApp marketing consent
-- for it — the tap on "Yes, send me updates" is the evidence. Wired up with the
-- AiSensy steps later.
-- ============================================================================

alter table businesses add column if not exists qr_code text;
create unique index if not exists businesses_qr_code_idx on businesses (qr_code);

create or replace function sehat_new_qr_code()
returns text
language plpgsql volatile as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v text;
begin
  loop
    v := 'SS-' || (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
                     from generate_series(1, 5));
    exit when not exists (select 1 from businesses where qr_code = v);
  end loop;
  return v;
end $$;

create or replace function sehat_business_qr_code()
returns trigger
language plpgsql as $$
begin
  if new.qr_code is null then new.qr_code := sehat_new_qr_code(); end if;
  return new;
end $$;

drop trigger if exists businesses_qr_code on businesses;
create trigger businesses_qr_code
  before insert on businesses
  for each row execute function sehat_business_qr_code();

update businesses set qr_code = sehat_new_qr_code() where qr_code is null;

-- ── The bot understands the code ────────────────────────────────────────────
-- 0046's speciality parser, with the clinic code checked first (a message such
-- as "Hi SS-7K3Q2 (SN Eye …)" also contains EYE).
create or replace function bot_speciality_code(p_value text)
returns text
language sql immutable as $function$
  select case
    when v.raw = '' then null
    when v.raw ~ 'SS-[A-Z0-9]{5}' then substring(v.raw from 'SS-[A-Z0-9]{5}')
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
$function$;

create or replace function bot_pincode(p_value text)
returns text
language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    -- A clinic code stands for that clinic's own place (0141).
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
      limit 1)
  );
$function$;

-- 0046/0110's list, with a clinic code listing that clinic's doctors.
create or replace function bot_bookable(p_kind text, p_filter text, p_pincode text)
returns table(rn integer, business_id uuid, practitioner_id uuid, title text, subtitle text, phone text, address text,
              consultation_fee integer, avg_rating numeric, total_reviews bigint, area text)
language sql stable security definer set search_path to 'public' as $function$
  with k as (
    select sehat_district_pin_codes(p_pincode) as pins, d.district_key, d.state_key
      from (select 1) one
      left join sehat_pin_district(p_pincode) d on true
  ),
  ranked as (
    select v.business_id, v.practitioner_id,
           v.full_name as title, v.business_name as subtitle,
           b.phone, b.address, v.consultation_fee,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at,
           case when p_filter like 'SS-%' then 1
                else sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                                       p_pincode, k.pins, k.district_key, k.state_key) end as near,
           b.own_city
      from public_practitioner_businesses v
      join businesses b on b.id = v.business_id
      left join rating_aggregate r on r.business_id = v.business_id
      cross join k
     where p_kind = 'doctor'
       and (v.speciality = p_filter or (p_filter like 'SS-%' and b.qr_code = p_filter))
    union all
    select b.id, null::uuid,
           b.name, null::text,
           b.phone, b.address, 0,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at,
           sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                             p_pincode, k.pins, k.district_key, k.state_key),
           b.own_city
      from businesses b
      left join rating_aggregate r on r.business_id = b.id
      cross join k
     where p_kind <> 'doctor'
       and b.vertical = p_filter
       and b.status = 'active'
  )
  select row_number() over (
           order by ranked.near,
                    coalesce(ranked.is_top_rated, false) desc,
                    ranked.avg_rating desc nulls last,
                    ranked.created_at desc nulls last,
                    ranked.business_id,
                    ranked.practitioner_id
         )::integer,
         ranked.business_id, ranked.practitioner_id,
         ranked.title, ranked.subtitle, ranked.phone, ranked.address,
         ranked.consultation_fee, ranked.avg_rating, ranked.total_reviews,
         case when ranked.near = 1 then nullif(btrim(ranked.own_city), '') end
    from ranked
   where ranked.near is not null
   order by 1
   limit 8;
$function$;

-- ── Opt-in from a QR scan ───────────────────────────────────────────────────
create or replace function bot_clinic_optin(p_code text, p_phone text, p_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text := substring(upper(coalesce(p_code, '')) from 'SS-[A-Z0-9]{5}');
  v_biz  record;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  v_patient uuid;
  v_member uuid;
begin
  select id, name into v_biz from businesses where qr_code = v_code and status = 'active';
  if v_biz.id is null then
    return jsonb_build_object('ok', false, 'text', 'यह QR कोड अभी सक्रिय नहीं है।');
  end if;
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'text', 'मोबाइल नंबर समझ नहीं आया।');
  end if;

  select id into v_patient from patients where phone = v_phone;
  if v_patient is null then
    insert into patients (phone, name, source) values (v_phone, v_name, 'qr_reception') returning id into v_patient;
  end if;
  select id into v_member from patient_members where patient_id = v_patient and is_self order by created_at limit 1;
  if v_member is null then
    insert into patient_members (patient_id, full_name, relation, is_self)
    values (v_patient, coalesce(v_name, 'WhatsApp patient'), 'self', true) returning id into v_member;
  end if;

  insert into business_patients (business_id, patient_member_id, source, source_detail)
  values (v_biz.id, v_member, 'qr_reception', v_code)
  on conflict (business_id, patient_member_id) do nothing;

  insert into patient_consents (patient_id, patient_member_id, business_id, phone, channel, action, basis,
                                evidence_ref, purpose)
  values (v_patient, v_member, v_biz.id, v_phone, 'whatsapp', 'granted', 'qr_optin', v_code, 'marketing');

  return jsonb_build_object('ok', true, 'business', v_biz.name,
    'text', 'धन्यवाद! अब आपको ' || v_biz.name || ' से WhatsApp पर अपडेट मिलेंगे। रुकने के लिए कभी भी STOP भेजें।');
end $$;
-- Like every bot_* function: the AiSensy node calls it with the service key.
revoke all on function bot_clinic_optin(text, text, text) from public, anon, authenticated;
grant execute on function bot_clinic_optin(text, text, text) to service_role;

notify pgrst, 'reload schema';
