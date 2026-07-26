--
-- Extend create_listing to cover the doctor registration form.
--
-- /doctor hits the same read-back failure that 0002 fixed for the business
-- wizard: it calls .insert({...}).select().single() and needs the new id to
-- write discount_code_usage. But it also sets reg_number, working_hours and
-- the discount snapshot, which 0002's signature does not accept.
--
-- Adding optional parameters rather than a second function, so there is one
-- place where a listing is created and one place where status is forced.
--
-- The added parameters are all nullable with defaults, so the existing
-- business-wizard call — which passes neither — keeps working unchanged.
--

-- Drop the 9-argument version from 0002 FIRST. Creating the wider overload
-- first would leave two functions whose calls are ambiguous once the extra
-- parameters have defaults, and the DROP itself then fails as "not unique".
drop function if exists public.create_listing(
  text, text, text, text, text[], text, text, text, integer
);

create or replace function public.create_listing(
  p_name             text,
  p_speciality       text,
  p_clinic_name      text default null,
  p_address          text default null,
  p_pin_codes        text[] default '{}',
  p_phone            text default null,
  p_email            text default null,
  p_qualification    text default null,
  p_consultation_fee integer default 0,
  p_reg_number       text default null,
  p_working_hours    text default null,
  p_discount_code    text default null,
  p_discount_applied integer default null
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
  --
  -- p_discount_code / p_discount_applied are a snapshot of what the coupon was
  -- worth at signup. They are recorded, not trusted: the actual charge is
  -- recomputed server-side by the pricing function, so a caller inflating the
  -- discount here changes a display value and not an amount.
  insert into public.doctors (
    name, speciality, clinic_name, address, pin_codes,
    phone, email, qualification, consultation_fee, status,
    reg_number, working_hours, discount_code, discount_applied
  )
  values (
    btrim(p_name), p_speciality, p_clinic_name, p_address, coalesce(p_pin_codes, '{}'),
    p_phone, p_email, p_qualification, coalesce(p_consultation_fee, 0), 'pending',
    p_reg_number, p_working_hours, p_discount_code, p_discount_applied
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
