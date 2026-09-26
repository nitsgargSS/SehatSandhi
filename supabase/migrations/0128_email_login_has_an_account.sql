-- ============================================================================
-- Sehatsandhi — a business that registered can actually get a login code
--
-- Run AFTER 0127. Safe to re-run.
--
-- Registration (0079) collects the email a business and each doctor sign in
-- with, but creates no Supabase login user for it. The sign-in form asks for a
-- code with shouldCreateUser: false — rightly, or any address typed into a
-- login box would become an account — so for a new business Supabase quietly
-- sent nothing. Found 26 Sep 2026: a clinic registered on staging and never
-- received its code; only addresses that already had a login (an admin's) did.
--
-- The email-login-prepare function now creates the login user first, but only
-- for an address that a business or practitioner registered with. It needs to
-- find an existing user's id by email, which the service role cannot do through
-- the REST API; this is that lookup, for the service role only.
-- ============================================================================

create or replace function sehat_auth_uid_for_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth as $$
  select u.id from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   order by u.created_at
   limit 1
$$;

revoke all on function sehat_auth_uid_for_email(text) from public, anon, authenticated;
grant execute on function sehat_auth_uid_for_email(text) to service_role;

notify pgrst, 'reload schema';
