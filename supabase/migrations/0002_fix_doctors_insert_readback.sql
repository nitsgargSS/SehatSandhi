--
-- Fix: business registration fails with "new row violates row-level security
-- policy for table doctors".
--
-- Symptom: /business/register and /partner cannot create a listing at all. The
-- wizard reports the RLS error at step 4, before Razorpay ever opens. This
-- affects production today.
--
-- Cause: the INSERT itself is permitted — allow_insert_doctors is
-- WITH CHECK (true). But the client calls .insert({...}).select('id').single(),
-- which sends PostgREST `Prefer: return=representation`. PostgREST inserts the
-- row and then SELECTs it back, and that read is filtered by
-- allow_read_active_doctors (status = 'active'). A new listing is
-- status = 'pending', so it is invisible to the very request that created it,
-- and the failed read-back surfaces as an RLS violation on the insert.
--
-- Verified before writing this: the identical insert succeeds with
-- `Prefer: return=minimal` (no read-back), and succeeds when status is forced
-- to 'active'. Inserting as the `anon` role directly in SQL also succeeds.
--
-- Fix: a SECURITY DEFINER function that performs the insert and returns only
-- the new id. The caller never SELECTs the table, so no read policy is
-- involved and none has to be loosened.
--
-- Considered and rejected: a policy allowing pending rows to be read back.
-- Every formulation either lets an anonymous caller enumerate pending listings
-- — exposing the phone and address of businesses that have not been approved —
-- or reduces to `email = email`, which is the same thing wearing a disguise.
--

create or replace function public.create_listing(
  p_name             text,
  p_speciality       text,
  p_clinic_name      text default null,
  p_address          text default null,
  p_pin_codes        text[] default '{}',
  p_phone            text default null,
  p_email            text default null,
  p_qualification    text default null,
  p_consultation_fee integer default 0
)
returns uuid
language plpgsql
security definer
-- Pin the search path: a SECURITY DEFINER function without this can be
-- hijacked by a caller-controlled search_path.
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name is required';
  end if;

  -- status is forced here, never taken from the caller: a listing must not be
  -- able to self-activate and appear in public search without review or
  -- payment. razorpay-verify is the only thing that flips it to 'active'.
  insert into public.doctors (
    name, speciality, clinic_name, address, pin_codes,
    phone, email, qualification, consultation_fee, status
  )
  values (
    btrim(p_name), p_speciality, p_clinic_name, p_address, coalesce(p_pin_codes, '{}'),
    p_phone, p_email, p_qualification, coalesce(p_consultation_fee, 0), 'pending'
  )
  returning id into v_id;

  -- Only the id escapes. The caller learns nothing about any other row.
  return v_id;
end;
$$;

comment on function public.create_listing is
  'Creates a pending doctors/business listing and returns its id. Exists because '
  'an anonymous INSERT ... RETURNING cannot read its own row back under '
  'allow_read_active_doctors (status = ''active''). status is forced to '
  '''pending'' server-side so a caller cannot self-activate a listing.';

revoke all on function public.create_listing from public;
grant execute on function public.create_listing to anon, authenticated;
