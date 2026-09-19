-- ============================================================================
-- Sehatsandhi — the admin can fetch every invoice of a period, in full
--
-- Run AFTER 0112. Safe to re-run.
--
-- The GST tab downloads the register and the summary (0092), which are the
-- figures a return is filed from. What a CA also asks for is the invoices
-- themselves — one document per invoice, for the month, quarter or year. The
-- admin could only open them one at a time, by token, through invoice-view.
--
-- This returns the same fields invoice-view returns, for every invoice between
-- two dates, so the admin panel can render each one as a PDF and zip them.
-- Cancelled invoices are included and say so on the document, as they do on
-- the invoice page: the number series must be complete.
--
-- Admin only. invoices stays service-role only; this is the one reader.
-- ============================================================================

create or replace function sehat_admin_invoices(p_from date, p_to date)
returns table (
  invoice_number text, invoice_date date, fy text, status text, cancelled_reason text,
  supplier_legal_name text, supplier_trade_name text, supplier_gstin text,
  supplier_state_code text, supplier_address text,
  recipient_name text, recipient_gstin text, recipient_state_code text,
  recipient_address text, recipient_phone text,
  sac_code text, description text, period_start date, period_end date,
  months integer, pin_codes text[],
  taxable_value numeric, gst_rate numeric, cgst_amount numeric, sgst_amount numeric,
  igst_amount numeric, tax_total numeric, total_amount numeric,
  place_of_supply text, reverse_charge boolean, currency text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select i.invoice_number::text, i.invoice_date::date, i.fy::text, i.status::text,
         i.cancelled_reason::text,
         i.supplier_legal_name::text, i.supplier_trade_name::text, i.supplier_gstin::text,
         i.supplier_state_code::text, i.supplier_address::text,
         i.recipient_name::text, i.recipient_gstin::text, i.recipient_state_code::text,
         i.recipient_address::text, i.recipient_phone::text,
         i.sac_code::text, i.description::text, i.period_start::date, i.period_end::date,
         i.months::integer, i.pin_codes::text[],
         i.taxable_value::numeric, i.gst_rate::numeric, i.cgst_amount::numeric,
         i.sgst_amount::numeric, i.igst_amount::numeric, i.tax_total::numeric,
         i.total_amount::numeric,
         i.place_of_supply::text, coalesce(i.reverse_charge, false), i.currency::text
    from invoices i
   where i.invoice_date between p_from and p_to
   -- Numbering order, as the register: a missing number should be visible.
   order by i.fy, i.invoice_number;
end $$;

comment on function sehat_admin_invoices is
  'Every invoice between two dates with the fields the invoice page prints, '
  'cancelled ones included. Admin only; feeds the GST tab''s PDF download.';

revoke all on function sehat_admin_invoices(date, date) from public, anon;
grant execute on function sehat_admin_invoices(date, date) to authenticated;
