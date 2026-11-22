-- ============================================================================
-- 0330 — Treatment on EMI: GST invoices to lenders for commission
-- ============================================================================
-- AFTER 0329. Safe to re-run. Plan: docs/2026-11-finance-emi-phase1.md.
--
-- Each month NG Technologies invoices each lender its commission on the loans it
-- paid out to hospitals that month (by disbursed_on), at the lender's agreed
-- rate. The invoice is an ordinary row in `invoices`: same number series
-- (sehat_next_invoice_number), same supplier snapshot from tax_settings, same
-- public link (/invoice/<token>) and same GST filing export (0092 reads
-- `invoices` directly, B2B when the lender gave a GSTIN).
--
-- Unlike a listing invoice it is issued BEFORE it is paid, so invoices gains:
--   invoice_kind   'listing' (every existing row) | 'emi_commission'
--   due_on         payment due date (15 days)
--   paid_at        when the lender's payment arrived (admin marks it)
-- and one commission invoice per lender per month (unique index).
--
--   sehat_lender_billing_save(...)          the lender's GSTIN, legal name and
--                                           billing address (owner/manager).
--   sehat_admin_finance_invoice(lender, m)  issue (or return) that month's invoice.
--   sehat_admin_finance_invoice_paid(id)    record the lender's payment.
--
-- CHECK (CA): SAC code for loan-sourcing commission. Read from site_settings
-- 'finance_commission_sac' (default 997119 — other financial services) and
-- 'finance_commission_description', so the CA's answer is a row, not a release.
-- ============================================================================

alter table invoices add column if not exists invoice_kind text not null default 'listing';
alter table invoices drop constraint if exists invoices_kind_check;
alter table invoices add constraint invoices_kind_check check (invoice_kind in ('listing', 'emi_commission'));
alter table invoices add column if not exists due_on date;
alter table invoices add column if not exists paid_at timestamptz;

create unique index if not exists invoices_emi_commission_once
  on invoices (business_id, period_start) where invoice_kind = 'emi_commission';

insert into site_settings (key, value) values ('finance_commission_sac', '997119') on conflict (key) do nothing;
insert into site_settings (key, value) values ('finance_commission_description', 'Loan sourcing services — commission on loans paid out') on conflict (key) do nothing;

-- GSTIN: shape and check digit (the same algorithm as gstinCheckDigit in src/hooks/useTaxSettings.ts).
create or replace function sehat_gstin_ok(p text)
returns boolean language plpgsql immutable as $$
declare cs constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; g text := upper(btrim(coalesce(p, ''))); s int := 0; i int; v int; f int;
begin
  if g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  for i in 1..14 loop
    v := strpos(cs, substr(g, i, 1)) - 1;
    f := case when i % 2 = 0 then 2 else 1 end;
    v := v * f;
    s := s + (v / 36) + (v % 36);
  end loop;
  return substr(cs, ((36 - (s % 36)) % 36) + 1, 1) = substr(g, 15, 1);
end $$;

-- ── Lender: billing details for our invoices ────────────────────────────────
create or replace function sehat_lender_billing_save(p_lender uuid, p_gstin text, p_legal_name text, p_address text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_g text := nullif(upper(btrim(coalesce(p_gstin, ''))), '');
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_lender)) then
    raise exception 'Only the lender''s owner or manager can edit this.' using errcode = '42501';
  end if;
  if not exists (select 1 from businesses where id = p_lender and vertical = 'lender') then
    raise exception 'Not a lender account.' using errcode = 'P0001';
  end if;
  if v_g is not null and not sehat_gstin_ok(v_g) then
    raise exception 'That GSTIN doesn''t look right — please check it.' using errcode = '22023';
  end if;
  update businesses set gstin = v_g, gst_legal_name = nullif(btrim(coalesce(p_legal_name, '')), ''),
         billing_address = nullif(btrim(coalesce(p_address, '')), ''),
         state_code = case when v_g is not null then left(v_g, 2) else state_code end, updated_at = now()
   where id = p_lender;
end $$;
revoke all on function sehat_lender_billing_save(uuid, text, text, text) from public, anon;
grant execute on function sehat_lender_billing_save(uuid, text, text, text) to authenticated;

-- ── Admin: issue a lender's commission invoice for a month ──────────────────
create or replace function sehat_admin_finance_invoice(p_lender uuid, p_month date)
returns invoices language plpgsql volatile security definer set search_path = public as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_inv invoices; v_ts tax_settings; v_biz businesses; lp lender_profiles;
  v_items jsonb; v_taxable numeric(12,2); v_gst boolean; v_rate numeric(5,2) := 0;
  v_rstate text; v_place text; v_inter boolean; v_tax numeric(12,2) := 0;
  v_cgst numeric(12,2) := 0; v_sgst numeric(12,2) := 0; v_igst numeric(12,2) := 0;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if v_to >= current_date then raise exception 'Invoice a month once it is over.' using errcode = 'P0001'; end if;

  select * into v_inv from invoices where invoice_kind = 'emi_commission' and business_id = p_lender and period_start = v_from;
  if found then return v_inv; end if;

  select * into lp from lender_profiles where business_id = p_lender;
  if lp.business_id is null then raise exception 'No such lender.' using errcode = 'P0002'; end if;
  if lp.commission_pct is null then raise exception 'Set this lender''s commission rate first.' using errcode = 'P0001'; end if;

  -- One line per loan, each rounded; the invoice is their sum, so it always adds up.
  select jsonb_agg(jsonb_build_object(
           'label', format('%s · %s · paid %s · %s × %s%%', c.case_no, b.name, to_char(l.disbursed_on, 'DD Mon YYYY'),
                           '₹' || to_char(l.disbursed_amount, 'FM99,99,99,990'), lp.commission_pct),
           'amount', round(l.disbursed_amount * lp.commission_pct / 100, 2)) order by l.disbursed_on, c.case_no),
         sum(round(l.disbursed_amount * lp.commission_pct / 100, 2))
    into v_items, v_taxable
    from finance_case_lenders l
    join finance_cases c on c.id = l.case_id
    join businesses b on b.id = c.business_id
   where l.lender_id = p_lender and l.status = 'disbursed' and l.disbursed_on between v_from and v_to;
  if coalesce(v_taxable, 0) <= 0 then raise exception 'No loans paid out by this lender in that month.' using errcode = 'P0001'; end if;

  select * into v_ts from tax_settings where id;
  select * into v_biz from businesses where id = p_lender;

  -- No GSTIN of ours, no GST (the rule in _shared/tax.ts).
  v_gst := coalesce(v_ts.gst_enabled, false) and coalesce(v_ts.gstin, '') <> '';
  v_rstate := coalesce(left(nullif(v_biz.gstin, ''), 2), v_biz.state_code);
  v_place := coalesce(v_rstate, v_ts.state_code);
  v_inter := v_rstate is not null and v_rstate <> v_ts.state_code;
  if v_gst then
    v_rate := coalesce(v_ts.gst_rate, 18);
    v_tax := round(v_taxable * v_rate / 100, 2);
    if v_inter then v_igst := v_tax;
    else v_cgst := round(v_tax / 2, 2); v_sgst := v_tax - v_cgst; end if;
  end if;

  insert into invoices (
    invoice_number, invoice_date, fy, business_id, payment_id, invoice_kind, due_on,
    supplier_legal_name, supplier_trade_name, supplier_gstin, supplier_state_code, supplier_address,
    recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_phone, recipient_email,
    sac_code, description, period_start, period_end, months,
    taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, tax_total, total_amount,
    place_of_supply, reverse_charge, line_items
  ) values (
    sehat_next_invoice_number(current_date), current_date, sehat_financial_year(current_date), p_lender, null,
    'emi_commission', current_date + 15,
    v_ts.legal_name, v_ts.trade_name, case when v_gst then v_ts.gstin end, v_ts.state_code,
    concat_ws(', ', v_ts.registered_address, v_ts.city, v_ts.pin_code),
    coalesce(v_biz.gst_legal_name, lp.legal_name, v_biz.name), nullif(v_biz.gstin, ''), v_rstate,
    coalesce(v_biz.billing_address, v_biz.address), v_biz.phone, v_biz.email,
    coalesce((select value from site_settings where key = 'finance_commission_sac'), '997119'),
    coalesce((select value from site_settings where key = 'finance_commission_description'), 'Loan sourcing services — commission on loans paid out')
      || ' (' || to_char(v_from, 'Mon YYYY') || ')',
    v_from, v_to, 1,
    v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_tax, v_taxable + v_tax,
    v_place, false, v_items
  ) returning * into v_inv;
  return v_inv;
end $$;
revoke all on function sehat_admin_finance_invoice(uuid, date) from public, anon;
grant execute on function sehat_admin_finance_invoice(uuid, date) to authenticated;

create or replace function sehat_admin_finance_invoice_paid(p_invoice uuid, p_paid boolean default true)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update invoices set paid_at = case when p_paid then coalesce(paid_at, now()) end
   where id = p_invoice and invoice_kind = 'emi_commission';
  if not found then raise exception 'No such commission invoice.' using errcode = 'P0002'; end if;
end $$;
revoke all on function sehat_admin_finance_invoice_paid(uuid, boolean) from public, anon;
grant execute on function sehat_admin_finance_invoice_paid(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
