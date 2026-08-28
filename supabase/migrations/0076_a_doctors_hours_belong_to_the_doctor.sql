-- ============================================================================
-- Sehatsandhi — a doctor's hours are the doctor's, and they do not overlap
--
-- Run AFTER 0075. Safe to re-run.
--
-- ── THE ASK ─────────────────────────────────────────────────────────────────
-- A practitioner works at more than one business. They set their hours PER
-- BUSINESS, and the appointment calendar follows: hours given to the clinic are
-- not offered by the hospital. 0072 stopped the double BOOKING; this is the
-- layer above it, where the double booking becomes impossible to arrive at
-- because the window was never on offer.
--
-- ── FIRST, THE FLOOR NOBODY HAD NOTICED WAS MISSING ─────────────────────────
-- `availability` carried exactly one policy:
--
--     public_read_availability  [SELECT]  using (true)
--
-- and RLS is on. No INSERT, no UPDATE, no DELETE policy for anybody. So every
-- save from the Schedule tab has been refused since RLS was enabled:
--
--     new row violates row-level security policy for table "availability"
--
-- Dashboard.tsx:602 does not read the error back — `await supabase.from(...)
-- .insert(...)` with nothing checking `error` — so the button sets "Saved ✓"
-- and the hours are not saved. The delete half is worse than an error: with no
-- DELETE policy RLS removes nothing and reports success, so the delete-then-
-- insert pattern silently does neither.
--
-- That is why both sandbox businesses had zero availability rows and why the
-- booking calendar had nothing to offer. The 0072 work had to publish hours by
-- hand inside a transaction to have any windows to test against. No clinic has
-- ever successfully set its opening hours through the product.
--
-- Nothing about per-clinic doctor hours can work until a clinic can save hours
-- at all, so the write policies come first.
--
-- ── THEN THE RULE ───────────────────────────────────────────────────────────
-- A row that names an affiliation (business_practitioner_id) is that doctor's
-- own commitment. Two such rows for one practitioner may not overlap when they
-- are at different places, and the second save is REFUSED rather than quietly
-- reconciled — a calendar you can trust is worth more than a save that always
-- succeeds.
--
-- The refusal does not name the other business. Telling one clinic that its
-- doctor is at a named competitor on Monday morning is not this system's to
-- disclose; the time is enough to resolve it, and the doctor knows the rest.
-- 0072's booking-time message named the clinic, and is changed below to match.
--
-- HOUSE hours are deliberately not part of the rule. A row with no affiliation
-- is the business's own opening hours, applying to whoever is on that day.
-- Refusing a doctor's hours because another business happens to be open then
-- would make it impossible to work anywhere a competitor is open — so the
-- overlap with house hours is handled where it belongs, by not OFFERING those
-- windows, in sehat_open_windows below.
-- ============================================================================


-- ── 1. A clinic can write its own hours ─────────────────────────────────────
--
-- Who may: an owner or manager sets the business's hours, house or any doctor's.
-- A doctor may set their own, at a business they are affiliated to, and no
-- other doctor's. Reception and nursing staff may not — hours are a commercial
-- and contractual matter rather than a clinical one.
--
-- "Their own" is matched on practitioners.auth_uid = auth.uid(), and NOT with
-- sehat_caller_practitioner_ids(), which the first draft of this used. That
-- helper reads like "the practitioners the caller IS" and means "the
-- practitioners the caller can SEE": its second branch returns everyone
-- attached to any business the caller may act on. Written against it, this
-- policy let a nurse set a consultant's hours — caught by the role test, which
-- is the only reason it is not in the file.
--
-- The SELECT policy stays `using (true)`: opening hours are public, the booking
-- page needs them before anyone logs in, and they disclose nothing personal.

create or replace function sehat_caller_may_set_hours(
  p_business uuid,
  p_affiliation uuid
) returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sehat_caller_role(p_business) in ('owner', 'manager'), false)
      or (p_affiliation is not null and exists (
            select 1
              from business_practitioners bp
              join practitioners p on p.id = bp.practitioner_id
             where bp.id = p_affiliation
               and bp.business_id = p_business
               and p.auth_uid is not null
               and p.auth_uid = auth.uid()));
$$;

comment on function sehat_caller_may_set_hours is
  'Added in 0076. An owner or manager sets any hours for their business; a doctor '
  'sets their own and nobody else''s. Matches auth_uid directly rather than using '
  'sehat_caller_practitioner_ids(), which is a wider set than its name suggests.';

grant execute on function sehat_caller_may_set_hours(uuid, uuid) to authenticated, service_role;

drop policy if exists clinic_writes_availability  on availability;
drop policy if exists clinic_updates_availability on availability;
drop policy if exists clinic_deletes_availability on availability;

create policy clinic_writes_availability on availability
  for insert with check (sehat_caller_may_set_hours(business_id, business_practitioner_id));

create policy clinic_updates_availability on availability
  for update using      (sehat_caller_may_set_hours(business_id, business_practitioner_id))
          with check    (sehat_caller_may_set_hours(business_id, business_practitioner_id));

create policy clinic_deletes_availability on availability
  for delete using      (sehat_caller_may_set_hours(business_id, business_practitioner_id));

comment on policy clinic_writes_availability on availability is
  'Added in 0076. availability had a SELECT policy and nothing else, so every '
  'save from the Schedule tab had been refused since RLS was enabled — silently, '
  'because the caller never read the error.';


-- ── 2. One doctor, one place, one hour ──────────────────────────────────────
--
-- SECURITY DEFINER for the reason 0072 documents at length: a trigger body gets
-- the table's RLS applied to it, and the rows this needs to see belong to a
-- business the caller does not own. availability happens to be world-readable
-- today, so this would work either way — but relying on that would mean the
-- guard silently stops working the day somebody scopes the SELECT policy, which
-- is exactly how the booking guard died for two years.

create or replace function sehat_check_availability_clash()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_practitioner uuid;
  v_name         text;
  v_day          text;
  v_from         time;
  v_to           time;
begin
  -- House hours belong to the business, not to a person, and cannot clash.
  if new.business_practitioner_id is null or not new.is_active then
    return new;
  end if;

  select bp.practitioner_id, p.full_name
    into v_practitioner, v_name
    from business_practitioners bp
    join practitioners p on p.id = bp.practitioner_id
   where bp.id = new.business_practitioner_id;

  if v_practitioner is null then return new; end if;

  select oa.start_time, oa.end_time
    into v_from, v_to
    from availability oa
    join business_practitioners obp on obp.id = oa.business_practitioner_id
   where obp.practitioner_id = v_practitioner
     and oa.is_active
     and oa.id is distinct from new.id
     and oa.day_of_week = new.day_of_week
     -- Another PLACE, which is (business, location) — the same pair 0072
     -- settled on. Two windows at one location are the business's own overlap
     -- to sort out, not a person being in two buildings.
     and (oa.business_id is distinct from new.business_id
          or oa.location_id is distinct from new.location_id)
     -- Half-open, so 10:00-13:00 and 13:00-16:00 are neighbours, not a clash.
     and oa.start_time < new.end_time
     and new.start_time < oa.end_time
   order by oa.start_time
   limit 1;

  if found then
    raise exception '% is already scheduled % %-% at another location. Choose a different window.',
      coalesce(v_name, 'This doctor'),
      to_char(date '2024-01-07' + new.day_of_week, 'FMDay'),
      to_char(v_from, 'HH12:MI AM'), to_char(v_to, 'HH12:MI AM')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function sehat_check_availability_clash is
  'Added in 0076. A practitioner cannot publish overlapping hours at two places. '
  'Deliberately says "another location" rather than naming the business.';

drop trigger if exists availability_check_clash on availability;
create trigger availability_check_clash
  before insert or update of day_of_week, start_time, end_time, is_active,
                             business_id, location_id, business_practitioner_id
  on availability
  for each row execute function sehat_check_availability_clash();


-- ── 3. The booking-time message stops naming the clinic ─────────────────────
--
-- Everything else about this function is 0072's and unchanged; only the text of
-- the exception differs. The time is what a receptionist needs to resolve it.

create or replace function sehat_check_appointment_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_capacity   integer;
  v_taken      integer;
  v_new_end    timestamptz;
  v_clash_when timestamptz;
begin
  if new.status = 'cancelled' then return new; end if;

  if new.practitioner_id is not null then
    v_new_end := sehat_slot_end(new.business_id, new.practitioner_id, new.slot_datetime);

    select ap.slot_datetime into v_clash_when
      from appointments ap
     where ap.practitioner_id = new.practitioner_id
       and ap.status <> 'cancelled'
       and ap.id is distinct from new.id
       and (ap.business_id is distinct from new.business_id
            or ap.location_id is distinct from new.location_id)
       and ap.slot_datetime >= new.slot_datetime - interval '12 hours'
       and ap.slot_datetime <  v_new_end
       and tstzrange(ap.slot_datetime,
                     sehat_slot_end(ap.business_id, ap.practitioner_id, ap.slot_datetime),
                     '[)')
           && tstzrange(new.slot_datetime, v_new_end, '[)')
     order by ap.slot_datetime
     limit 1;

    if found then
      raise exception 'This doctor is already booked at another location for %',
        to_char(v_clash_when at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM')
        using errcode = 'check_violation';
    end if;
  end if;

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
  'Fixed in 0072 — it was SECURITY INVOKER, compared slots for equality, and ran '
  'before the trigger that fills location_id. 0076 stopped its message naming the '
  'other business.';


-- ── 4. The calendar follows the hours ───────────────────────────────────────
--
-- blocked_elsewhere now answers a wider question: is this practitioner spoken
-- for in this window, anywhere else? Two ways they can be, and both matter.
--
--   An appointment elsewhere that overlaps. 0072's rule, unchanged.
--
--   PUBLISHED HOURS elsewhere that overlap. This is the new half and the one
--   the rule in section 2 cannot cover on its own: a doctor with their own
--   hours at the clinic but no rows at the hospital inherits the HOSPITAL'S
--   HOUSE hours there, and those can overlap freely — nothing refused them,
--   because house hours are not a person's commitment. So they are not offered
--   instead. The clinic's Monday morning stops appearing on the hospital's
--   calendar for that doctor, which is the whole ask.
--
-- Both are "another place", meaning a different (business, location).

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
  cross join lateral (
    select p_practitioner_id is not null and (
      -- booked elsewhere
      exists (
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
      )
      -- or expected elsewhere: their own published hours at another place
      or exists (
        select 1
          from availability oa
          join business_practitioners obp on obp.id = oa.business_practitioner_id
         where obp.practitioner_id = p_practitioner_id
           and oa.is_active
           and oa.day_of_week = extract(dow from p_date)::integer
           and (oa.business_id is distinct from p_business_id
                or oa.location_id is distinct from w.location_id)
           and tstzrange((p_date + oa.start_time) at time zone 'Asia/Kolkata',
                         (p_date + oa.end_time)   at time zone 'Asia/Kolkata', '[)')
               && tstzrange(w.window_start,
                            w.window_start + make_interval(mins => w.slot_duration_minutes),
                            '[)')
      )
    ) as clash
  ) e
  order by w.window_start;
$$;

comment on function sehat_open_windows is
  'Fixed in 0072 to withdraw windows the doctor is booked for elsewhere. 0076 '
  'widened blocked_elsewhere to their published hours elsewhere too, which is '
  'what covers a doctor inheriting another business''s house hours.';

grant execute on function sehat_open_windows(uuid, date, uuid)
  to anon, authenticated, service_role;

-- The result shape did not change, but the grants and the function did.
notify pgrst, 'reload schema';


-- ============================================================================
-- NOT DONE HERE
--
--   Nothing migrates the existing house rows onto affiliations. There are none
--   to migrate — no clinic has ever saved any, for the reason in section 1 —
--   but a database that somehow has them keeps them, and they go on applying to
--   every doctor at that business, which is what a house row means.
--
--   A doctor still cannot see their own combined week across businesses. Each
--   Schedule tab shows one business. The data is there to build it from.
--
--   And a thing found on the way, left alone because it is a decision rather
--   than a repair: sehat_caller_practitioner_ids() has the same wider-than-it-
--   reads meaning inside practitioners_update_own —
--
--       for update using (id in (select sehat_caller_practitioner_ids()))
--
--   which means any staff member at a clinic — reception included — may UPDATE
--   any practitioner record at that clinic, including a consultant's council
--   registration number, the field the public "verified" claim rests on.
--   affiliations_manage_own and practitioner_daily_stats read the same helper.
--   Whether a manager should be able to edit a doctor's profile is a real
--   question; whether reception should edit a registration number is probably
--   not. Worth its own migration and its own test.
-- ============================================================================
