-- 0205: privacy requests cover typed messages (0201's free_text_log).
--
-- 0174's lookup and nightly erasure, unchanged apart from free_text_log: the
-- lookup counts what a person typed to the WhatsApp bot or the app, and the
-- erasure deletes it — WhatsApp rows by the salted phone hash, app rows through
-- the person's app login. (After 90 days the text itself is already gone; the
-- erasure removes the rest of the row too.) And a limit for those rows: 24
-- months, which the Privacy Policy states.

create or replace function sehat_privacy_lookup(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r privacy_requests;
  v_hash text;
  v_members uuid[];
  v_out jsonb;
begin
  perform sehat_privacy_guard();
  select * into r from privacy_requests where id = p_id;
  if r.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  v_hash := case when r.phone is not null then sehat_phone_hash(r.phone) end;
  select array_agg(pm.id) into v_members from patient_members pm join patients p on p.id = pm.patient_id where p.phone = r.phone;

  v_out := jsonb_build_object(
    'patient', (select jsonb_build_object('name', p.name, 'since', p.created_at::date, 'area', coalesce(p.city, p.area, p.pin_code))
                  from patients p where p.phone = r.phone),
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', pm.full_name, 'relation', pm.relation) order by pm.is_self desc, pm.created_at)
                  from patient_members pm where pm.id = any(v_members)), '[]'::jsonb),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object('business_id', b.id, 'name', b.name, 'phone', b.phone,
               'forwarded', r.forwarded @> jsonb_build_array(jsonb_build_object('business_id', b.id)),
               'visits', (select count(*) from patient_visits v where v.business_id = b.id and v.patient_member_id = any(v_members)),
               'prescriptions', (select count(*) from prescriptions x where x.business_id = b.id and x.patient_member_id = any(v_members)),
               'bills', (select count(*) from patient_bills x where x.business_id = b.id and x.patient_member_id = any(v_members)),
               'appointments', (select count(*) from appointments a where a.business_id = b.id and (a.patient_member_id = any(v_members) or a.patient_phone = r.phone)))
             order by b.name)
        from businesses b
       where b.id in (select bp.business_id from business_patients bp where bp.patient_member_id = any(v_members)
                      union select a.business_id from appointments a where a.patient_phone = r.phone or a.patient_member_id = any(v_members))
    ), '[]'::jsonb),
    'platform', jsonb_build_object(
      'contact_messages', (select count(*) from contact_inquiries c where c.phone = r.phone or lower(c.email) = r.email),
      'messages_sent',    (select count(*) from message_log m where m.phone = r.phone),
      'notifications',    (select count(*) from notification_outbox n where n.phone = r.phone),
      'whatsapp_contact', (select count(*) from wa_contacts w where w.phone = r.phone),
      'whatsapp_sessions',(select count(*) from wa_sessions w where w.phone = r.phone),
      'typed_messages',   (select count(*) from free_text_log f
                            where r.phone is not null
                              and (f.phone_hash = sehat_ft_phone_hash(r.phone)
                                   or f.user_id in (select a.auth_uid from patient_app_accounts a
                                                     where right(a.phone, 10) = right(regexp_replace(r.phone, '\D', '', 'g'), 10)))),
      'ratings',          (select count(*) from ratings x where x.patient_phone_hash = v_hash),
      'insurance_leads',  (select count(*) from insurance_leads x where x.patient_phone = r.phone),
      'doctor_leads',     (select count(*) from doctor_leads x where x.phone = r.phone or lower(x.email) = r.email),
      'marketing_consents', (select count(*) from patient_consents c where c.phone = r.phone and c.purpose = 'marketing'
                               and c.action = 'granted' and sehat_has_consent(c.patient_member_id, 'marketing', c.business_id)),
      'opted_out',        exists (select 1 from opt_outs o where o.phone_hash = v_hash),
      'business_owner',   exists (select 1 from businesses b where b.phone = r.phone or lower(b.email) = r.email)
    )
  );
  insert into privacy_request_events (request_id, actor, action) values (p_id, sehat_privacy_actor(), 'looked up data');
  return v_out;
end $$;
revoke all on function sehat_privacy_lookup(uuid) from public, anon;
grant execute on function sehat_privacy_lookup(uuid) to authenticated;

create or replace function sehat_privacy_erase_one(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r privacy_requests;
  v_hash text;
  v_patient uuid;
  v_members uuid[];
  v_clinic boolean := false;
  v_res jsonb := '{}'::jsonb;
  n integer;
begin
  select * into r from privacy_requests where id = p_id;
  v_hash := case when r.phone is not null then sehat_phone_hash(r.phone) end;

  if r.phone is not null then
    -- Never contact them again: the STOP list keeps a one-way hash only.
    insert into opt_outs (phone_hash, channel, reason) values (v_hash, 'privacy_request', 'erasure ' || r.ref)
    on conflict (phone_hash) do nothing;
    update opt_outs set phone = null, patient_id = null where phone_hash = v_hash;

    delete from message_log where phone = r.phone;                       get diagnostics n = row_count; v_res := v_res || jsonb_build_object('messages_sent', n);
    delete from notification_outbox where phone = r.phone and status in ('sent', 'failed'); get diagnostics n = row_count; v_res := v_res || jsonb_build_object('notifications', n);
    delete from wa_contacts where phone = r.phone;                       get diagnostics n = row_count; v_res := v_res || jsonb_build_object('whatsapp_contact', n);
    delete from wa_sessions where phone = r.phone;                       get diagnostics n = row_count; v_res := v_res || jsonb_build_object('whatsapp_sessions', n);
    delete from phone_verifications where phone = r.phone;
    delete from login_codes where phone = r.phone;
    delete from insurance_leads where patient_phone = r.phone;           get diagnostics n = row_count; v_res := v_res || jsonb_build_object('insurance_leads', n);
    update ratings set review_text = null, patient_phone_hash = null where patient_phone_hash = v_hash;
                                                                          get diagnostics n = row_count; v_res := v_res || jsonb_build_object('ratings_unlinked', n);
    update unmet_demand_log set patient_phone_hash = null where patient_phone_hash = v_hash;
    -- 0205: what they typed to the bot or the app (0201) — by the salted hash
    -- (WhatsApp) and through their app login (app).
    delete from free_text_log
     where phone_hash = sehat_ft_phone_hash(r.phone)
        or user_id in (select a.auth_uid from patient_app_accounts a
                        where right(a.phone, 10) = right(regexp_replace(r.phone, '\D', '', 'g'), 10));
                                                                          get diagnostics n = row_count; v_res := v_res || jsonb_build_object('typed_messages', n);
  end if;

  delete from contact_inquiries where (r.phone is not null and phone = r.phone) or (r.email is not null and lower(email) = r.email);
                                                                          get diagnostics n = row_count; v_res := v_res || jsonb_build_object('contact_messages', n);
  delete from doctor_leads where (r.phone is not null and phone = r.phone) or (r.email is not null and lower(email) = r.email);
                                                                          get diagnostics n = row_count; v_res := v_res || jsonb_build_object('doctor_leads', n);

  if r.phone is not null then
    select id into v_patient from patients where phone = r.phone;
    if v_patient is not null then
      select array_agg(id) into v_members from patient_members where patient_id = v_patient;
      -- Anything a clinic holds (or any record of a clinic looking) keeps the
      -- patient row: that is the clinic's decision, not ours.
      v_clinic := exists (select 1 from business_patients where patient_member_id = any(v_members))
        or exists (select 1 from appointments where patient_member_id = any(v_members) or patient_phone = r.phone)
        or exists (select 1 from patient_visits where patient_member_id = any(v_members))
        or exists (select 1 from prescriptions where patient_member_id = any(v_members))
        or exists (select 1 from patient_bills where patient_member_id = any(v_members))
        or exists (select 1 from pharmacy_bills where patient_member_id = any(v_members))
        or exists (select 1 from lab_orders where patient_member_id = any(v_members))
        or exists (select 1 from patient_documents where patient_member_id = any(v_members))
        or exists (select 1 from admissions where patient_member_id = any(v_members))
        or exists (select 1 from patient_record_access where patient_member_id = any(v_members))
        or exists (select 1 from patient_members where merged_into = any(v_members));
      if v_clinic then
        -- Marketing consent is ours to withdraw even where the record stays.
        insert into patient_consents (patient_id, patient_member_id, business_id, phone, channel, action, basis, purpose, recorded_by, created_at)
        select distinct on (c.patient_member_id, c.business_id)
               c.patient_id, c.patient_member_id, c.business_id, r.phone, 'whatsapp', 'withdrawn', 'privacy_request', 'marketing', 'system:' || r.ref, clock_timestamp()
          from patient_consents c
         where c.phone = r.phone and c.purpose = 'marketing' and c.business_id is not null
           and sehat_has_consent(c.patient_member_id, 'marketing', c.business_id)
         order by c.patient_member_id, c.business_id, c.created_at desc;
        v_res := v_res || jsonb_build_object('patient_record', 'kept — held by clinics; forward the request to them');
      else
        delete from wa_broadcast_recipients where patient_member_id = any(v_members);
        update message_log set patient_id = null where patient_id = v_patient;
        update patient_import_rows set patient_id = null where patient_id = v_patient;
        delete from patients where id = v_patient;
        v_res := v_res || jsonb_build_object('patient_record', 'deleted');
      end if;
    end if;
  end if;
  return v_res;
end $$;
revoke all on function sehat_privacy_erase_one(uuid) from public, anon, authenticated;

-- The rest of a typed-message row (what it was understood as, no words — 0201
-- clears those at 90 days): 24 months, as the WhatsApp search logs.
do $$ begin
  begin perform cron.unschedule('purge-free-text-rows');
  exception when others then null; end;
  perform cron.schedule('purge-free-text-rows', '50 21 * * *',
    $job$ delete from public.free_text_log where created_at < now() - interval '24 months' $job$);
end $$;

notify pgrst, 'reload schema';
