-- ============================================================================
-- Sehatsandhi — grant the reads that 0025's policies assume
--
-- Run AFTER 0025. Safe to re-run.
--
-- 0025 added clinic-scoped SELECT policies to invoices and payments, and they
-- did nothing: both tables were created without a table-level grant to the
-- authenticated role, so Postgres refuses before RLS is ever consulted —
-- "permission denied for table invoices".
--
-- A policy without a grant is a door with no doorway. Easy to miss here because
-- the admin panel reads invoices through the admin-pricing edge function on the
-- service role, which bypasses grants entirely, so the existing admin policy
-- looked like proof the table was reachable. It was not.
--
-- SELECT only. Writes stay with sehat_issue_invoice and the Razorpay functions
-- on the service role; RLS then narrows each read to the caller's own listings.
-- ============================================================================

grant select on invoices to authenticated;
grant select on payments to authenticated;

-- Not to anon. These carry amounts, GSTINs and term dates, and nothing on the
-- public site needs them — the invoice page fetches through invoice-view, which
-- resolves a single row from its token on the service role.
revoke all on invoices from anon;
revoke all on payments from anon;
