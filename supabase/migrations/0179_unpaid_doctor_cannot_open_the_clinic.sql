-- ============================================================================
-- Sehatsandhi — a doctor waiting for the extra-doctor fee cannot open the clinic
--
-- Run AFTER 0178. Safe to re-run.
--
-- Found 29 Sep 2026: a doctor added past the included ones is held
-- (status 'pending', awaiting_payment, 0140) until the clinic pays the
-- pro-rata fee — and the invitation screen says "You can open it once the
-- clinic pays". But the two functions every access rule rests on only
-- excluded 'suspended', so the unpaid doctor could already sign in and see
-- the clinic's patients. Now they also exclude awaiting_payment. Paying
-- (sehat_release_paid_doctor) clears it and access follows.
--
-- 0081's bodies, with that one condition added to the affiliation route.
-- ============================================================================

create or replace function sehat_caller_role(p_business uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when sehat_caller_password_expired() then null else (
    select case
      -- Routes 1 and 2 of sehat_caller_business_ids: the person who signed the
      -- listing up, by phone or by the legacy email login. They are the owner
      -- whether or not anybody made them a practitioner row.
      when exists (
        select 1 from businesses b
         where b.id = p_business
           and ((b.auth_uid is not null and b.auth_uid = auth.uid())
             or (b.email is not null and b.email <> '' and b.email = auth.jwt() ->> 'email'))
      ) then 'owner'
      -- Route 3: an affiliation that permits web login.
      else (
        select bp.role
          from business_practitioners bp
          join practitioners p on p.id = bp.practitioner_id
         where bp.business_id = p_business
           and p.auth_uid = auth.uid()
           and bp.status <> 'suspended'
           and not coalesce(bp.awaiting_payment, false)
           and bp.can_login_web
         -- One row per person per business is a unique constraint, so this
         -- orders a set of at most one. It is here so that if that constraint is
         -- ever relaxed, the answer is the most privileged role rather than
         -- whichever row the planner happened to return.
         order by case bp.role
                    when 'owner' then 0 when 'doctor' then 1
                    when 'manager' then 2 else 3 end
         limit 1
      )
    end
  ) end;
$$;

create or replace function sehat_caller_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  -- The listing this login owns, linked at phone login.
  select b.id from businesses b
   where not sehat_caller_password_expired()
     and b.auth_uid is not null and b.auth_uid = auth.uid()
  union
  -- Legacy email/password login, still honoured.
  select b.id from businesses b
   where not sehat_caller_password_expired()
     and b.email is not null and b.email <> '' and b.email = auth.jwt() ->> 'email'
  union
  -- Anyone attached to the business who is allowed to sign in: the owner, the
  -- doctors, reception. This is the clinic_users route, rebuilt on affiliations.
  select bp.business_id
    from business_practitioners bp
    join practitioners p on p.id = bp.practitioner_id
   where not sehat_caller_password_expired()
     and p.auth_uid = auth.uid()
     and bp.status <> 'suspended'
     and not coalesce(bp.awaiting_payment, false)
     and bp.can_login_web;
$$;

notify pgrst, 'reload schema';
