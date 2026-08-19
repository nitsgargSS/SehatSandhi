-- ============================================================================
-- Sehatsandhi — the three functions the rename left pointing at nothing
--
-- Run AFTER 0042. Safe to re-run.
--
-- WHAT IS BROKEN RIGHT NOW
-- Every insert into `appointments` fails. Two of the three functions below are
-- BEFORE INSERT triggers on that table, and both still name columns that 0037
-- renamed, so the trigger raises before any row is written. Nothing has
-- surfaced it because 0037 deleted every appointment and nothing has booked
-- since — the failure is waiting for the first person who tries.
--
-- WHY 0039 DID NOT CATCH THESE
-- 0039 went looking for functions whose bodies still referenced the DROPPED
-- tables — doctors, organizations, clinic_users — and fixed the five it found.
-- These three reference RENAMED ones, and a rename drops nothing:
--
--   doctor_availability  ->  availability        (table renamed)
--   ap.doctor_id         ->  ap.business_id      (column renamed)
--
-- Neither string contains the word `doctors`, so a search for the dropped
-- tables could not have matched them. They are old-style quoted function
-- bodies, which Postgres re-parses at execution rather than at creation, so
-- nothing complained when the rename ran.
--
--   sehat_default_appointment_location   BEFORE INSERT on appointments
--   sehat_check_appointment_capacity     BEFORE INSERT OR UPDATE on appointments
--   sehat_open_windows                   read by the dashboard and the bot
--
-- WHAT ELSE CHANGES, AND WHY IT IS NOT JUST A RENAME
-- 0037 gave appointments a practitioner_id and moved availability onto the
-- affiliation. That makes two of these functions not merely misspelt but
-- wrong:
--
--   • "one doctor cannot be in two buildings at once" was enforced per LISTING,
--     because a listing was the only thing an appointment pointed at. A
--     business with two doctors genuinely can run two rooms at one instant, so
--     enforcing it per business now blocks legitimate bookings. It is a fact
--     about a person, so it moves to practitioner_id.
--
--   • capacity came from the listing's hours. Hours now belong to the posting,
--     so a window is looked up for the practitioner being booked, falling back
--     to the business's own hours where that doctor has published none.
--
-- The offer and the check are kept in step deliberately: sehat_open_windows and
-- the capacity trigger read availability the same way and count occupancy the
-- same way. A window this file offers is one this file will accept.
-- ============================================================================


-- ── The primary location a booking defaults to ─────────────────────────────
-- practice_locations.doctor_id and appointments.doctor_id are both business_id
-- now. Nothing else about this one changed.

create or replace function sehat_default_appointment_location()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.location_id is null then
    select id into new.location_id
      from practice_locations
     where business_id = new.business_id and is_primary and is_active
     limit 1;
  end if;
  return new;
end $$;

comment on function sehat_default_appointment_location is
  'Puts a booking at the business''s primary branch when the caller named no '
  'location. The bot never names one.';


-- ── Which availability row governs a booking ───────────────────────────────
-- Shared by the trigger and by sehat_open_windows so the two cannot drift.
--
-- A doctor's own published hours win. Where they have published none, the
-- business's own hours apply — a clinic that has not split its day per doctor
-- still takes bookings, which is the behaviour 0014 chose and worth keeping.

create or replace function sehat_governing_windows(
  p_business_id uuid,
  p_practitioner_id uuid,
  p_dow integer
)
returns setof availability
language sql stable security definer set search_path = public as $$
  with affiliation as (
    select bp.id
      from business_practitioners bp
     where bp.business_id = p_business_id
       and bp.practitioner_id = p_practitioner_id
       and p_practitioner_id is not null
     limit 1
  ),
  own as (
    select a.* from availability a
     where a.business_id = p_business_id
       and a.is_active
       and a.day_of_week = p_dow
       and a.business_practitioner_id = (select id from affiliation)
  ),
  house as (
    select a.* from availability a
     where a.business_id = p_business_id
       and a.is_active
       and a.day_of_week = p_dow
       and a.business_practitioner_id is null
  )
  select * from own
  union all
  select * from house where not exists (select 1 from own);
$$;

comment on function sehat_governing_windows is
  'The availability rows that decide a booking: the practitioner''s own hours '
  'at this business, or the business''s own hours where that doctor has '
  'published none. One definition, read by both the offer and the check.';


-- ── Capacity, and one PERSON in one place at a time ────────────────────────

create or replace function sehat_check_appointment_capacity()
returns trigger language plpgsql
set search_path = public
as $$
declare
  v_capacity integer;
  v_taken    integer;
  v_clash    integer;
begin
  -- A cancellation frees a seat; it never needs one.
  if new.status = 'cancelled' then return new; end if;

  -- A person cannot be in two buildings in the same window. Enforced on the
  -- practitioner now that appointments carry one: doing it per business would
  -- stop a two-doctor clinic running two rooms at once, which is not a clash
  -- but the ordinary case. Where the booking names nobody — a pharmacy order,
  -- a lab test — there is no person to double-book and the rule does not apply.
  if new.practitioner_id is not null then
    select count(*) into v_clash
      from appointments
     where practitioner_id = new.practitioner_id
       and slot_datetime = new.slot_datetime
       and status <> 'cancelled'
       and id is distinct from new.id
       and location_id is distinct from new.location_id
       and location_id is not null and new.location_id is not null;

    if v_clash > 0 then
      raise exception 'This doctor is already booked at another location for %', new.slot_datetime
        using errcode = 'check_violation';
    end if;
  end if;

  -- Capacity comes from the window covering this time. If nobody has published
  -- hours there is no number to enforce and the booking goes through: refusing
  -- here would mean an unconfigured business takes no bookings at all, which is
  -- worse than an over-full hour.
  select a.slot_capacity into v_capacity
    from sehat_governing_windows(
           new.business_id, new.practitioner_id,
           extract(dow from new.slot_datetime at time zone 'Asia/Kolkata')::integer) a
   where (a.location_id is null or a.location_id = new.location_id)
     and (new.slot_datetime at time zone 'Asia/Kolkata')::time >= a.start_time
     and (new.slot_datetime at time zone 'Asia/Kolkata')::time <  a.end_time
   order by a.location_id nulls last
   limit 1;

  if v_capacity is null then return new; end if;

  -- Counted the same way the window was offered: against the doctor when the
  -- booking names one, against the business otherwise.
  select count(*) into v_taken
    from appointments
   where business_id = new.business_id
     and slot_datetime = new.slot_datetime
     and status <> 'cancelled'
     and id is distinct from new.id
     and (new.practitioner_id is null or practitioner_id = new.practitioner_id);

  if v_taken >= v_capacity then
    raise exception 'That % window is full (% of % booked). Please choose another time.',
      to_char(new.slot_datetime at time zone 'Asia/Kolkata', 'HH12:MI AM'), v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function sehat_check_appointment_capacity is
  'Enforces per-window capacity where hours are published, and that one '
  'practitioner is in one place at a time. Silent when nothing is published — '
  'never blocks a booking for want of configuration.';

-- The triggers themselves survived the rename (they name the function, not the
-- columns), but they are re-declared so a fresh database built from migrations
-- alone ends up with them.
drop trigger if exists appointments_default_location on appointments;
create trigger appointments_default_location
  before insert on appointments
  for each row execute function sehat_default_appointment_location();

drop trigger if exists appointments_check_capacity on appointments;
create trigger appointments_check_capacity
  before insert or update of slot_datetime, status, location_id, business_id, practitioner_id
  on appointments
  for each row execute function sehat_check_appointment_capacity();


-- ── What the dashboard and the bot offer ───────────────────────────────────
--
-- The parameter is renamed p_doctor_id -> p_business_id, which a caller sees:
-- PostgREST passes RPC arguments by name. src/lib/availability.ts is updated in
-- the same commit. Dropped first because Postgres will not rename a parameter
-- in place, and the practitioner argument has to be added anyway.

drop function if exists sehat_open_windows(uuid, date);

create or replace function sehat_open_windows(
  p_business_id uuid,
  p_date date,
  p_practitioner_id uuid default null
)
returns table (
  location_id   uuid,
  location_name text,
  location_address text,
  window_start  timestamptz,
  window_end    timestamptz,
  capacity      integer,
  booked        integer,
  seats_left    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with governing as (
    select a.*
      from sehat_governing_windows(
             p_business_id, p_practitioner_id,
             extract(dow from p_date)::integer) a
  ),
  windows as (
    select
      g.location_id,
      p.name    as location_name,
      p.address as location_address,
      g.slot_capacity,
      generate_series(
        (p_date + g.start_time) at time zone 'Asia/Kolkata',
        (p_date + g.end_time)   at time zone 'Asia/Kolkata'
          - make_interval(mins => g.slot_duration_minutes),
        make_interval(mins => g.slot_duration_minutes)
      ) as window_start,
      g.slot_duration_minutes
    from governing g
    left join practice_locations p on p.id = g.location_id
  )
  select
    w.location_id,
    w.location_name,
    w.location_address,
    w.window_start,
    w.window_start + make_interval(mins => w.slot_duration_minutes),
    w.slot_capacity,
    coalesce(b.taken, 0)::integer,
    greatest(0, w.slot_capacity - coalesce(b.taken, 0))::integer
  from windows w
  left join lateral (
    select count(*)::integer as taken
      from appointments ap
     where ap.business_id = p_business_id
       and ap.slot_datetime = w.window_start
       and ap.status <> 'cancelled'
       and (p_practitioner_id is null or ap.practitioner_id = p_practitioner_id)
  ) b on true
  order by w.window_start;
$$;

comment on function sehat_open_windows is
  'Bookable windows for one business on one date, optionally for one '
  'practitioner, with seats left. SECURITY DEFINER so the bot and the public '
  'booking page can see availability without reading the appointments behind '
  'it. Counts occupancy exactly as the capacity trigger does.';

grant execute on function sehat_open_windows(uuid, date, uuid) to anon, authenticated;
grant execute on function sehat_governing_windows(uuid, uuid, integer) to anon, authenticated;
