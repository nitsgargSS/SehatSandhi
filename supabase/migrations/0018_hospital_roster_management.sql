-- ============================================================================
-- Sehatsandhi — a hospital manages its own consultants
--
-- Run AFTER 0017. Safe to re-run.
--
-- 0016 let a hospital list its doctors at signup, and the wizard promises they
-- can change that later from the dashboard. This is that promise. Without it a
-- hospital hiring a consultant would have had to ask us to edit the database,
-- and would keep paying for one who had left.
--
-- WHY RPCs RATHER THAN PLAIN POLICIES
-- A consultant's row has no email of its own, so the existing doctors_update_own
-- policy — which matches auth.jwt() email against the row — can never authorise
-- the hospital that employs them. Authority comes from the organisation instead,
-- and it is checked in one place rather than restated in every policy.
--
-- REMOVING IS SUSPENDING
-- Deleting a consultant would orphan their appointments and erase the history of
-- who a patient actually saw. Suspension takes them out of search, out of the
-- roster and out of the bill, and leaves the record intact.
-- ============================================================================

-- ── Who may manage an organisation ─────────────────────────────────────────

create or replace function sehat_caller_owns_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and (
    sehat_is_admin()
    -- The hospital's own listing carries the login email. Its consultants have
    -- none, which is exactly why they cannot be authorised row by row.
    or exists (
      select 1 from doctors l
       where l.organization_id = p_org
         and not l.is_hospital_doctor
         and l.email = auth.jwt() ->> 'email'
    )
    or exists (
      select 1 from clinic_users cu
       join doctors l on l.id = cu.doctor_id
       where l.organization_id = p_org
         and cu.supabase_user_id = auth.uid()
         and cu.is_active
    )
  );
$$;

comment on function sehat_caller_owns_org is
  'True when the caller is an admin, the hospital''s own listing login, or '
  'active staff of it. The single authority check for roster changes.';

-- ── A hospital sees its whole roster, including pending and suspended ──────
-- allow_read_active_doctors only exposes active rows, so without this a
-- hospital could not see the consultant it just added, nor one it suspended.

drop policy if exists "org_owner_reads_roster" on doctors;
create policy "org_owner_reads_roster" on doctors
  for select using (
    organization_id is not null and sehat_caller_owns_org(organization_id)
  );

-- ── Add ────────────────────────────────────────────────────────────────────

create or replace function sehat_org_add_doctor(
  p_org_listing_id  uuid,
  p_name            text,
  p_speciality      text default 'GEN',
  p_qualification   text default null,
  p_phone           text default null,
  p_consultation_fee integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_listing doctors;
  v_new uuid;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a doctor needs a name';
  end if;

  select * into v_listing from doctors where id = p_org_listing_id;
  if not found or v_listing.organization_id is null then
    raise exception 'that listing is not a hospital';
  end if;
  v_org := v_listing.organization_id;

  if not sehat_caller_owns_org(v_org) then
    raise exception 'you are not authorised to manage this hospital''s doctors'
      using errcode = 'insufficient_privilege';
  end if;

  -- Inherits the hospital's coverage and address so the consultant appears in
  -- the same searches. Status is forced to pending: a new consultant is a new
  -- listing and goes through the same approval as any other.
  insert into doctors (
    name, speciality, qualification, clinic_name, address, pin_codes,
    phone, consultation_fee, status, organization_id, is_hospital_doctor
  ) values (
    btrim(p_name),
    coalesce(nullif(p_speciality, ''), 'GEN'),
    p_qualification,
    v_listing.clinic_name,
    v_listing.address,
    v_listing.pin_codes,
    coalesce(nullif(p_phone, ''), v_listing.phone),
    coalesce(p_consultation_fee, 0),
    'pending',
    v_org,
    true
  )
  returning id into v_new;

  return v_new;
end $$;

grant execute on function sehat_org_add_doctor(uuid, text, text, text, text, integer)
  to authenticated;

-- ── Remove (suspend) and restore ───────────────────────────────────────────

create or replace function sehat_org_set_doctor_status(
  p_doctor_id uuid,
  p_status    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if p_status not in ('active', 'pending', 'suspended') then
    raise exception 'unknown status: %', p_status;
  end if;

  select organization_id into v_org from doctors
   where id = p_doctor_id and is_hospital_doctor;
  if v_org is null then
    raise exception 'that doctor is not part of a hospital';
  end if;

  if not sehat_caller_owns_org(v_org) then
    raise exception 'you are not authorised to manage this hospital''s doctors'
      using errcode = 'insufficient_privilege';
  end if;

  -- A hospital may suspend or restore, but never activate: approval is ours.
  -- Restoring returns them to pending so they are re-checked.
  update doctors
     set status = case when p_status = 'active' then 'pending' else p_status end
   where id = p_doctor_id;
end $$;

grant execute on function sehat_org_set_doctor_status(uuid, text) to authenticated;

comment on function sehat_org_set_doctor_status is
  'Suspend or restore a consultant. Never activates — a restored consultant '
  'returns to pending so approval stays with admin. Suspended consultants leave '
  'search, the roster and the bill, but keep their appointment history.';
