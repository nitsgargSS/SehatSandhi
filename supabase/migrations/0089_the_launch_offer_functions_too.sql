-- ============================================================================
-- Sehatsandhi — the same fix for the four functions 0082-0085 added
--
-- Run AFTER 0088. Safe to re-run.
--
-- 0088 was generated from PRODUCTION, where 0082-0085 are deliberately not
-- applied. So it could not see the four functions they add, and re-running the
-- audit against sandbox afterwards left exactly those four unclassified. This
-- closes the two that need it.
--
--   sehat_queue_billing_notices()   REVOKED. Volatile, writes
--     billing_notifications, and is the cron's to call and nobody else's. 0083
--     said `revoke ... from public` and stopped there, so the explicit anon
--     grant from Supabase's default privileges survived and an anonymous caller
--     could queue billing notices. Proven on sandbox: it ran and returned 2.
--
--     Real impact was small — it is idempotent, and only queues for businesses
--     whose term actually ends on the computed date, so an early call creates
--     the same rows the cron would. But it is an unauthenticated write, and it
--     never reached production because 0083 has not shipped there.
--
--   sehat_set_auto_renew(uuid, boolean)   REVOKED. Owner-or-manager only, and
--     it does refuse anon — but by raising 42501 from its own body, which is a
--     check that can be edited away, not a privilege that cannot.
--
--     Worth recording: this is what made the first pass of the audit misread.
--     The probe classified SQLSTATE 42501 as "the privilege system refused",
--     when a function raising `using errcode = '42501'` produces the identical
--     code. Seven functions looked protected by grants and were in fact only
--     protected by their own guards. has_function_privilege() is the answer to
--     "may they call it"; the exception is only the answer to "what happens
--     when they do".
--
--   sehat_plan_terms(text), sehat_plan_term_price(text, integer)   KEPT anon.
--     The registration wizard draws the offer before anybody has a session, the
--     same reason care_modules and pricing_plans are readable by anon. They are
--     STABLE, read two columns of a two-row price list, and disclose exactly
--     what the public pricing page already prints.
-- ============================================================================

revoke all on function sehat_queue_billing_notices() from public, anon;
grant execute on function sehat_queue_billing_notices() to service_role;

revoke all on function sehat_set_auto_renew(uuid, boolean) from public, anon;
grant execute on function sehat_set_auto_renew(uuid, boolean) to authenticated;

comment on function sehat_queue_billing_notices is
  'Daily. Queues renewal reminders for businesses that opted out, and RBI '
  'pre-debit notices for those with a live mandate. Idempotent — the unique '
  'index makes a repeat run a no-op. service_role only since 0089: it writes, '
  'and it is the cron''s to call.';


notify pgrst, 'reload schema';
