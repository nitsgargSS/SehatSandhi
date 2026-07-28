-- ============================================================================
-- Sehatsandhi — a clinic can see what it has paid
--
-- Run AFTER 0024. Safe to re-run.
--
-- invoices and payments are admin-only. So a business that pays us has no record
-- of it on its own side: the invoice link goes out once over WhatsApp and after
-- that the only copy lives in our admin panel. The first renewal will produce
-- someone asking what they paid and when, and today the honest answer is that
-- they cannot look.
--
-- Read only, on both. Money rows are written by the Razorpay functions on the
-- service role and by sehat_issue_invoice; a business editing either would put
-- our books and the gateway out of step. Scoped through
-- sehat_caller_listing_ids(), so a clinic sees its own listings' bills and
-- nothing else — including, for a hospital, the bills of every listing on its
-- number.
-- ============================================================================

drop policy if exists "clinic_reads_own_invoices" on invoices;
create policy "clinic_reads_own_invoices" on invoices
  for select using (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "clinic_reads_own_payments" on payments;
create policy "clinic_reads_own_payments" on payments
  for select using (doctor_id in (select sehat_caller_listing_ids()));

comment on table invoices is
  'Tax invoices we have issued. Readable by the admin and by the business the '
  'invoice was raised against; written only by sehat_issue_invoice on the '
  'service role, never from a browser.';
