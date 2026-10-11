-- ============================================================================
-- 0235 — Broadcasts in Hindi, and a broadcast with a picture
-- ============================================================================
-- AFTER 0234. Safe to re-run.
--
-- Decided 11 Oct 2026.
--
-- HINDI. Each of the nine broadcast templates gets a Hindi twin: the same
-- blanks, Hindi words around them. At Meta it is the same template name in
-- language 'hi' (meta_name, meta_language), so the library row is
-- '<code>_hi'. Not offered to clinics until Meta approves each
-- (scripts/wa-templates.py) and it is ticked approved.
--
-- A PICTURE. 'clinic_image' (and '_hi'): the clinic uploads one JPG or PNG —
-- a camp poster, a greeting card — and writes a line; the message arrives as
-- the picture with "A message from <clinic>: …" under it.
--   • wa_message_templates.header_image marks such a template. Its LAST
--     placeholder is the picture: the clinic's params end with the file's path
--     in the public bucket 'wa-broadcast-images', under <business id>/. The
--     words before it fill the body as usual, so everything that counts and
--     previews params goes on working.
--   • the bucket is public because the picture is, by its purpose, sent to
--     patients; only the business's own staff may put a file under its id.
--     5 MB, JPG or PNG — WhatsApp's own limit for a picture.
--   • a broadcast on a picture template is refused without a picture of that
--     business's own.
-- Sehatsandhi still reads every broadcast, and now sees its picture, before
-- it goes out.
-- ============================================================================

alter table wa_message_templates add column if not exists header_image boolean not null default false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wa-broadcast-images', 'wa-broadcast-images', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png'];

drop policy if exists wa_broadcast_images_write on storage.objects;
create policy wa_broadcast_images_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wa-broadcast-images'
              and sehat_caller_owns_business(((storage.foldername(name))[1])::uuid));
drop policy if exists wa_broadcast_images_delete on storage.objects;
create policy wa_broadcast_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'wa-broadcast-images'
         and sehat_caller_owns_business(((storage.foldername(name))[1])::uuid));

-- A picture template's broadcast carries a picture of that business's own.
create or replace function sehat_wa_broadcast_needs_its_picture()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_path text := new.params[array_upper(new.params, 1)];
begin
  if not coalesce((select t.header_image from wa_message_templates t where t.id = new.template_id), false) then return new; end if;
  if v_path is null or v_path !~ ('^' || new.business_id::text || '/[A-Za-z0-9._-]+\.(jpg|jpeg|png)$') then
    raise exception 'Choose a JPG or PNG picture to send with this message.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists wa_broadcast_picture on wa_broadcasts;
create trigger wa_broadcast_picture before insert on wa_broadcasts
  for each row execute function sehat_wa_broadcast_needs_its_picture();

-- The test message says whether the template carries a picture.
CREATE OR REPLACE FUNCTION public.sehat_wa_test_prepare(p_business uuid, p_template uuid, p_params text[], p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff boolean := sehat_is_staff();
  v_tpl wa_message_templates;
  v_biz businesses;
  v_phone text;
  v_block text;
  v_rate integer;
  v_balance integer;
  v_tx uuid;
  v_today integer;
begin
  if not (v_staff or sehat_caller_is_owner(p_business)) then
    raise exception 'Only the clinic''s owner can send a test.' using errcode = '42501';
  end if;
  select * into v_tpl from wa_message_templates where id = p_template;
  if v_tpl.id is null or not v_tpl.is_active or not v_tpl.approved then
    raise exception 'That message is not available yet.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_params, 1), 0) <> greatest(cardinality(v_tpl.placeholders) - 1, 0)
     or exists (select 1 from unnest(p_params) x where btrim(x) = '') then
    raise exception 'Fill in every blank in the message.' using errcode = 'P0001';
  end if;
  select * into v_biz from businesses where id = p_business;

  if v_staff then
    v_phone := sehat_norm_phone(coalesce(p_phone, ''));
  else
    v_phone := sehat_norm_phone(coalesce(v_biz.phone, ''));
    v_block := sehat_wa_addon_blocker(p_business);
    if v_block is not null then raise exception '%', v_block using errcode = 'P0001'; end if;
  end if;
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception '%', case when v_staff then 'Enter a 10-digit mobile number for the test.'
                              else 'Your clinic has no mobile number on its profile to send the test to.' end using errcode = 'P0001';
  end if;

  if not v_staff then
    select count(*) into v_today from business_wallet_transactions
     where business_id = p_business and type = 'message_send' and broadcast_id is null
       and note like 'Test: %' and created_at > now() - interval '24 hours';
    if v_today >= 10 then raise exception 'That is enough tests for today.' using errcode = 'P0001'; end if;

    select per_message_paise into v_rate from whatsapp_marketing_settings where id;
    insert into business_wallets (business_id) values (p_business) on conflict do nothing;
    select balance_paise into v_balance from business_wallets where business_id = p_business for update;
    if v_balance < v_rate then
      raise exception 'A test costs ₹%, and the wallet has ₹%. Top up to send it.',
        to_char(v_rate / 100.0, 'FM999990.00'), to_char(v_balance / 100.0, 'FM999990.00') using errcode = 'P0001';
    end if;
    update business_wallets set balance_paise = balance_paise - v_rate, updated_at = now() where business_id = p_business;
    insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, note, created_by)
    values (p_business, 'message_send', -v_rate, v_balance - v_rate, 'Test: ' || v_tpl.name, auth.uid()::text)
    returning id into v_tx;
  end if;

  return jsonb_build_object(
    'to', '91' || v_phone,
    'meta_name', coalesce(v_tpl.meta_name, v_tpl.code), 'meta_language', v_tpl.meta_language,
    'header_image', v_tpl.header_image,
    'params', to_jsonb(array[v_biz.name] || coalesce(p_params, '{}')),
    'tx', v_tx, 'charged_paise', coalesce(v_rate, 0));
end $function$;

-- ── The library ─────────────────────────────────────────────────────────────
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'appointment_reminder_hi', t.name || ' — हिंदी', t.category, 'नमस्ते, {{1}} की ओर से। यह आपकी फ़ॉलो-अप विज़िट बुक करने का रिमाइंडर है। {{2}} बुक करने के लिए यहीं जवाब दें या हमें कॉल करें।', t.placeholders, false, t.sort_order + 5, 'appointment_reminder', 'hi'
  from wa_message_templates t where t.code = 'appointment_reminder'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'clinic_notice_hi', t.name || ' — हिंदी', t.category, 'नमस्ते, {{1}} की ओर से। कृपया ध्यान दें: {{2}} धन्यवाद।', t.placeholders, false, t.sort_order + 5, 'clinic_notice', 'hi'
  from wa_message_templates t where t.code = 'clinic_notice'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'health_camp_hi', t.name || ' — हिंदी', t.category, 'नमस्ते, {{1}} की ओर से। हम {{2}} का आयोजन कर रहे हैं — {{3}}, स्थान: {{4}}। आप सभी का स्वागत है।', t.placeholders, false, t.sort_order + 5, 'health_camp', 'hi'
  from wa_message_templates t where t.code = 'health_camp'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'new_service_hi', t.name || ' — हिंदी', t.category, 'नमस्ते, {{1}} की ओर से। अब हमारे यहाँ {{2}} की सुविधा उपलब्ध है। अधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।', t.placeholders, false, t.sort_order + 5, 'new_service', 'hi'
  from wa_message_templates t where t.code = 'new_service'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'health_advice_hi', t.name || ' — हिंदी', t.category, 'सेहत की सलाह, {{1}} की ओर से: {{2}} स्वस्थ रहें।', t.placeholders, false, t.sort_order + 5, 'health_advice', 'hi'
  from wa_message_templates t where t.code = 'health_advice'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'festival_greeting_hi', t.name || ' — हिंदी', t.category, 'नमस्ते, {{1}} की ओर से। आपको और आपके परिवार को {{2}} की हार्दिक शुभकामनाएँ। {{3}} सादर।', t.placeholders, false, t.sort_order + 5, 'festival_greeting', 'hi'
  from wa_message_templates t where t.code = 'festival_greeting'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'new_speciality_hi', t.name || ' — हिंदी', t.category, 'नमस्ते, {{1}} की ओर से। हमारे यहाँ अब {{2}} शुरू हो गया है। {{3}} अधिक जानकारी या बुकिंग के लिए यहीं जवाब दें।', t.placeholders, false, t.sort_order + 5, 'new_speciality', 'hi'
  from wa_message_templates t where t.code = 'new_speciality'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'new_doctor_hi', t.name || ' — हिंदी', t.category, 'नमस्ते, {{1}} की ओर से। {{2}} ({{3}}) हमारे साथ जुड़ गए हैं और {{4}} उपलब्ध हैं। अपॉइंटमेंट के लिए यहीं जवाब दें।', t.placeholders, false, t.sort_order + 5, 'new_doctor', 'hi'
  from wa_message_templates t where t.code = 'new_doctor'
on conflict (code) do nothing;
insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language)
select 'clinic_message_hi', t.name || ' — हिंदी', t.category, 'संदेश, {{1}} की ओर से: {{2}} बुकिंग या किसी सवाल के लिए यहीं जवाब दें।', t.placeholders, false, t.sort_order + 5, 'clinic_message', 'hi'
  from wa_message_templates t where t.code = 'clinic_message'
on conflict (code) do nothing;

insert into wa_message_templates (code, name, category, body, placeholders, approved, sort_order, meta_name, meta_language, header_image) values
  ('clinic_image', 'A picture with your message', 'marketing',
   'A message from {{1}}: {{2}} To book or to ask a question, reply here.',
   array['Clinic name', 'Your message — one paragraph. Sehatsandhi reads it before it goes out.', 'Picture — JPG or PNG, up to 5 MB'],
   false, 100, 'clinic_image', 'en', true),
  ('clinic_image_hi', 'A picture with your message — हिंदी', 'marketing',
   'संदेश, {{1}} की ओर से: {{2}} बुकिंग या किसी सवाल के लिए यहीं जवाब दें।',
   array['Clinic name', 'Your message — one paragraph. Sehatsandhi reads it before it goes out.', 'Picture — JPG or PNG, up to 5 MB'],
   false, 105, 'clinic_image', 'hi', true)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
