-- ============================================================================
-- 0239 — A clinic's patients are on its broadcast list until they say STOP
-- ============================================================================
-- AFTER 0238. Safe to re-run.
--
-- 0116 put a patient on a clinic's broadcast list only after someone recorded
-- that they agreed — reception ticking a box, or the patient scanning the QR.
-- At a busy desk that does not happen: 3 of SN Eye's 80 patients were on it.
-- Decided 11 Oct 2026, on the founder's legal advice: a patient who gave the
-- clinic their number may be messaged by that clinic, every broadcast says how
-- to stop (the template's footer), and STOP takes them off.
--
--   • On the list: every active patient of the clinic, unless the newest word
--     on record for them and this clinic is 'withdrawn' or 'refused', or the
--     number has sent STOP (opt_outs).
--   • STOP writes a withdrawal for every clinic the number is a patient of.
--   • Back on: START (all that STOP ended), the clinic's "updates" button on
--     WhatsApp (that clinic), or the clinic recording that they asked.
-- Rating requests still need recorded agreement (sehat_has_consent), as before.
-- ============================================================================

create or replace function sehat_marketing_allowed(p_member uuid, p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.action not in ('withdrawn', 'refused')
      from patient_consents c
     where c.patient_member_id = p_member and c.purpose = 'marketing'
       and (c.business_id is null or c.business_id = p_business)
     order by c.created_at desc
     limit 1
  ), true);
$$;
revoke all on function sehat_marketing_allowed(uuid, uuid) from public, anon;
grant execute on function sehat_marketing_allowed(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sehat_marketing_audience(p_business uuid, p_pins text[] DEFAULT NULL::text[])
 RETURNS TABLE(patient_member_id uuid, full_name text, phone text, pin_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the clinic''s owner or manager can do this.' using errcode = '42501';
  end if;
  return query
  select distinct on (x.phone) x.member, x.name, x.phone, x.pin from (
    select m.id as member, m.full_name as name, p.phone, p.pin_code as pin, 0 as pri, m.is_self as self_first
      from business_patients bp
      join patient_members m on m.id = bp.patient_member_id
      join patients p on p.id = m.patient_id
     where bp.business_id = p_business
       and bp.status = 'active'
       and coalesce(m.status, 'active') = 'active'
       and p.phone ~ '^91[6-9][0-9]{9}$'
       and sehat_marketing_allowed(m.id, p_business)   -- 0239: on the list unless they said stop
    union all
    -- 0195: an insurance advisor reaches the people whose leads they accepted
    -- in the last 90 days — they asked to be contacted about cover.
    select null::uuid, l.patient_name, l.patient_phone, l.pincode, 1, true
      from insurance_leads l
     where l.agent_business_id = p_business and l.code is not null
       and l.status in ('accepted', 'contacted', 'won', 'lost')
       and l.accepted_at > now() - interval '90 days'
       and l.patient_phone ~ '^91[6-9][0-9]{9}$'
  ) x
   where not exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(x.phone))
     and (p_pins is null or cardinality(p_pins) = 0 or x.pin = any(p_pins))
   order by x.phone, x.pri, x.self_first desc nulls last, x.name;
end $function$;

CREATE OR REPLACE FUNCTION public.bot_opt_out(p_phone text, p_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_patient uuid;
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'text', 'मोबाइल नंबर समझ नहीं आया। / We could not read your number.');
  end if;
  select id into v_patient from patients where phone = v_phone;

  insert into opt_outs (phone_hash, phone, patient_id, channel, reason)
  values (sehat_phone_hash(v_phone), v_phone, v_patient, 'whatsapp',
          'STOP keyword' || coalesce(': ' || nullif(left(btrim(p_text), 60), ''), ''))
  on conflict (phone_hash) do nothing;

  -- A withdrawal row per clinic this number is a patient of (0239: every
  -- patient is on a clinic's list until they say stop), so the consent history
  -- says what happened and START can restore exactly these.
  -- clock_timestamp(), not now(): everything in one call shares now(), and
  -- the newest row decides, so a tie would be a coin toss.
  insert into patient_consents (patient_id, patient_member_id, business_id, phone, channel, action, basis, purpose, recorded_by, created_at)
  select distinct on (m.id, bp.business_id)
         p.id, m.id, bp.business_id, v_phone, 'whatsapp', 'withdrawn', 'stop_keyword', 'marketing', 'system:stop_keyword', clock_timestamp()
    from patients p
    join patient_members m on m.patient_id = p.id
    join business_patients bp on bp.patient_member_id = m.id
   where p.phone = v_phone and sehat_marketing_allowed(m.id, bp.business_id)
   order by m.id, bp.business_id;

  return jsonb_build_object('ok', true, 'text',
    'आपको अब किसी भी क्लिनिक से प्रचार वाले मैसेज और रेटिंग के अनुरोध नहीं आएंगे। अपॉइंटमेंट, पर्चे, बिल और रिपोर्ट के मैसेज आते रहेंगे। दोबारा शुरू करने के लिए START भेजें।'
    || E'\n\n' ||
    'You will no longer get promotional messages or rating requests from any clinic. Appointment, prescription, bill and report messages will continue. Send START to turn them back on.');
end $function$;

CREATE OR REPLACE FUNCTION public.bot_clinic_optin(p_code text, p_phone text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 0239: asking for one clinic's updates ends an earlier STOP — for this
  -- clinic only; the others keep the withdrawal STOP wrote for each.
  delete from opt_outs where phone_hash = sehat_phone_hash(v_phone);

  -- clock_timestamp(): the newest row decides, and this must be newer than a STOP's.
  insert into patient_consents (patient_id, patient_member_id, business_id, phone, channel, action, basis,
                                evidence_ref, purpose, created_at)
  select v_patient, m.id, v_biz.id, v_phone, 'whatsapp', 'granted', 'qr_optin', v_code, 'marketing', clock_timestamp()
    from patient_members m
   where m.id = v_member
      or (m.patient_id = v_patient and exists (select 1 from business_patients bp
                                                where bp.business_id = v_biz.id and bp.patient_member_id = m.id));

  return jsonb_build_object('ok', true, 'business', v_biz.name,
    'text', 'धन्यवाद! अब आपको ' || v_biz.name || ' से WhatsApp पर अपडेट मिलेंगे। रुकने के लिए कभी भी STOP भेजें।');
end $function$;

notify pgrst, 'reload schema';
