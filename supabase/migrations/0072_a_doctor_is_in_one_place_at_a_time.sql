-- ============================================================================
-- Sehatsandhi — a doctor booked at one clinic is busy at all of them
--
-- Run AFTER 0071. Safe to re-run.
--
-- ── WHAT WAS ASKED FOR ──────────────────────────────────────────────────────
-- A practitioner affiliated to two businesses gets booked for 10:00 at the
-- clinic. That 10:00 must stop being offered at the hospital. Today it is still
-- offered, the patient picks it, and the booking is refused at the last moment
-- — or, worse, accepted. Both halves are broken, for different reasons.
--
-- ── HALF ONE: THE GUARD HAS NEVER RUN FOR A CLINIC USER ─────────────────────
-- sehat_check_appointment_capacity has carried a cross-location clash check
-- since 0014, rewritten onto the practitioner in 0045. It reads:
--
--     select count(*) into v_clash from appointments
--      where practitioner_id = new.practitioner_id and ...
--
-- The function is SECURITY INVOKER. A trigger body reading a table gets that
-- table's RLS applied to it, so the query above can only see appointments the
-- *caller* is allowed to see. The whole point of the check is to look at a
-- business the caller does not own, and RLS is what stops it.
--
-- Before 0068, `appointments` had no clinic SELECT policy at all, so the count
-- came back 0 for every authenticated caller and the guard passed everything.
-- 0068 added clinic_reads_appointments, scoped to the caller's own businesses —
-- which means the count still comes back 0 for exactly the rows the check
-- exists to find. The guard has never once fired for a clinic booking from the
-- dashboard.
--
-- It does fire on the WhatsApp path, because bot_book_at runs as service_role,
-- which holds BYPASSRLS. So the behaviour differs by booking channel, which is
-- why it looked like it worked.
--
-- Fixed by making the trigger SECURITY DEFINER. Seeing across tenants is the
-- function's job, not an oversight — it is the one thing it exists to do.
--
-- ── HALF TWO: EXACT EQUALITY IS NOT OVERLAP ─────────────────────────────────
-- Both the guard and the offer compare `slot_datetime = slot_datetime`. Two
-- businesses rarely run the same grid: a clinic on 30-minute windows and a
-- hospital on 15 puts 10:00 against 10:15, which overlap and compare unequal.
-- Now compared as ranges, using each booking's own governing window to know how
-- long it lasts (sehat_slot_end below).
--
-- ── HALF THREE: THE GUARD RAN BEFORE THE DATA IT TESTED ─────────────────────
-- This is the one that made the other two academic. The old check ended with
--
--     and location_id is not null and new.location_id is not null
--
-- and PostgreSQL fires BEFORE triggers in alphabetical order by trigger name:
--
--     appointments_check_capacity      <- reads new.location_id
--     appointments_default_location    <- sets new.location_id
--
-- No caller passes location_id; the default trigger fills it from the business's
-- primary practice_location. So at the moment the guard ran, new.location_id was
-- always null, the test above was always false, and the clash check was skipped
-- for every booking made through either surface. Measured on sandbox before this
-- migration: the same doctor, the same minute, two businesses — accepted as
-- service_role and as authenticated. Passing location_id by hand made
-- service_role refuse it, which is how the ordering was found.
--
-- Fixed by renaming the default-location trigger to sort first. The guard also
-- stops depending on a non-null location: the place two bookings are at is now
-- compared as (business, location), so a business that has no primary location
-- to default to is still covered by its business_id.
--
-- ── AND THE OFFER ITSELF ────────────────────────────────────────────────────
-- sehat_open_windows counted occupancy inside p_business_id only, so the
-- hospital never knew about the clinic's 10:00. It is the shared source for
-- both surfaces — src/lib/availability.ts for the dashboard, bot_slot_options
-- for WhatsApp — so fixing it there fixes both. It returns a new
-- `blocked_elsewhere` column and forces seats_left to 0 for those windows, so a
-- caller that only reads seats_left behaves correctly without being changed.
-- ============================================================================


-- ── How long a booking occupies ─────────────────────────────────────────────
--
-- An appointment stores only its start. Its length is the slot_duration_minutes
-- of the window that governs it AT ITS OWN BUSINESS, which is what makes the
-- cross-clinic comparison honest: the clinic's 30 minutes and the hospital's 15
-- are each measured by their own grid.
--
-- SECURITY DEFINER for the same reason as the trigger — it is asked about
-- businesses the caller does not own. It reads only availability rows, and
-- returns a timestamp, so it discloses nothing beyond a duration.
--
-- The 15-minute fallback covers a booking that no published window governs: one
-- made outside opening hours, or at a business that has never set availability.
-- Occupying a quarter of an hour is a conservative guess; occupying nothing
-- would mean such a booking blocks nobody, which is the bug this is fixing.

create or replace function sehat_slot_end(
  p_business_id uuid,
  p_practitioner_id uuid,
  p_slot timestamptz
) returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_slot + make_interval(mins => coalesce((
    select a.slot_duration_minutes
      from sehat_governing_windows(
             p_business_id, p_practitioner_id,
             extract(dow from p_slot at time zone 'Asia/Kolkata')::integer) a
     where (p_slot at time zone 'Asia/Kolkata')::time >= a.start_time
       and (p_slot at time zone 'Asia/Kolkata')::time <  a.end_time
     order by a.location_id nulls last
     limit 1
  ), 15));
$$;

comment on function sehat_slot_end is
  'Added in 0072. The end of the window a booking occupies, measured by the '
  'slot_duration_minutes published at its own business. SECURITY DEFINER because '
  'the cross-clinic clash check asks it about businesses the caller does not own.';

grant execute on function sehat_slot_end(uuid, uuid, timestamptz)
  to anon, authenticated, service_role;


-- ── The guard ───────────────────────────────────────────────────────────────

-- Order first, because the guard reads what this trigger writes. BEFORE triggers
-- fire in name order, and `appointments_check_capacity` sorts ahead of
-- `appointments_default_location`, which is why the clash check has been reading
-- a null location on every insert. The `a_` is load-bearing; it is not a tidy-up.

drop trigger if exists appointments_default_location on appointments;
drop trigger if exists appointments_a_default_location on appointments;
create trigger appointments_a_default_location
  before insert on appointments
  for each row execute function sehat_default_appointment_location();

comment on trigger appointments_a_default_location on appointments is
  'Renamed in 0072 so it sorts before appointments_check_capacity. BEFORE '
  'triggers fire in name order, and the capacity trigger tests location_id, '
  'which this one is what sets.';


create or replace function sehat_check_appointment_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_capacity  integer;
  v_taken     integer;
  v_new_end   timestamptz;
  v_clash_at  text;
  v_clash_when timestamptz;
begin
  -- A cancellation frees a seat; it never needs one.
  if new.status = 'cancelled' then return new; end if;

  -- A person cannot be in two places in the same window. Enforced on the
  -- practitioner, because that is who cannot be in two places: doing it per
  -- business would stop a two-doctor clinic running two rooms at once, which is
  -- not a clash but the ordinary case. Where the booking names nobody — a
  -- pharmacy order, a lab test — there is no person to double-book and the rule
  -- does not apply.
  --
  -- "Another place" is (business, location), not location alone. Two bookings
  -- at the same business and the same location are the capacity question below,
  -- not this one: a window may legitimately seat several.
  if new.practitioner_id is not null then
    v_new_end := sehat_slot_end(new.business_id, new.practitioner_id, new.slot_datetime);

    select b.name, ap.slot_datetime into v_clash_at, v_clash_when
      from appointments ap
      join businesses b on b.id = ap.business_id
     where ap.practitioner_id = new.practitioner_id
       and ap.status <> 'cancelled'
       and ap.id is distinct from new.id
       and (ap.business_id is distinct from new.business_id
            or ap.location_id is distinct from new.location_id)
       -- Bounded so appointments_practitioner_idx can be used. No published
       -- window is twelve hours long; the exact test is the overlap below.
       and ap.slot_datetime >= new.slot_datetime - interval '12 hours'
       and ap.slot_datetime <  v_new_end
       and tstzrange(ap.slot_datetime,
                     sehat_slot_end(ap.business_id, ap.practitioner_id, ap.slot_datetime),
                     '[)')
           && tstzrange(new.slot_datetime, v_new_end, '[)')
     order by ap.slot_datetime
     limit 1;

    if found then
      raise exception 'This doctor is already booked at % for %',
        v_clash_at, to_char(v_clash_when at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM')
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
  'Fixed in 0072. Was SECURITY INVOKER, so the cross-location clash check it '
  'exists to perform was filtered out by the RLS on appointments and had never '
  'fired for a clinic user — only for service_role on the WhatsApp path. Also '
  'compared slots for equality rather than overlap, and switched itself off '
  'when either location_id was null.';


-- ── The offer ───────────────────────────────────────────────────────────────
--
-- Dropped rather than replaced: the result columns change, and CREATE OR REPLACE
-- cannot do that. Nothing depends on it structurally — bot_slot_options has a
-- string body, so it carries no dependency — but the grants go with the drop and
-- are restored below.

drop function if exists sehat_open_windows(uuid, date, uuid);

create function sehat_open_windows(
  p_business_id uuid,
  p_date date,
  p_practitioner_id uuid default null
) returns table(
  location_id uuid,
  location_name text,
  location_address text,
  window_start timestamptz,
  window_end timestamptz,
  capacity integer,
  booked integer,
  seats_left integer,
  blocked_elsewhere boolean
)
language sql
stable
security definer
set search_path to 'public'
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
    -- A window the doctor is already committed to elsewhere has no seats,
    -- whatever the local capacity says. Callers reading only seats_left — every
    -- one of them today — get the right answer without being changed.
    case when e.clash then 0
         else greatest(0, w.slot_capacity - coalesce(b.taken, 0))::integer end,
    e.clash
  from windows w
  left join lateral (
    select count(*)::integer as taken
      from appointments ap
     where ap.business_id = p_business_id
       and ap.slot_datetime = w.window_start
       and ap.status <> 'cancelled'
       and (p_practitioner_id is null or ap.practitioner_id = p_practitioner_id)
  ) b on true
  -- Anywhere else this doctor is expected to be. Same shape as the trigger, so
  -- what is offered and what is accepted cannot disagree: overlapping spans,
  -- and "elsewhere" meaning a different (business, location).
  cross join lateral (
    select p_practitioner_id is not null and exists (
      select 1
        from appointments ap
       where ap.practitioner_id = p_practitioner_id
         and ap.status <> 'cancelled'
         and (ap.business_id is distinct from p_business_id
              or ap.location_id is distinct from w.location_id)
         and ap.slot_datetime >= w.window_start - interval '12 hours'
         and ap.slot_datetime <  w.window_start + make_interval(mins => w.slot_duration_minutes)
         and tstzrange(ap.slot_datetime,
                       sehat_slot_end(ap.business_id, ap.practitioner_id, ap.slot_datetime),
                       '[)')
             && tstzrange(w.window_start,
                          w.window_start + make_interval(mins => w.slot_duration_minutes),
                          '[)')
    ) as clash
  ) e
  order by w.window_start;
$$;

comment on function sehat_open_windows is
  'Fixed in 0072. Counted occupancy within p_business_id only, so a doctor '
  'booked at one clinic was still offered the same hour at another. Now returns '
  'blocked_elsewhere and zero seats for those windows.';

grant execute on function sehat_open_windows(uuid, date, uuid)
  to anon, authenticated, service_role;


-- ============================================================================
-- NOT DONE HERE, AND WORTH KNOWING
--
--   sehat_reschedule_appointment carries its own friendlier pre-check —
--   "that slot is already taken" — and it still compares slot_datetime for
--   equality. It is not the enforcement; the trigger above fires on UPDATE OF
--   slot_datetime and will catch an overlapping reschedule with the better
--   message. Left alone so that one behaviour has one owner.
--
--   src/pages/doctor/Dashboard.tsx:658 calls fetchOpenWindows without a
--   practitioner when rescheduling, so the reschedule picker still offers
--   windows this doctor is committed to elsewhere. The trigger refuses them on
--   submit, so it is a bad offer rather than a double booking. Fixing it means
--   knowing which practitioner the appointment belongs to at that point, which
--   the component does not currently load.
-- ============================================================================
