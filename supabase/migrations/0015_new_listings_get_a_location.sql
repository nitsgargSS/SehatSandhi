-- ============================================================================
-- Sehatsandhi — every listing gets a primary location, not just the old ones
--
-- Run AFTER 0014. Safe to re-run.
--
-- 0014 backfilled a primary location for every doctor that existed when it ran,
-- which is a one-time INSERT ... SELECT. Listings created afterwards got none —
-- so a business signing up through the wizard would have had no location at all,
-- sehat_default_appointment_location would have left location_id null, and the
-- patient would still not be told which building to walk into. The backfill
-- looked like the whole job and was only half of it.
--
-- Caught by a test that created a doctor and asked for its locations before
-- assuming there was one.
-- ============================================================================

create or replace function sehat_create_primary_location()
returns trigger language plpgsql
security definer
set search_path = public
as $$
begin
  -- Built from what the listing already carries, so the wizard needs no extra
  -- question and an existing signup flow keeps working unchanged.
  insert into practice_locations (doctor_id, name, address, pin_code, phone, is_primary)
  values (
    new.id,
    coalesce(nullif(btrim(new.clinic_name), ''), new.name, 'Main clinic'),
    new.address,
    case when array_length(new.pin_codes, 1) > 0 then new.pin_codes[1] end,
    new.phone,
    true
  )
  on conflict do nothing;
  return new;
end $$;

comment on function sehat_create_primary_location is
  'Gives every new listing a primary location, so bookings always resolve to an '
  'address. The clinic renames it or adds branches from its dashboard.';

drop trigger if exists doctors_create_primary_location on doctors;
create trigger doctors_create_primary_location
  after insert on doctors
  for each row execute function sehat_create_primary_location();

-- Repair: any listing created between 0014 and this migration, plus any whose
-- primary was deactivated, leaving branches but no fallback.

insert into practice_locations (doctor_id, name, address, pin_code, phone, is_primary)
select d.id,
       coalesce(nullif(btrim(d.clinic_name), ''), d.name, 'Main clinic'),
       d.address,
       case when array_length(d.pin_codes, 1) > 0 then d.pin_codes[1] end,
       d.phone,
       true
from doctors d
where not exists (
  select 1 from practice_locations p
   where p.doctor_id = d.id and p.is_primary and p.is_active
);

-- Appointments that were created in that window with no location.
update appointments a
   set location_id = p.id
  from practice_locations p
 where a.location_id is null and p.doctor_id = a.doctor_id and p.is_primary and p.is_active;
