-- ============================================================================
-- Sehatsandhi — prices by business type, the WhatsApp add-on, coupons that work
--
-- Run AFTER 0116. Safe to re-run.
--
-- Decided 25 Sep 2026:
--
--   • Every business type has its own price list, set by admin only: the
--     Sehatsandhi subscription for 1, 6 and 12 months, and the WhatsApp fee for
--     the same terms. Clinic, hospital and lab start at ₹2,000 / ₹10,000 /
--     ₹18,000; pharmacy, insurance and ambulance at ₹0 with their commission.
--   • WhatsApp is an optional add-on, ₹500 / ₹3,000 / ₹6,000, labelled "WhatsApp
--     Business Verification & Activation Fee". It is the only WhatsApp fee — it
--     replaces 0116's ₹2,000 subscription and ₹500 onboarding fee. Messages are
--     paid from the wallet on top. Not chosen = not charged.
--   • Hospitals keep the per-doctor extra: included_doctors free, then
--     extra_doctor_price a month each, per type, admin-editable.
--   • A coupon code, checked by the server, discounts the SUBSCRIPTION only —
--     not WhatsApp, not the doctor extra, not GST — and counts one use once the
--     payment succeeds.
--   • Autopay stays ticked by default and is stored; it reminds until Razorpay
--     recurring (mandates) is enabled on the account.
--
-- When a type has rows here they win over the old single plan (plan_terms);
-- the old plan still decides max/min terms for a type with none.
-- ============================================================================

-- ── The price list, one row per type per term ───────────────────────────────
create table if not exists vertical_term_prices (
  vertical text not null references vertical_billing(vertical) on update cascade,
  months integer not null check (months in (1, 6, 12)),
  subscription_price integer not null check (subscription_price >= 0),   -- whole rupees, pre-GST
  whatsapp_price integer not null check (whatsapp_price >= 0),           -- whole rupees, pre-GST
  label text,
  is_enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (vertical, months)
);

insert into vertical_term_prices (vertical, months, subscription_price, whatsapp_price, label)
select v.vertical, t.months,
       case when v.vertical in ('clinic','hospital','lab') then t.sub else 0 end,
       t.wa, t.label
  from (values ('clinic'),('hospital'),('lab'),('pharmacy'),('insurance'),('ambulance')) v(vertical)
  cross join (values (1, 2000, 500, 'Monthly'), (6, 10000, 3000, '6 months'), (12, 18000, 6000, '12 months'))
       t(months, sub, wa, label)
 where exists (select 1 from vertical_billing vb where vb.vertical = v.vertical)
on conflict (vertical, months) do nothing;

alter table vertical_term_prices enable row level security;
revoke all on vertical_term_prices from anon, authenticated;
-- Everyone may read a price list — the signup page quotes before any login.
grant select on vertical_term_prices to anon, authenticated;
drop policy if exists "anyone_reads_type_prices" on vertical_term_prices;
create policy "anyone_reads_type_prices" on vertical_term_prices for select using (true);
-- No write policy: changes go through sehat_admin_set_type_pricing below.

-- ── Per-type doctor pricing (hospitals) ─────────────────────────────────────
alter table vertical_billing add column if not exists included_doctors integer not null default 0
  check (included_doctors >= 0);
alter table vertical_billing add column if not exists extra_doctor_price integer not null default 0
  check (extra_doctor_price >= 0);
update vertical_billing set included_doctors = 3, extra_doctor_price = 300
 where vertical = 'hospital' and extra_doctor_price = 0 and included_doctors = 0;

-- ── What a payment bought ───────────────────────────────────────────────────
alter table payments add column if not exists subscription_amount numeric(12,2);
alter table payments add column if not exists whatsapp_addon boolean not null default false;
alter table payments add column if not exists whatsapp_amount numeric(12,2) not null default 0;
alter table payments add column if not exists coupon_code text;
alter table payments add column if not exists coupon_discount numeric(12,2) not null default 0;
alter table payments add column if not exists coupon_redeemed_at timestamptz;
alter table payments add column if not exists auto_renew boolean;
-- [{label, amount}] pre-GST, exactly what was charged; copied onto the invoice.
alter table payments add column if not exists line_items jsonb;

alter table invoices add column if not exists line_items jsonb;

-- The renewal preference a business can change from its dashboard.
alter table businesses add column if not exists renewal_whatsapp boolean not null default false;

-- ── The invoice shows the lines ─────────────────────────────────────────────
-- 0007/0101's function, unchanged except that it copies payments.line_items,
-- so an invoice lists subscription, WhatsApp and any coupon discount separately.
create or replace function sehat_issue_invoice(p_payment_id uuid)
returns invoices
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_existing invoices;
  v_pay payments;
  v_biz businesses;
  v_ts tax_settings;
  v_inv invoices;
  v_recipient_state text;
  v_place text;
  v_taxable numeric(12,2);
  v_rate numeric(5,2);
  v_tax numeric(12,2);
  v_cgst numeric(12,2) := 0;
  v_sgst numeric(12,2) := 0;
  v_igst numeric(12,2) := 0;
begin
  select * into v_existing from invoices where payment_id = p_payment_id;
  if found then return v_existing; end if;

  select * into v_pay from payments where id = p_payment_id;
  if not found then raise exception 'no such payment: %', p_payment_id; end if;
  if v_pay.status <> 'paid' then
    raise exception 'payment % is % — only a paid payment gets an invoice', p_payment_id, v_pay.status;
  end if;

  select * into v_ts from tax_settings where id;
  select * into v_biz from businesses where id = v_pay.business_id;

  v_rate    := coalesce(v_pay.gst_rate, 0);
  v_taxable := coalesce(v_pay.taxable_value, v_pay.amount, 0);
  v_tax     := coalesce(v_pay.tax_total, 0);
  v_cgst    := coalesce(v_pay.cgst_amount, 0);
  v_sgst    := coalesce(v_pay.sgst_amount, 0);
  v_igst    := coalesce(v_pay.igst_amount, 0);

  v_recipient_state := coalesce(v_biz.state_code, v_ts.state_code);
  v_place := coalesce(v_pay.place_of_supply, v_recipient_state);

  insert into invoices (
    invoice_number, invoice_date, fy,
    business_id, payment_id,
    supplier_legal_name, supplier_trade_name, supplier_gstin, supplier_state_code, supplier_address,
    recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_phone, recipient_email,
    sac_code, description, period_start, period_end, months, pin_codes,
    taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, tax_total, total_amount,
    place_of_supply, reverse_charge, line_items
  ) values (
    sehat_next_invoice_number(current_date), current_date, sehat_financial_year(current_date),
    v_pay.business_id, p_payment_id,
    v_ts.legal_name, v_ts.trade_name, v_ts.gstin, v_ts.state_code,
    concat_ws(', ', v_ts.registered_address, v_ts.city, v_ts.pin_code),
    coalesce(v_biz.gst_legal_name, v_biz.name),
    v_biz.gstin, v_recipient_state,
    coalesce(v_biz.billing_address, v_biz.address), v_biz.phone, v_biz.email,
    v_ts.sac_code, v_ts.service_description,
    v_pay.term_start, v_pay.term_end, v_pay.period_months, v_pay.pin_codes,
    v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_tax, coalesce(v_pay.amount, 0),
    v_place, false, v_pay.line_items
  )
  returning * into v_inv;

  return v_inv;
end $function$;

-- ── Coupons: one use counted per successful payment ─────────────────────────
create or replace function sehat_redeem_coupon(p_payment_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_pay payments;
begin
  select * into v_pay from payments where id = p_payment_id for update;
  if v_pay.id is null or v_pay.status <> 'paid' or v_pay.coupon_code is null
     or v_pay.coupon_redeemed_at is not null then
    return false;
  end if;
  update discount_codes set current_uses = coalesce(current_uses, 0) + 1
   where upper(code) = upper(v_pay.coupon_code);
  update payments set coupon_redeemed_at = now() where id = p_payment_id;
  return true;
end $$;
revoke all on function sehat_redeem_coupon(uuid) from public, anon, authenticated;

-- ── Admin: set a type's prices ──────────────────────────────────────────────
-- p_terms: [{"months":1,"subscription_price":2000,"whatsapp_price":500,"is_enabled":true}, …]
create or replace function sehat_admin_set_type_pricing(
  p_vertical text, p_terms jsonb,
  p_commission_percent numeric, p_commission_enabled boolean,
  p_included_doctors integer, p_extra_doctor_price integer
) returns void
language plpgsql security definer set search_path = public as $$
declare
  t jsonb;
  v_who text := (select email from auth.users where id = auth.uid());
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not exists (select 1 from vertical_billing where vertical = p_vertical) then
    raise exception 'Unknown business type: %', p_vertical;
  end if;
  if p_commission_percent < 0 or p_commission_percent > 100 then
    raise exception 'Commission is 0–100%%.';
  end if;
  if p_included_doctors < 0 or p_extra_doctor_price < 0 then
    raise exception 'Doctor numbers cannot be negative.';
  end if;

  for t in select * from jsonb_array_elements(coalesce(p_terms, '[]'::jsonb)) loop
    if (t->>'months')::int not in (1, 6, 12) then raise exception 'Terms are 1, 6 or 12 months.'; end if;
    if (t->>'subscription_price')::int < 0 or (t->>'whatsapp_price')::int < 0 then
      raise exception 'Prices cannot be negative.';
    end if;
    insert into vertical_term_prices (vertical, months, subscription_price, whatsapp_price, is_enabled, label, updated_by, updated_at)
    values (p_vertical, (t->>'months')::int, (t->>'subscription_price')::int, (t->>'whatsapp_price')::int,
            coalesce((t->>'is_enabled')::boolean, true),
            case (t->>'months')::int when 1 then 'Monthly' when 6 then '6 months' else '12 months' end,
            v_who, now())
    on conflict (vertical, months) do update set
      subscription_price = excluded.subscription_price,
      whatsapp_price     = excluded.whatsapp_price,
      is_enabled         = excluded.is_enabled,
      updated_by         = excluded.updated_by,
      updated_at         = now();
  end loop;

  update vertical_billing set
    commission_percent = p_commission_percent,
    commission_enabled = p_commission_enabled,
    included_doctors   = p_included_doctors,
    extra_doctor_price = p_extra_doctor_price
   where vertical = p_vertical;
end $$;
revoke all on function sehat_admin_set_type_pricing(text, jsonb, numeric, boolean, integer, integer) from public, anon, authenticated;
grant execute on function sehat_admin_set_type_pricing(text, jsonb, numeric, boolean, integer, integer) to authenticated;

-- ── A business changes its own renewal choice, never a price ────────────────
create or replace function sehat_set_renewal_preference(
  p_business uuid, p_months integer, p_whatsapp boolean, p_auto_renew boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_caller_is_business(p_business) then
    raise exception 'Only the owner or manager can change the plan.' using errcode = '42501';
  end if;
  if p_months not in (1, 6, 12) then raise exception 'Choose 1, 6 or 12 months.'; end if;
  update businesses set renewal_term_months = p_months, renewal_whatsapp = p_whatsapp,
                        auto_renew = p_auto_renew
   where id = p_business;
end $$;
revoke all on function sehat_set_renewal_preference(uuid, integer, boolean, boolean) from public, anon, authenticated;
grant execute on function sehat_set_renewal_preference(uuid, integer, boolean, boolean) to authenticated;

-- ── Renewal reminders quote the type's list ─────────────────────────────────
create or replace function sehat_business_renewal_price(p_business uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    b.renewal_price,
    (select p.subscription_price
            + case when b.renewal_whatsapp then p.whatsapp_price else 0 end
       from vertical_term_prices p
      where p.vertical = b.vertical
        and p.months = coalesce(b.renewal_term_months, b.months_paid, 1)
        and p.is_enabled),
    (select t.price from plan_terms t
      where t.plan_code = b.pricing_plan_code
        and t.months = coalesce(b.renewal_term_months, b.months_paid, 1)
        and t.is_enabled),
    b.locked_monthly_price * coalesce(b.renewal_term_months, b.months_paid, 1)
  )
    from businesses b
   where b.id = p_business;
$$;

-- ── WhatsApp broadcasts follow the add-on ───────────────────────────────────
-- 0116 checked a subscription_status an admin set by hand. It is now set by
-- paying for the add-on (fulfilment stamps next_billing_date = term end), and a
-- lapsed add-on stops broadcasts once the grace period has passed.
create or replace function sehat_wa_broadcast_blocker(p_business uuid)
returns text
language sql stable security definer set search_path = public as $$
  with s as (select * from whatsapp_marketing_settings where id),
       a as (select * from business_wa_accounts where business_id = p_business)
  select case
    when not (select sending_enabled from s)
      then 'Sending starts once WhatsApp is connected. Nothing has been charged.'
    when not exists (select 1 from a) or (select subscription_status from a) = 'inactive'
      then 'Add WhatsApp to your plan to send broadcasts.'
    when (select status from a) <> 'live'
      then 'Your WhatsApp number is not live yet.'
    when (select subscription_status from a) = 'paused'
      then 'WhatsApp is paused for this clinic.'
    when (select next_billing_date from a) is not null
         and (select next_billing_date from a) + (select grace_days from s) < current_date
      then 'Your WhatsApp add-on has ended. Renew your plan with WhatsApp to send broadcasts.'
    when (select subscription_status from a) = 'past_due'
         and (select past_due_since from a) + make_interval(days => (select grace_days from s)) <= now()
      then 'Your WhatsApp fee is unpaid, so broadcasts are paused until it is paid.'
    else null
  end;
$$;

notify pgrst, 'reload schema';
