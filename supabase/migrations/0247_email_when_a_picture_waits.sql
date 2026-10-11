-- ============================================================================
-- 0247 — An email when a picture broadcast is waiting for approval
-- ============================================================================
-- AFTER 0246. Safe to re-run.
--
-- Since 0238 only a picture broadcast waits for a reviewer, and it waits
-- until someone opens the admin panel. Sehatsandhi's admin address is now
-- emailed the moment one is submitted: the clinic, its words, the picture,
-- how many patients, and a link to approve or reject it.
-- ============================================================================

alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (kind = any (array[
  'business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite', 'nurse_unassigned',
  'wa_broadcast_rejected', 'signup_reminder', 'wa_broadcast_waiting']));

CREATE OR REPLACE FUNCTION public.sehat_create_wa_broadcast(p_business uuid, p_template uuid, p_params text[], p_members uuid[], p_pins text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_block text;
  v_tpl wa_message_templates;
  v_rate integer;
  v_count integer;
  v_cost integer;
  v_balance integer;
  v_tx uuid;
  v_b uuid;
begin
  if not sehat_caller_is_owner(p_business) then
    raise exception 'Only the clinic''s owner or manager can send broadcasts.' using errcode = '42501';
  end if;

  v_block := sehat_wa_broadcast_blocker(p_business);
  if v_block is not null then raise exception '%', v_block; end if;

  select * into v_tpl from wa_message_templates where id = p_template;
  if v_tpl.id is null or not v_tpl.is_active or not v_tpl.approved then
    raise exception 'That template is not available.';
  end if;
  -- {{1}} is the clinic name, so the clinic fills {{2}} onwards.
  if coalesce(array_length(p_params, 1), 0) <> greatest(cardinality(v_tpl.placeholders) - 1, 0)
     or exists (select 1 from unnest(p_params) x where btrim(x) = '') then
    raise exception 'Fill in every blank in the message.';
  end if;

  select per_message_paise into v_rate from whatsapp_marketing_settings where id;

  drop table if exists _aud;
  create temp table _aud on commit drop as
    select a.* from sehat_marketing_audience(p_business, p_pins) a
     where a.patient_member_id = any(p_members);
  select count(*) into v_count from _aud;
  if v_count = 0 then raise exception 'No patients selected.'; end if;
  v_cost := v_count * v_rate;

  -- Lock the wallet row so two broadcasts cannot both spend the same money.
  insert into business_wallets (business_id) values (p_business) on conflict do nothing;
  select balance_paise into v_balance from business_wallets
   where business_id = p_business for update;
  if v_balance < v_cost then
    raise exception 'Not enough balance: this needs ₹%, the wallet has ₹%. Top up to send.',
      to_char(v_cost / 100.0, 'FM999999990.00'), to_char(v_balance / 100.0, 'FM999999990.00');
  end if;

  update business_wallets set balance_paise = balance_paise - v_cost, updated_at = now()
   where business_id = p_business;

  insert into wa_broadcasts (business_id, template_id, params, pin_codes, recipient_count,
                             rate_paise, total_cost_paise, created_by)
  values (p_business, p_template, p_params, coalesce(p_pins, '{}'), v_count, v_rate, v_cost, auth.uid())
  returning id into v_b;

  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise,
                                            broadcast_id, note, created_by)
  values (p_business, 'message_send', -v_cost, v_balance - v_cost, v_b,
          v_count || ' × ' || v_tpl.name, auth.uid()::text)
  returning id into v_tx;
  update wa_broadcasts set wallet_transaction_id = v_tx where id = v_b;

  insert into wa_broadcast_recipients (broadcast_id, patient_member_id, phone)
  select v_b, patient_member_id, phone from _aud;

  -- 0238: only a template marked needs_review (a picture) waits for a person.
  -- The rest are wording Meta approved, with the clinic's blanks, and go out now.
  if not v_tpl.needs_review then
    update wa_broadcasts set status = 'queued', reviewed_at = now(),
           reviewed_by_label = 'No review needed — a set template'
     where id = v_b;
  else
    -- 0247: it waits on a person, so the person is told — by email, in case
    -- nobody is looking at the admin panel.
    insert into email_outbox (kind, business_id, payload)
    values ('wa_broadcast_waiting', p_business, jsonb_build_object(
      'broadcast_id', v_b, 'recipients', v_count, 'template', v_tpl.name,
      'words', array_to_string(p_params[1 : greatest(cardinality(p_params) - case when v_tpl.header_image then 1 else 0 end, 0)], ' · '),
      'picture', case when v_tpl.header_image then p_params[cardinality(p_params)] end));
  end if;

  return jsonb_build_object('broadcast_id', v_b, 'recipients', v_count,
                            'cost_paise', v_cost, 'balance_paise', v_balance - v_cost,
                            'status', case when v_tpl.needs_review then 'pending_approval' else 'queued' end);
end $function$;

notify pgrst, 'reload schema';
