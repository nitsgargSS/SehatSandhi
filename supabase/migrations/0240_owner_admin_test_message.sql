-- ============================================================================
-- 0240 — The clinic's own test button works for an owner who is also an admin
-- ============================================================================
-- AFTER 0239. Safe to re-run.
--
-- sehat_wa_test_prepare treated any Sehatsandhi admin as staff, who must name
-- the phone to test on. The clinic's form names none — it sends to the
-- clinic's own number — so an admin who owns a clinic got "Enter a 10-digit
-- mobile number for the test" with nowhere to enter one.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sehat_wa_test_prepare(p_business uuid, p_template uuid, p_params text[], p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- 0240: a Sehatsandhi admin who also owns this clinic, pressing the clinic's
  -- own test button (no number given), is the clinic: charged, sent to its number.
  v_staff boolean := sehat_is_staff()
                     and (btrim(coalesce(p_phone, '')) <> '' or not sehat_caller_is_owner(p_business));
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

notify pgrst, 'reload schema';
