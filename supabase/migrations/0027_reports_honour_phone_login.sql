-- Reports could not be opened by the people the phone login creates.
--
-- sehat_caller_owns_listing (0019) decides whether the caller may read a
-- listing's own analytics. It was written before phone login existed and knew
-- three routes: admin, a matching JWT email, and active clinic_users staff.
--
-- 0023 then moved clinic identity onto doctors.auth_uid, because the signup
-- wizard collects an email only optionally and never created an account with
-- it — so a business that joined through the wizard and paid had no email on
-- its row to match. Phone login links auth_uid instead, and 0023 introduced
-- sehat_caller_listing_ids() as, in its own words, "the single authority for
-- doctor-facing RLS".
--
-- The ownership check was never pointed at it. So a clinic could sign in with a
-- code sent to its WhatsApp number, reach its dashboard, open Reports, and get
-- insufficient_privilege raised at it — while the same clinic's appointments
-- and bills, which do go through sehat_caller_listing_ids(), loaded fine.
--
-- Delegating rather than adding a fourth branch: a second copy of "who owns
-- this listing" is how the two drifted apart in the first place.

create or replace function sehat_caller_owns_listing(p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    sehat_is_admin()
    or p_doctor_id in (select sehat_caller_listing_ids())
    -- A hospital may read its consultants' numbers; that is the point of
    -- employing them. Not part of caller_listing_ids because a consultant's
    -- listing is not one the hospital may otherwise act on.
    or exists (
      select 1 from doctors d
       where d.id = p_doctor_id
         and d.organization_id is not null
         and sehat_caller_owns_org(d.organization_id)
    );
$$;

comment on function sehat_caller_owns_listing is
  'May the caller read this listing''s own reporting? Admin, any listing from '
  'sehat_caller_listing_ids() (phone login, legacy email, or clinic staff), or '
  'the hospital that employs it.';
