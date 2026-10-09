-- ============================================================================
-- 0218 — Sending on WhatsApp needs the WhatsApp add-on; email does not
-- ============================================================================
-- AFTER 0217. Safe to re-run.
--
-- Decided 9 Oct 2026: a clinic sends a prescription, bill or report the way it
-- chooses —
--
--   WhatsApp  only with the WhatsApp add-on on its plan, paid from the wallet
--             (0217). Without the add-on the button takes it to the plan.
--   Email     free, for every clinic, add-on or not.
--
--   sehat_wa_addon_blocker   why this clinic cannot send on WhatsApp, in words
--                            for the clinic; null when it can. The rules are
--                            the add-on's own (0116, 0122, 0157): not added,
--                            paused, ended past the grace days, or unpaid past
--                            them. Unlike a broadcast it does not wait on
--                            sending_enabled or on the clinic having a number
--                            of its own — these go from Sehatsandhi's number.
--   sehat_wallet_charge_direct  now asks it first, so no old copy of the app
--                            can send around the plan.
--   sehat_send_options       what a Send button shows before it is pressed:
--                            whether WhatsApp is open to this clinic, what a
--                            message costs, and what the wallet holds.
-- ============================================================================

create or replace function sehat_wa_addon_blocker(p_business uuid)
returns text
language sql stable security definer set search_path = public as $$
  with s as (select * from whatsapp_marketing_settings where id),
       a as (select * from business_wa_accounts where business_id = p_business)
  select case
    when not exists (select 1 from a) or (select subscription_status from a) = 'inactive'
      then 'Add WhatsApp to your plan to send on WhatsApp.'
    when (select subscription_status from a) = 'paused'
      then 'WhatsApp is paused for this clinic.'
    when (select next_billing_date from a) is not null
         and (select next_billing_date from a) + (select grace_days from s) < current_date
      then 'Your WhatsApp add-on has ended. Renew your plan with WhatsApp to send on WhatsApp.'
    when (select subscription_status from a) = 'past_due'
         and (select past_due_since from a) + make_interval(days => (select grace_days from s)) <= now()
      then 'Your WhatsApp fee is unpaid, so sending on WhatsApp is paused until it is paid.'
    else null
  end;
$$;
revoke all on function sehat_wa_addon_blocker(uuid) from public, anon, authenticated;
grant execute on function sehat_wa_addon_blocker(uuid) to service_role;

create or replace function sehat_wallet_charge_direct(p_business uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_block text;
  v_rate integer;
  v_balance integer;
  v_tx uuid;
begin
  v_block := sehat_wa_addon_blocker(p_business);
  if v_block is not null then
    return jsonb_build_object('ok', false, 'needs_plan', true, 'text', v_block);
  end if;

  select direct_message_paise into v_rate from whatsapp_marketing_settings where id;
  if v_rate is null then raise exception 'whatsapp_marketing_settings has no row'; end if;

  insert into business_wallets (business_id) values (p_business) on conflict do nothing;
  select balance_paise into v_balance from business_wallets where business_id = p_business for update;
  if v_balance < v_rate then
    return jsonb_build_object('ok', false, 'rate_paise', v_rate, 'balance_paise', v_balance);
  end if;

  update business_wallets set balance_paise = balance_paise - v_rate, updated_at = now()
   where business_id = p_business;
  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, note, created_by)
  values (p_business, 'message_send', -v_rate, v_balance - v_rate, left(coalesce(p_note, 'WhatsApp message'), 200), 'system')
  returning id into v_tx;

  return jsonb_build_object('ok', true, 'tx', v_tx, 'rate_paise', v_rate, 'balance_paise', v_balance - v_rate);
end $$;
revoke all on function sehat_wallet_charge_direct(uuid, text) from public, anon, authenticated;
grant execute on function sehat_wallet_charge_direct(uuid, text) to service_role;

-- Anyone working at the business may ask: the Send button is on the doctor's
-- and the desk's screens, not only the owner's. It tells them nothing but a
-- price and a balance.
create or replace function sehat_send_options(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if sehat_caller_role(p_business) is null and not sehat_is_admin() then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'whatsapp_blocker', sehat_wa_addon_blocker(p_business),
    'whatsapp_paise', (select direct_message_paise from whatsapp_marketing_settings where id),
    'balance_paise', coalesce((select balance_paise from business_wallets where business_id = p_business), 0));
end $$;
revoke all on function sehat_send_options(uuid) from public, anon, authenticated;
grant execute on function sehat_send_options(uuid) to authenticated;

notify pgrst, 'reload schema';
