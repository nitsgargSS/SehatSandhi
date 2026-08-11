-- ============================================================================
-- Sehatsandhi — save the council and the Places id the signup form collects
--
-- Run AFTER 0035. Safe to re-run.
--
-- WHY
-- Step two now fills itself in from two places: the medical register, which
-- gives a registration number and the council that issued it, and Google Places,
-- which gives the address, phone and opening hours. Both write into the form,
-- the business corrects whatever is wrong, and then create_listing drops two of
-- the results on the floor because it has nowhere to put them.
--
-- Same shape of bug as reg_number had before 0003 — a field collected, edited,
-- and then discarded at the last step, which is the most annoying kind because
-- the form looks like it worked.
--
-- WHAT IS STORED IS WHAT THEY CONFIRMED
-- Nothing here records a suggestion. The wizard passes the value sitting in the
-- input at submit; a business that corrected Google's address saves their
-- version, not Google's. The suggestion is a starting point and stops mattering
-- the moment it is edited.
--
-- smc_id matters because a registration number alone is not an identity: 27776
-- belongs to a different doctor in each of seventeen councils, so without the
-- council the number cannot be checked against the register at all.
--
-- google_place_id is kept because Google's terms allow it indefinitely, and it
-- is what lets a listing be refreshed later — a clinic that moves or changes its
-- hours can be re-read rather than re-typed. Coordinates are deliberately NOT
-- stored: those may not be retained beyond thirty days, and can be re-resolved
-- from this id whenever they are actually needed.
-- ============================================================================

alter table doctors add column if not exists google_place_id text;

comment on column doctors.google_place_id is
  'Google Places id for this business, from the signup lookup. Stored so a '
  'listing can be refreshed from Places later. Not the source of truth for any '
  'field — the business edits everything before it is saved. Coordinates are '
  'deliberately absent: Google permits keeping this id but not lat/lng.';

-- ── create_listing gains the two new parameters ────────────────────────────
-- The old overload has to go first. Postgres resolves by argument list, and two
-- functions differing only in trailing defaults make every call ambiguous —
-- which is the same trap 0003 documented when it added reg_number.

drop function if exists public.create_listing(
  text, text, text, text, text[], text, text, text, integer, text, text, text, integer
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
  p_discount_applied integer default null,
  p_smc_id           integer default null,
  p_place_id         text default null
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
  -- imr_status is forced the same way and for the same reason. A caller that
  -- could set its own registration to 'confirmed' would be marking its own
  -- homework; it starts unchecked and only the service role moves it.
  insert into public.doctors (
    name, speciality, clinic_name, address, pin_codes,
    phone, email, qualification, consultation_fee, status,
    reg_number, working_hours, discount_code, discount_applied,
    smc_id, google_place_id, imr_status
  )
  values (
    btrim(p_name), p_speciality, p_clinic_name, p_address, coalesce(p_pin_codes, '{}'),
    p_phone, p_email, p_qualification, coalesce(p_consultation_fee, 0), 'pending',
    p_reg_number, p_working_hours, p_discount_code, p_discount_applied,
    p_smc_id, p_place_id, 'unchecked'
  )
  returning id into v_id;

  -- Only the id escapes. The caller learns nothing about any other row.
  return v_id;
end;
$$;

comment on function public.create_listing is
  'Creates a pending doctors/business listing and returns its id. Exists because '
  'an anonymous INSERT ... RETURNING cannot read its own row back under '
  'allow_read_active_doctors (status = ''active''). status and imr_status are '
  'forced here so a caller can neither publish itself nor declare its own '
  'registration verified.';

revoke all on function public.create_listing(
  text, text, text, text, text[], text, text, text, integer, text, text, text, integer, integer, text
) from public;

grant execute on function public.create_listing(
  text, text, text, text, text[], text, text, text, integer, text, text, text, integer, integer, text
) to anon, authenticated;
