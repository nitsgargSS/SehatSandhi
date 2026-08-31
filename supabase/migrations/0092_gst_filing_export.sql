-- ============================================================================
-- Sehatsandhi — the invoices, in the shape a GST return is filed from
--
-- Run AFTER 0091. Safe to re-run.
--
-- 0007 built the invoice register and it has sat there unfiltered ever since:
-- `invoice_register` is every invoice ever raised, in one list, with no way to
-- ask for a month. Filing a return meant reading the whole thing and adding it
-- up by hand, which is exactly the job a spreadsheet is for.
--
-- These are OUR invoices — NG Technologies billing a clinic for its listing,
-- under our GSTIN, on our numbering series. Nothing here touches patient_bills,
-- which is a clinic billing a patient: different payer, different payee, and
-- money that was never ours. 0091 reports that side.
--
-- ── GST PERIODS ARE FINANCIAL, NOT CALENDAR ─────────────────────────────────
-- The single thing most likely to be got wrong here, and the reason this does
-- NOT reuse sehat_period_start() from 0091. That function buckets by calendar
-- quarter — January to March is Q1. A GST quarter is a FINANCIAL quarter:
--
--     Q1  Apr–Jun     Q2  Jul–Sep     Q3  Oct–Dec     Q4  Jan–Mar
--
-- and a "year" is 1 April to 31 March. Filing January's invoices as Q1 of the
-- wrong year is not a display bug, it is a wrong return. So the period is
-- resolved by the CALLER and passed here as two plain dates: one place decides
-- what April to June means, and this function only ever filters between two
-- days it was given.
--
-- ── CANCELLED INVOICES ARE NOT DROPPED ──────────────────────────────────────
-- The instinct is to filter status <> 'cancelled'. That would be wrong for a
-- return: GSTR-1 has a documents-issued table that must declare the whole
-- number series including the cancelled ones, because an unexplained gap in an
-- invoice series is what an assessment asks about.
--
-- So the register returns them, flagged, and the SUMMARY excludes them from the
-- money. Both facts are needed and they are needed separately.
--
-- ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
-- It is the register and the summaries a return is typed or uploaded from: B2B
-- invoice-wise, B2C summarised, and a SAC-wise table for the HSN summary.
--
-- It is NOT a GSTN-ready JSON upload. That format has its own schema, its own
-- validation and its own version history, and generating one that is subtly
-- wrong is worse than not generating one — it fails at the portal at best and
-- files something incorrect at worst. The register exports cleanly to the
-- offline utility, which is what a CA will use anyway.
-- ============================================================================


-- ============================================================================
-- 1. The register — one row per invoice
-- ============================================================================

create or replace function sehat_gst_register(p_from date, p_to date)
returns table (
  invoice_number   text,
  invoice_date     date,
  fy               text,
  recipient_name   text,
  recipient_gstin  text,
  -- B2B when the buyer gave a GSTIN, B2C otherwise. The two are filed in
  -- different tables of GSTR-1, so it is computed here rather than left to
  -- whoever reads the sheet.
  supply_type      text,
  place_of_supply  text,
  -- Inter-state supply attracts IGST; intra-state splits into CGST+SGST. Stated
  -- explicitly because it is the field most often wrong when a return is typed
  -- by hand from a bank statement.
  supply_nature    text,
  sac_code         text,
  taxable_value    numeric,
  gst_rate         numeric,
  cgst_amount      numeric,
  sgst_amount      numeric,
  igst_amount      numeric,
  tax_total        numeric,
  total_amount     numeric,
  reverse_charge   boolean,
  status           text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.invoice_number, i.invoice_date, i.fy,
         i.recipient_name, i.recipient_gstin,
         case when nullif(btrim(coalesce(i.recipient_gstin, '')), '') is null
              then 'B2C' else 'B2B' end,
         i.place_of_supply,
         case when coalesce(i.igst_amount, 0) > 0 then 'Inter-state'
              else 'Intra-state' end,
         i.sac_code, i.taxable_value, i.gst_rate,
         i.cgst_amount, i.sgst_amount, i.igst_amount, i.tax_total, i.total_amount,
         coalesce(i.reverse_charge, false),
         i.status
    from invoices i
   where sehat_is_admin()
     and i.invoice_date between p_from and p_to
   -- Numbering order, not date order: a return is checked against the series,
   -- and a reader scanning for a gap needs them consecutive.
   order by i.fy, i.invoice_number;
$$;

comment on function sehat_gst_register is
  'Every invoice raised between two dates, including cancelled ones — GSTR-1 '
  'must declare the whole number series. Admin only. Periods are the caller''s '
  'to resolve: a GST quarter is Apr-Jun, not Jan-Mar.';

grant execute on function sehat_gst_register(date, date) to authenticated;
revoke all on function sehat_gst_register(date, date) from public, anon;


-- ============================================================================
-- 2. The summary — what actually gets typed into the return
--
-- Grouped by every dimension a return separates on, so one result serves the
-- B2C summary, the rate-wise tables and the SAC summary without three queries
-- that could disagree with each other.
-- ============================================================================

create or replace function sehat_gst_summary(p_from date, p_to date)
returns table (
  supply_type      text,
  supply_nature    text,
  place_of_supply  text,
  sac_code         text,
  gst_rate         numeric,
  invoices         integer,
  taxable_value    numeric,
  cgst_amount      numeric,
  sgst_amount      numeric,
  igst_amount      numeric,
  tax_total        numeric,
  total_amount     numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select case when nullif(btrim(coalesce(i.recipient_gstin, '')), '') is null
              then 'B2C' else 'B2B' end,
         case when coalesce(i.igst_amount, 0) > 0 then 'Inter-state'
              else 'Intra-state' end,
         i.place_of_supply,
         i.sac_code,
         i.gst_rate,
         count(*)::integer,
         sum(i.taxable_value),
         sum(i.cgst_amount),
         sum(i.sgst_amount),
         sum(i.igst_amount),
         sum(i.tax_total),
         sum(i.total_amount)
    from invoices i
   where sehat_is_admin()
     and i.invoice_date between p_from and p_to
     -- Cancelled invoices carry no tax liability. They appear in the register
     -- above, so the series is still complete; they must not appear in a total.
     and i.status <> 'cancelled'
   group by 1, 2, 3, 4, 5
   order by 1, 2, 3, 5;
$$;

comment on function sehat_gst_summary is
  'Rate-wise, place-wise and SAC-wise totals for the period, excluding '
  'cancelled invoices. Serves the B2C summary, the rate tables and the HSN/SAC '
  'summary from one grouping so they cannot disagree. Admin only.';

grant execute on function sehat_gst_summary(date, date) to authenticated;
revoke all on function sehat_gst_summary(date, date) from public, anon;


notify pgrst, 'reload schema';
