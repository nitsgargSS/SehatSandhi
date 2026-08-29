-- ============================================================================
-- Sehatsandhi — an expired password opens nothing
--
-- Run AFTER 0080. Safe to re-run.
--
-- ── WHAT 0080 LEFT, AND WHY IT LEFT IT ──────────────────────────────────────
-- 0080 recorded password age and put a screen in front of a stale one, and said
-- outright that a screen is not a lock: the session's JWT stays valid, every
-- policy keys off auth.uid(), and anybody driving the REST API directly is
-- still served. This is the lock.
--
-- ── ONE GATE WOULD HAVE BEEN A DECORATION ───────────────────────────────────
-- The obvious move is sehat_caller_role(), and on its own it is close to
-- useless. Measured on sandbox:
--
--   policies reached through sehat_caller_role()          29
--     (is_clinical, may_prescribe, manages_business)
--   policies reached through sehat_caller_business_ids()  48
--     (owns_business)
--
-- and the two are INDEPENDENT — business_ids does not call role. So gating only
-- the first leaves these readable, through owns_business alone:
--
--   patients, patient_members, business_patients, patient_allergies,
--   patient_vitals, patient_bills, patient_bill_items, patient_charges,
--   patient_payments, appointments, appointment_events, admissions,
--   admission_bed_stays, beds, wards, opd_queue, businesses,
--   business_practitioners, business_pricing_overrides, camps_offers,
--   site_events, patient_record_access, document_retention_policies
--
-- Names, phone numbers, appointments, bills and admissions — everything except
-- the clinical notes. A gate that stops the drug chart and not the patient list
-- is worse than none, because it reads as a lock in an audit and is not one.
-- So both roots are gated.
--
-- ── WHAT IS DELIBERATELY NOT GATED, AND THE HOLE IT LEAVES ──────────────────
-- Nothing is gated when auth.uid() is null. The WhatsApp bot, the cron jobs and
-- every edge function run as service_role with no JWT subject; gating them would
-- stop appointments being booked and the purges running because somebody's
-- password aged.
--
-- sehat_is_admin() IS gated, and that took a second change outside this file to
-- be safe. admin_users has exactly one SELECT policy — sehat_is_admin() — and
-- AdminGuard in App.tsx reads that table to decide whether to show the panel.
-- Gate the function without touching the guard and an expired admin is told
-- they are not an admin, bounced to the login screen, and can never reach the
-- change-password screen: a permanent lockout with no route back. App.tsx now
-- asks about the password BEFORE asking about the role, so the gate closes and
-- the way out stays open. That pairing is not optional; do not apply one
-- without the other.
--
-- ── THE WAY OUT SURVIVES BY CONSTRUCTION ────────────────────────────────────
-- Everything the recovery needs is SECURITY DEFINER and reads auth_password_state
-- directly, so none of it passes through a gated function:
--
--   sehat_password_state()      what the screen shows
--   sehat_password_changed()    what clears it
--   supabase.auth.updateUser()  Supabase Auth, not RLS at all
--
-- and own_password_state is `auth_uid = auth.uid() or sehat_is_admin()`, whose
-- first half is untouched. There is no recursion either: the gate helper is
-- DEFINER and owned by a BYPASSRLS role, so reading auth_password_state inside
-- it does not re-enter the policy that calls sehat_is_admin().
-- ============================================================================


-- ── The question, asked once ────────────────────────────────────────────────
--
-- Split out rather than inlined three times so there is one place to change it,
-- and one place to look when somebody cannot get in.

create or replace function sehat_caller_password_expired()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null and sehat_password_expired(auth.uid());
$$;

comment on function sehat_caller_password_expired is
  'Added in 0081. False for service_role and cron, which have no JWT subject — '
  'gating them would stop bookings and purges because somebody''s password aged.';

grant execute on function sehat_caller_password_expired() to authenticated, service_role;


-- ── The three roots ─────────────────────────────────────────────────────────
--
-- Bodies otherwise exactly as they were; each gains the same first line. Kept
-- as three separate guards rather than one wrapper because these are called
-- from inside policies on nearly every table, and a wrapper would add a
-- function call to every row-security check in the schema.

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

comment on function sehat_caller_role is
  'Gated in 0081: null when the caller''s password has expired. Backs '
  'is_clinical, may_prescribe and manages_business, and through them 29 policies.';

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
     and bp.can_login_web;
$$;

comment on function sehat_caller_business_ids is
  'Gated in 0081: empty when the caller''s password has expired. Backs '
  'owns_business, and through it 48 policies — which is why gating '
  'sehat_caller_role alone would have left the patient list open.';

create or replace function sehat_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not sehat_caller_password_expired()
     and exists (
       select 1 from admin_users
        where auth_uid = auth.uid() and is_active
     );
$$;

comment on function sehat_is_admin is
  'Gated in 0081. admin_users has one SELECT policy and it is this function, so '
  'App.tsx must check the password BEFORE the role or an expired admin is '
  'bounced to the login screen with no way back to the change-password screen.';

notify pgrst, 'reload schema';


-- ============================================================================
-- IF THIS LOCKS SOMEBODY OUT
--
-- The way back, in order of least to most drastic:
--
--   1. They change their password. That is the whole point, and the screen is
--      in front of them.
--   2. As an admin or from the SQL editor:
--        update auth_password_state set password_changed_at = now(),
--               must_change = false where auth_uid = '<uid>';
--   3. To lift it for everybody at once, without reverting this file:
--        create or replace function sehat_caller_password_expired()
--        returns boolean language sql stable as $$ select false $$;
--      Every gate then answers as it did before 0081, and the screen in 0080
--      still asks. Put it back afterwards.
--
-- NOT DONE HERE
--
--   Nothing expires today. Every account still reads as fresh, because 0080
--   gives a login with no recorded change a full window rather than none. The
--   first real expiry is ninety days after somebody first changes a password.
--   That is deliberate — this ships closed but idle, and the first thing it
--   does in anger is in three months, not tonight.
-- ============================================================================
