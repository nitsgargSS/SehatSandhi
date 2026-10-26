-- ============================================================================
-- 0268 — A broadcast's test message uses a free message first
-- ============================================================================
-- Decided 26 Oct 2026. Before a clinic sends a broadcast it can send itself
-- one test, to its own number. That was charged from the wallet at the
-- broadcast price even while the month's free messages (0259) were unused —
-- which put clinics off checking before they send. Now a test takes one of
-- this month's free messages while there are any, and the wallet only after.
-- Broadcasts themselves are unchanged: always from the wallet.
--
-- The limit stays ten tests a day, counting free and paid ones together. A
-- test WhatsApp does not accept is given back as before
-- (sehat_wallet_refund_direct handles a free one too).
-- ============================================================================

create or replace function sehat_wa_test_prepare(p_business uuid, p_template uuid, p_params text[], p_phone text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
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
  v_free uuid;
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
    -- Ten a day, whether they were free or paid.
    select (select count(*) from business_wallet_transactions
             where business_id = p_business and type = 'message_send' and broadcast_id is null
               and note like 'Test: %' and created_at > now() - interval '24 hours')
         + (select count(*) from wa_free_uses
             where business_id = p_business and note like 'Test: %' and refunded_at is null
               and created_at > now() - interval '24 hours')
      into v_today;
    if v_today >= 10 then raise exception 'That is enough tests for today.' using errcode = 'P0001'; end if;

    -- 0268: a free message of this month first (0259); the wallet only once they are used up.
    v_free := sehat_wa_free_take(p_business, 'Test: ' || v_tpl.name);
    if v_free is not null then
      return jsonb_build_object(
        'to', '91' || v_phone,
        'meta_name', coalesce(v_tpl.meta_name, v_tpl.code), 'meta_language', v_tpl.meta_language,
        'params', to_jsonb(array[v_biz.name] || coalesce(p_params, '{}')),
        'tx', v_free, 'charged_paise', 0, 'free', true);
    end if;

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
    'params', to_jsonb(array[v_biz.name] || coalesce(p_params, '{}')),
    'tx', v_tx, 'charged_paise', coalesce(v_rate, 0));
end $$;
revoke all on function sehat_wa_test_prepare(uuid, uuid, text[], text) from public, anon, authenticated;
grant execute on function sehat_wa_test_prepare(uuid, uuid, text[], text) to authenticated;
