-- ============================================================================
-- Sehatsandhi — the owner's side stays the owner's; the owner can see bills;
--               the owner can switch on the in-house pharmacy
--
-- Run AFTER 0180. Safe to re-run.
--
-- Decided 30 Sep 2026: a manager runs the clinic floor (0180) but not the
-- account. Owner only from now on:
--   • the plan — paying, renewing, renewal choices, auto-renew, add-ons (the
--     edge functions that take money check the same);
--   • WhatsApp marketing — the account, wallet, broadcasts and audience;
--   • the Sehatsandhi tax invoices (Bills);
--   • marking or cancelling another doctor's leave (a doctor still marks their own).
--
-- Found on the way: Bills showed nothing to anyone. The business read rule on
-- invoices (0025) was dropped by a rename and never replaced, so only admins
-- could read them. The owner can again.
--
-- And: the in-house pharmacy (0158) could only be switched on by a Sehatsandhi
-- admin. The owner may now switch it on or off (free, like Heart tests & X-ray);
-- the owner, a manager or a doctor then keeps the stock and bills from it.
-- ============================================================================

create or replace function sehat_caller_is_owner(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(sehat_caller_role(p_business) = 'owner', false);
$$;
revoke all on function sehat_caller_is_owner(uuid) from public, anon;
grant execute on function sehat_caller_is_owner(uuid) to authenticated;

-- ── Bills ───────────────────────────────────────────────────────────────────
drop policy if exists "owner_reads_own_invoices" on invoices;
create policy "owner_reads_own_invoices" on invoices
  for select using (sehat_caller_is_owner(business_id));

-- ── WhatsApp marketing ──────────────────────────────────────────────────────
drop policy if exists "business_reads_own_wa_account" on business_wa_accounts;
create policy "business_reads_own_wa_account" on business_wa_accounts
  for select using (sehat_caller_is_owner(business_id) or sehat_is_admin());
drop policy if exists "business_reads_own_wallet" on business_wallets;
create policy "business_reads_own_wallet" on business_wallets
  for select using (sehat_caller_is_owner(business_id) or sehat_is_admin());
drop policy if exists "business_reads_own_wallet_tx" on business_wallet_transactions;
create policy "business_reads_own_wallet_tx" on business_wallet_transactions
  for select using (sehat_caller_is_owner(business_id) or sehat_is_admin());
drop policy if exists "business_reads_own_broadcasts" on wa_broadcasts;
create policy "business_reads_own_broadcasts" on wa_broadcasts
  for select using (sehat_caller_is_owner(business_id) or sehat_is_staff());
drop policy if exists "business_reads_own_broadcast_recipients" on wa_broadcast_recipients;
create policy "business_reads_own_broadcast_recipients" on wa_broadcast_recipients
  for select using (exists (
    select 1 from wa_broadcasts b where b.id = broadcast_id
       and (sehat_caller_is_owner(b.business_id) or sehat_is_admin())));

-- ── Functions: each the latest body, owner-or-manager → owner ──────────────
create or replace function sehat_create_wa_broadcast(
  p_business uuid, p_template uuid, p_params text[], p_members uuid[], p_pins text[] default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
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

  return jsonb_build_object('broadcast_id', v_b, 'recipients', v_count,
                            'cost_paise', v_cost, 'balance_paise', v_balance - v_cost);
end $$;

create or replace function sehat_marketing_audience(p_business uuid, p_pins text[] default null)
returns table (patient_member_id uuid, full_name text, phone text, pin_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the clinic''s owner or manager can do this.' using errcode = '42501';
  end if;
  return query
  select distinct on (p.phone)
         m.id, m.full_name, p.phone, p.pin_code
    from business_patients bp
    join patient_members m on m.id = bp.patient_member_id
    join patients p on p.id = m.patient_id
   where bp.business_id = p_business
     and bp.status = 'active'
     and coalesce(m.status, 'active') = 'active'
     and p.phone ~ '^91[6-9][0-9]{9}$'
     and sehat_has_consent(m.id, 'marketing', p_business)
     and not exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(p.phone))
     and (p_pins is null or cardinality(p_pins) = 0 or p.pin_code = any(p_pins))
   order by p.phone, m.is_self desc nulls last, m.full_name;
end $$;

create or replace function sehat_set_renewal_preference(
  p_business uuid, p_months integer, p_whatsapp boolean, p_auto_renew boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_caller_is_owner(p_business) then
    raise exception 'Only the owner or manager can change the plan.' using errcode = '42501';
  end if;
  if p_months not in (1, 6, 12) then raise exception 'Choose 1, 6 or 12 months.'; end if;
  update businesses set renewal_term_months = p_months, renewal_whatsapp = p_whatsapp,
                        auto_renew = p_auto_renew
   where id = p_business;
end $$;

create or replace function sehat_set_auto_renew(p_business uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := sehat_caller_role(p_business);
  if v_role is null or v_role is distinct from 'owner' then
    raise exception 'Only the owner can change auto-renewal'
      using errcode = '42501';
  end if;

  update businesses
     set auto_renew = p_on,
         updated_at = now()
   where id = p_business;

  -- Turning it off does not cancel the mandate at Razorpay — only the edge
  -- function can do that, and it reads this flag. Marking it here would claim
  -- something that has not happened yet.
  return p_on;
end;
$$;

create or replace function sehat_add_leave(
  p_practitioner uuid, p_business uuid, p_from timestamptz, p_to timestamptz, p_reason text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_self boolean := p_practitioner = sehat_caller_practitioner_id();
  v_id uuid;
begin
  if not v_self then
    if p_business is null or not sehat_caller_is_owner(p_business) then
      raise exception 'Only the doctor, or the clinic''s owner, can mark leave.'
        using errcode = '42501';
    end if;
  end if;
  if p_business is not null and not exists (
       select 1 from business_practitioners where business_id = p_business
          and practitioner_id = p_practitioner and status <> 'suspended') then
    raise exception 'That doctor does not work at this clinic.' using errcode = 'P0001';
  end if;
  if p_to <= p_from then raise exception 'Leave must end after it starts.' using errcode = 'P0001'; end if;

  insert into practitioner_leave (practitioner_id, business_id, starts_at, ends_at, reason, created_by)
  values (p_practitioner, p_business, p_from, p_to, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function sehat_cancel_leave(p_leave uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare l practitioner_leave%rowtype;
begin
  select * into l from practitioner_leave where id = p_leave;
  if l.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if not (l.practitioner_id = sehat_caller_practitioner_id()
          or (l.business_id is not null and sehat_caller_is_owner(l.business_id))) then
    raise exception 'Only whoever can mark this leave can cancel it.' using errcode = '42501';
  end if;
  update practitioner_leave set cancelled_at = now() where id = p_leave and cancelled_at is null;
end $$;

create or replace function sehat_set_lab_tests(p_business uuid, p_categories text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_vertical text;
  v_have text[];
  v_cats text[] := array(select distinct c from unnest(coalesce(p_categories, '{}')) c where c is not null order by c);
  v_new_paid text[];
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()) then
    raise exception 'Only the owner can change this.' using errcode = '42501';
  end if;
  if not v_cats <@ array['pathology','radiology','cardiology']::text[] then
    raise exception 'Unknown kind of test.' using errcode = 'P0001';
  end if;
  select vertical, coalesce(lab_categories, '{}') into v_vertical, v_have from businesses where id = p_business;
  if v_vertical is null then raise exception 'No such business.' using errcode = 'P0002'; end if;

  if v_vertical = 'lab' then
    if cardinality(v_cats) = 0 then
      raise exception 'Choose what kind of lab this is.' using errcode = 'P0001';
    end if;
    update businesses set lab_categories = v_cats where id = p_business;
  else
    if not sehat_is_admin() then
      v_new_paid := array(select c from unnest(v_cats) c
                           where not (c = any(v_have))
                             and coalesce((select monthly_price from addon_prices a where a.code = c), 0) > 0);
      if cardinality(v_new_paid) > 0 then
        raise exception 'That add-on is paid — add it from Plan → Add-ons.' using errcode = '42501';
      end if;
    end if;
    update businesses
       set lab_categories = v_cats,
           lab_module = cardinality(v_cats) > 0,
           -- Switched off: stop renewing it too.
           renewal_addons = array(select a from unnest(renewal_addons) a where a = any(v_cats)),
           lab_module_set_by = coalesce((select email from auth.users where id = auth.uid()), 'owner')
     where id = p_business;
  end if;
  return (select jsonb_build_object('lab_categories', lab_categories, 'lab_module', lab_module or vertical = 'lab',
                                    'renewal_addons', renewal_addons)
            from businesses where id = p_business);
end $$;

-- ── The owner switches the in-house pharmacy on or off ──────────────────────
create or replace function sehat_set_pharmacy_module(p_business uuid, p_on boolean)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()) then
    raise exception 'Only the owner can change this.' using errcode = '42501';
  end if;
  if (select vertical from businesses where id = p_business) not in ('clinic', 'hospital') then
    raise exception 'In-house dispensing is for clinics and hospitals.' using errcode = 'P0001';
  end if;
  update businesses
     set pharmacy_module = coalesce(p_on, false),
         pharmacy_module_since = case when coalesce(p_on, false) and not pharmacy_module then now() else pharmacy_module_since end,
         pharmacy_module_set_by = coalesce((select email from auth.users where id = auth.uid()), 'owner')
   where id = p_business;
  return coalesce(p_on, false);
end $$;
revoke all on function sehat_set_pharmacy_module(uuid, boolean) from public, anon;
grant execute on function sehat_set_pharmacy_module(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
