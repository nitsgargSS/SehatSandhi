-- ============================================================================
-- Sehatsandhi — multiple practice locations, and hourly booking windows
--
-- Run AFTER 0013. Safe to re-run.
--
-- TWO CHANGES, ONE MIGRATION
-- They rewrite the same tables. Doing them separately would mean migrating
-- appointments twice and backfilling location twice.
--
-- 1. A doctor sits in more than one place. Until now a listing had one address,
--    so "Mon-Wed Jagadhri, Thu-Sat Radaur" could not be said at all, and a
--    patient was never told which building to walk into.
--
-- 2. Bookings move from 15-minute slots to hourly windows. The blocker was
--    idx_no_double_booking, UNIQUE (doctor_id, slot_datetime) — exactly one
--    appointment per doctor per instant. Correct for a 15-minute slot, fatal for
--    a 12-1 window, where the second patient's booking simply fails. It is
--    replaced below by a capacity rule the clinic sets per location.
--
-- THE BOT MUST KEEP WORKING
-- Appointments are created by the WhatsApp bot, a separate backend that knows
-- nothing about locations. So location_id is nullable and filled in with the
-- doctor's primary location by trigger, and capacity is enforced only where the
-- clinic has actually published hours. An unconfigured clinic books exactly as
-- it does today. Nothing here can stop a patient booking.
-- ============================================================================

-- ── Locations ──────────────────────────────────────────────────────────────

create table if not exists practice_locations (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references doctors(id) on delete cascade,

  name text not null,                       -- 'Main clinic', 'Radaur branch'
  address text,
  pin_code text,
  landmark text,
  phone text,                               -- often a different desk per branch

  -- Where bookings and patients go when nothing more specific is known — which
  -- is every booking the bot makes until it learns to ask.
  is_primary boolean not null default false,
  is_active boolean not null default true,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Exactly one primary per doctor. Partial, so deactivated rows do not collide.
create unique index if not exists practice_locations_one_primary
  on practice_locations (doctor_id) where is_primary and is_active;

create index if not exists practice_locations_doctor_idx
  on practice_locations (doctor_id) where is_active;

drop trigger if exists practice_locations_touch on practice_locations;
create trigger practice_locations_touch before update on practice_locations
  for each row execute function sehat_touch_updated_at();

comment on table practice_locations is
  'Where a doctor actually sits. A listing may have several; the primary is the '
  'fallback for anything that does not name one, including every booking the '
  'WhatsApp bot makes until it starts asking.';

-- ── Backfill: one primary location per existing listing ────────────────────
-- Built from the address already on the listing, so no clinic has to re-enter
-- what it has already told us.

insert into practice_locations (doctor_id, name, address, pin_code, phone, is_primary)
select d.id,
       coalesce(nullif(btrim(d.clinic_name), ''), d.name, 'Main clinic'),
       d.address,
       case when array_length(d.pin_codes, 1) > 0 then d.pin_codes[1] end,
       d.phone,
       true
from doctors d
where not exists (select 1 from practice_locations p where p.doctor_id = d.id);

-- ── Availability becomes per location, and gains capacity ──────────────────

alter table doctor_availability
  add column if not exists location_id uuid references practice_locations(id) on delete cascade;

-- How many patients one window holds. Set per location by the clinic: a busy
-- OPD might take 8 an hour where a specialist takes 3.
alter table doctor_availability
  add column if not exists slot_capacity integer not null default 4;

do $$ begin
  alter table doctor_availability add constraint doctor_availability_capacity_sane
    check (slot_capacity between 1 and 200) not valid;
exception when duplicate_object then null; end $$;

update doctor_availability a
   set location_id = p.id
  from practice_locations p
 where a.location_id is null and p.doctor_id = a.doctor_id and p.is_primary;

create index if not exists doctor_availability_location_idx
  on doctor_availability (location_id, day_of_week) where is_active;

comment on column doctor_availability.slot_capacity is
  'Patients per window. With slot_duration_minutes = 60 this is patients per '
  'hour. Enforced by sehat_check_appointment_capacity.';

-- ── Appointments carry a location ──────────────────────────────────────────

alter table appointments
  add column if not exists location_id uuid references practice_locations(id) on delete set null;

update appointments a
   set location_id = p.id
  from practice_locations p
 where a.location_id is null and p.doctor_id = a.doctor_id and p.is_primary;

create index if not exists appointments_location_slot_idx
  on appointments (location_id, slot_datetime) where status <> 'cancelled';

-- ── The unique index that blocks hourly windows ────────────────────────────
-- One appointment per doctor per instant is exactly what a 12-1 window must not
-- be. Replaced by the capacity trigger below.

drop index if exists idx_no_double_booking;

-- ── Default a missing location, so the bot needs no change ─────────────────

create or replace function sehat_default_appointment_location()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.location_id is null then
    select id into new.location_id
      from practice_locations
     where doctor_id = new.doctor_id and is_primary and is_active
     limit 1;
  end if;
  return new;
end $$;

drop trigger if exists appointments_default_location on appointments;
create trigger appointments_default_location
  before insert on appointments
  for each row execute function sehat_default_appointment_location();

-- ── Capacity, and one doctor in one place at a time ───────────────────────

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

  -- A doctor cannot be in two buildings in the same window. This holds whether
  -- or not hours are published, because it is a fact about people rather than a
  -- configuration choice.
  select count(*) into v_clash
    from appointments
   where doctor_id = new.doctor_id
     and slot_datetime = new.slot_datetime
     and status <> 'cancelled'
     and id is distinct from new.id
     and location_id is distinct from new.location_id
     and location_id is not null and new.location_id is not null;

  if v_clash > 0 then
    raise exception 'This doctor is already booked at another location for %', new.slot_datetime
      using errcode = 'check_violation';
  end if;

  -- Capacity comes from the published window covering this time. If the clinic
  -- has not published hours, there is no number to enforce and the booking goes
  -- through — refusing here would mean an unconfigured clinic takes no bookings
  -- at all, which is worse than an over-full hour.
  select a.slot_capacity into v_capacity
    from doctor_availability a
   where a.doctor_id = new.doctor_id
     and a.is_active
     and (a.location_id is null or a.location_id = new.location_id)
     and a.day_of_week = extract(dow from new.slot_datetime at time zone 'Asia/Kolkata')
     and (new.slot_datetime at time zone 'Asia/Kolkata')::time >= a.start_time
     and (new.slot_datetime at time zone 'Asia/Kolkata')::time <  a.end_time
   order by a.location_id nulls last
   limit 1;

  if v_capacity is null then return new; end if;

  select count(*) into v_taken
    from appointments
   where doctor_id = new.doctor_id
     and slot_datetime = new.slot_datetime
     and status <> 'cancelled'
     and id is distinct from new.id;

  if v_taken >= v_capacity then
    raise exception 'That % window is full (% of % booked). Please choose another time.',
      to_char(new.slot_datetime at time zone 'Asia/Kolkata', 'HH12:MI AM'), v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function sehat_check_appointment_capacity is
  'Replaces idx_no_double_booking. Enforces per-window capacity where hours are '
  'published, and always enforces that a doctor is in one place at a time. '
  'Silent when a clinic has published no hours — never blocks a booking for '
  'want of configuration.';

drop trigger if exists appointments_check_capacity on appointments;
create trigger appointments_check_capacity
  before insert or update of slot_datetime, status, location_id, doctor_id on appointments
  for each row execute function sehat_check_appointment_capacity();

-- ── What the bot and the dashboard need to offer a window ──────────────────

create or replace function sehat_open_windows(p_doctor_id uuid, p_date date)
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
  with windows as (
    select
      a.location_id,
      p.name    as location_name,
      p.address as location_address,
      a.slot_capacity,
      generate_series(
        (p_date + a.start_time) at time zone 'Asia/Kolkata',
        (p_date + a.end_time)   at time zone 'Asia/Kolkata'
          - make_interval(mins => a.slot_duration_minutes),
        make_interval(mins => a.slot_duration_minutes)
      ) as window_start,
      a.slot_duration_minutes
    from doctor_availability a
    left join practice_locations p on p.id = a.location_id
    where a.doctor_id = p_doctor_id
      and a.is_active
      and a.day_of_week = extract(dow from p_date)
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
     where ap.doctor_id = p_doctor_id
       and ap.slot_datetime = w.window_start
       and ap.status <> 'cancelled'
  ) b on true
  order by w.window_start;
$$;

comment on function sehat_open_windows is
  'Bookable windows for one doctor on one date, with seats left. SECURITY '
  'DEFINER so the bot and the public booking page can see availability without '
  'being able to read the appointments behind it.';

grant execute on function sehat_open_windows(uuid, date) to anon, authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table practice_locations enable row level security;

-- Patients need addresses of active listings — that is the point of publishing
-- a location at all.
drop policy if exists "read_active_locations" on practice_locations;
create policy "read_active_locations" on practice_locations
  for select using (
    is_active and exists (
      select 1 from doctors d where d.id = doctor_id and d.status = 'active'
    )
  );

-- A clinic manages its own, matching the existing doctors_update_own pattern.
drop policy if exists "clinic_manages_own_locations" on practice_locations;
create policy "clinic_manages_own_locations" on practice_locations
  for all using (
    doctor_id in (select id from doctors where email = auth.jwt() ->> 'email')
  ) with check (
    doctor_id in (select id from doctors where email = auth.jwt() ->> 'email')
  );

drop policy if exists "admins_manage_locations" on practice_locations;
create policy "admins_manage_locations" on practice_locations
  for all using (sehat_is_admin()) with check (sehat_is_admin());
