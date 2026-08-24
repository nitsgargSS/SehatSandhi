-- ============================================================================
-- Sehatsandhi — the token, and who is next
--
-- Run AFTER 0053. Safe to re-run.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
-- appointments models a booked slot: a patient who chose 4:15pm and turned up
-- for it. Most Indian OPD is not that. A patient arrives, is given a number,
-- and waits until it is called — the doctor sees people in the order they came,
-- not the order they booked, and most of them never booked at all.
--
-- Without this the records product can describe a visit after it happened while
-- the front desk still runs the actual day on a paper pad. The pad is the thing
-- the clinic touches every hour; the chart is the thing they touch once.
--
-- ── HOW IT RELATES TO AN APPOINTMENT ────────────────────────────────────────
-- A booking is a promise to come; a token is being here. They are not the same
-- row and one does not replace the other: a patient who booked through the bot
-- still takes a token when they walk in, and appointment_id links the two so
-- the clinic can see who honoured their slot. A token with no appointment is
-- the ordinary walk-in case, which is why appointment_id is nullable and
-- nothing requires it.
--
-- ── WHAT IS DELIBERATELY NOT MODELLED ───────────────────────────────────────
-- No display-board hardware, no SMS-when-you-are-near, no multi-counter
-- routing. Those need a clinic actually running on this first. What is here is
-- the smallest thing that replaces the pad: issue a number, see the line, call
-- the next person, and know who is still waiting.
-- ============================================================================


-- ============================================================================
-- 1. The queue
-- ============================================================================

create table if not exists opd_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- Nullable: some clinics run one line for the whole practice, others a line
  -- per doctor. Both are real, so the column allows both rather than forcing a
  -- clinic to invent a doctor for its single queue.
  practitioner_id uuid references practitioners(id) on delete set null,

  -- The queue a token belongs to is (business, practitioner, date). Stored
  -- rather than derived from arrived_at, because a clinic that runs past
  -- midnight is still working the same day's list.
  queue_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  token_number integer not null,

  patient_member_id uuid not null references patient_members(id) on delete cascade,
  -- Set when the patient had booked. Null is the ordinary walk-in.
  appointment_id uuid references appointments(id) on delete set null,
  -- Set once the consultation is recorded, so a token leads to its chart.
  visit_id uuid references patient_visits(id) on delete set null,

  status text not null default 'waiting'
    check (status in ('waiting','called','in_consultation','completed','skipped','left')),

  -- Emergencies and the very elderly are taken out of turn everywhere in India.
  -- Modelled honestly rather than pretending the line is strictly first-come:
  -- a higher number is seen sooner, and the reason is recorded so nobody has to
  -- guess why token 40 went before token 12.
  priority integer not null default 0,
  priority_reason text,

  reason text,                             -- what they have come for
  arrived_at timestamptz not null default now(),
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,

  created_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint opd_queue_priority_reason check (priority = 0 or coalesce(btrim(priority_reason), '') <> '')
);

-- A queue's numbers are unique within it, and a queue is a day.
create unique index if not exists opd_queue_token_unique
  on opd_queue (business_id, coalesce(practitioner_id, '00000000-0000-0000-0000-000000000000'::uuid), queue_date, token_number);

-- One live token per person per queue per day. Issuing a second while the first
-- is still waiting is a front-desk slip, not a second visit.
create unique index if not exists opd_queue_one_live_per_patient
  on opd_queue (business_id, coalesce(practitioner_id, '00000000-0000-0000-0000-000000000000'::uuid), queue_date, patient_member_id)
  where status in ('waiting', 'called', 'in_consultation');

create index if not exists opd_queue_board_idx
  on opd_queue (business_id, queue_date, status);

comment on table opd_queue is
  'One row per token. A booking is a promise to come and lives in appointments; '
  'this is being here. A patient who booked still takes a token, and '
  'appointment_id links the two.';
comment on column opd_queue.priority is
  'Higher is seen sooner. Emergencies and the very elderly are taken out of '
  'turn everywhere, so the model says so rather than pretending the line is '
  'strictly first-come — and priority_reason is required whenever it is used, '
  'so the board can always explain itself.';

drop trigger if exists opd_queue_touch on opd_queue;
create trigger opd_queue_touch before update on opd_queue
  for each row execute function sehat_touch_updated_at();


-- ============================================================================
-- 2. Issuing a token
--
-- An advisory lock rather than a counter table: the queue key is already
-- (business, practitioner, date) and a counter row per doctor per day would be
-- a table nobody ever reads. The lock is transaction-scoped, so two receptions
-- clicking at once serialise here and both get a number rather than one of them
-- getting a duplicate-key error.
-- ============================================================================

create or replace function sehat_issue_token(
  p_patient_member_id uuid,
  p_business_id uuid,
  p_practitioner_id uuid default null,
  p_reason text default null,
  p_appointment_id uuid default null,
  p_priority integer default 0,
  p_priority_reason text default null,
  p_created_by uuid default null
) returns opd_queue
language plpgsql security definer set search_path = public as $$
declare
  v_date date := (now() at time zone 'Asia/Kolkata')::date;
  v_key  uuid := coalesce(p_practitioner_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_next integer;
  v_row  opd_queue;
begin
  if not sehat_caller_owns_business(p_business_id) then
    raise exception 'not your business';
  end if;
  if p_priority <> 0 and coalesce(btrim(p_priority_reason), '') = '' then
    raise exception 'a token taken out of turn needs a reason';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || v_key::text || v_date::text, 0));

  select coalesce(max(token_number), 0) + 1 into v_next
    from opd_queue
   where business_id = p_business_id
     and coalesce(practitioner_id, '00000000-0000-0000-0000-000000000000'::uuid) = v_key
     and queue_date = v_date;

  insert into opd_queue (
    business_id, practitioner_id, queue_date, token_number, patient_member_id,
    appointment_id, reason, priority, priority_reason, created_by
  ) values (
    p_business_id, p_practitioner_id, v_date, v_next, p_patient_member_id,
    p_appointment_id, p_reason, p_priority, nullif(btrim(coalesce(p_priority_reason, '')), ''), p_created_by
  ) returning * into v_row;

  -- Somebody in the queue is a patient of this clinic, however they got here.
  perform sehat_link_patient_to_business(
    p_patient_member_id, p_business_id,
    case when p_appointment_id is null then 'walk_in' else 'appointment' end,
    'OPD token ' || v_next);

  return v_row;
exception
  when unique_violation then
    raise exception 'that patient already has a live token in this queue today';
end $$;

comment on function sehat_issue_token is
  'Next number in this doctor''s line today. Serialised by an advisory lock so '
  'two receptions issuing at once get two numbers rather than one collision.';


-- ============================================================================
-- 3. Calling the next person
--
-- Order is priority first, then the order they arrived. Not token number:
-- a token issued out of turn should be seen out of turn, and arrival time is
-- the honest tiebreak when two people were given numbers seconds apart.
-- ============================================================================

create or replace function sehat_call_next(
  p_business_id uuid, p_practitioner_id uuid default null
) returns opd_queue
language plpgsql security definer set search_path = public as $$
declare v_row opd_queue;
begin
  if not sehat_caller_owns_business(p_business_id) then
    raise exception 'not your business';
  end if;

  update opd_queue set status = 'called', called_at = now()
   where id = (
     select q.id from opd_queue q
      where q.business_id = p_business_id
        and q.queue_date = (now() at time zone 'Asia/Kolkata')::date
        and (p_practitioner_id is null or q.practitioner_id = p_practitioner_id)
        and q.status = 'waiting'
      order by q.priority desc, q.arrived_at
      limit 1
      -- Two doctors pressing Next at the same moment must not both get the same
      -- person. SKIP LOCKED hands the second one whoever is behind.
      for update skip locked
   )
  returning * into v_row;

  return v_row;   -- null when the line is empty
end $$;

create or replace function sehat_set_token_status(
  p_token_id uuid, p_status text, p_visit_id uuid default null
) returns opd_queue
language plpgsql security definer set search_path = public as $$
declare v_row opd_queue; v_biz uuid;
begin
  select business_id into v_biz from opd_queue where id = p_token_id;
  if not found then raise exception 'no such token'; end if;
  if not sehat_caller_owns_business(v_biz) then raise exception 'not your business'; end if;
  if p_status not in ('waiting','called','in_consultation','completed','skipped','left') then
    raise exception 'unknown status: %', p_status;
  end if;

  update opd_queue set
    status = p_status,
    visit_id = coalesce(p_visit_id, visit_id),
    started_at = case when p_status = 'in_consultation' then coalesce(started_at, now()) else started_at end,
    completed_at = case when p_status in ('completed','skipped','left') then coalesce(completed_at, now()) else completed_at end,
    -- Re-queuing someone who was skipped puts them back in line without a new
    -- number: they did not stop being here, they just missed the call.
    called_at = case when p_status = 'waiting' then null else called_at end
  where id = p_token_id
  returning * into v_row;

  return v_row;
end $$;

comment on function sehat_set_token_status is
  'Moves a token through the day. Sending one back to waiting clears called_at '
  'and keeps the number — somebody who missed their call has not stopped being '
  'here, and issuing them a fresh token would put them at the back.';


-- ============================================================================
-- 4. The board
--
-- What reception looks at all day. Position counts only the people actually
-- ahead of you, under the same ordering the caller uses, so the number on the
-- screen is the number of people you are waiting behind.
-- ============================================================================

create or replace view opd_board as
  with ranked as (
    select
      q.*,
      -- FILTER is only valid on an aggregate, and row_number() is a window
      -- function — `row_number() over (...) filter (...)` is a syntax error, not
      -- a subtly wrong answer. The waiting-only numbering has to come from the
      -- partition instead.
      --
      -- The boolean IS part of the partition on purpose. Without it row_number
      -- counts every row in arrival order, so the first person still waiting
      -- behind two finished consultations would be told they are third. With it
      -- the people waiting are numbered among themselves, and the CASE nulls it
      -- out for everyone else — a position is meaningless once you have been
      -- seen.
      case when q.status = 'waiting' then
        row_number() over (
          partition by q.business_id, q.practitioner_id, q.queue_date,
                       (q.status = 'waiting')
          order by q.priority desc, q.arrived_at
        )
      end as waiting_position
    from opd_queue q
    where q.queue_date = (now() at time zone 'Asia/Kolkata')::date
  ),
  -- Today's own pace, not a guessed constant: a clinic running 6-minute
  -- consultations should not be told 20. Falls back only when nobody has
  -- finished yet.
  pace as (
    select business_id, practitioner_id,
           avg(extract(epoch from completed_at - started_at) / 60.0) as avg_minutes
      from opd_queue
     where queue_date = (now() at time zone 'Asia/Kolkata')::date
       and status = 'completed' and started_at is not null and completed_at is not null
     group by business_id, practitioner_id
  )
  select
    r.id, r.business_id, r.practitioner_id, r.queue_date, r.token_number,
    r.patient_member_id, r.appointment_id, r.visit_id,
    r.status, r.priority, r.priority_reason, r.reason,
    r.arrived_at, r.called_at, r.started_at, r.completed_at,
    m.full_name as patient_name, m.age_years, m.gender,
    pt.phone as patient_phone,
    p.full_name as practitioner_name,
    bp.mrn,
    r.waiting_position,
    round(coalesce(pace.avg_minutes, 12)::numeric, 0) as avg_consult_minutes,
    case when r.status = 'waiting'
         then round((r.waiting_position - 1) * coalesce(pace.avg_minutes, 12)::numeric, 0)
    end as approx_wait_minutes,
    (r.appointment_id is not null) as had_appointment
  from ranked r
  join patient_members m on m.id = r.patient_member_id
  join patients pt on pt.id = m.patient_id
  left join practitioners p on p.id = r.practitioner_id
  left join business_patients bp
    on bp.patient_member_id = r.patient_member_id and bp.business_id = r.business_id
  left join pace on pace.business_id = r.business_id
                and pace.practitioner_id is not distinct from r.practitioner_id
 where r.business_id in (select sehat_caller_business_ids());

comment on view opd_board is
  'Today''s line for every doctor in the clinic, with position and an estimated '
  'wait from the pace this clinic is actually running today. Ordered the way '
  'sehat_call_next orders, so the board and the caller never disagree.';


-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table opd_queue enable row level security;

drop policy if exists "clinic_reads_queue" on opd_queue;
create policy "clinic_reads_queue" on opd_queue
  for select using (sehat_caller_owns_business(business_id));

drop policy if exists "clinic_writes_queue" on opd_queue;
create policy "clinic_writes_queue" on opd_queue
  for insert with check (sehat_caller_owns_business(business_id));

drop policy if exists "clinic_updates_queue" on opd_queue;
create policy "clinic_updates_queue" on opd_queue
  for update using (sehat_caller_owns_business(business_id))
  with check (sehat_caller_owns_business(business_id));

-- No delete: a token that was issued was issued. Somebody who left is 'left',
-- which is a fact worth keeping — it is how a clinic finds out its waits are
-- too long.

grant select on opd_board to authenticated;
grant execute on function sehat_issue_token(uuid, uuid, uuid, text, uuid, integer, text, uuid) to authenticated;
grant execute on function sehat_call_next(uuid, uuid) to authenticated;
grant execute on function sehat_set_token_status(uuid, text, uuid) to authenticated;

revoke all on function sehat_issue_token(uuid, uuid, uuid, text, uuid, integer, text, uuid) from anon;
revoke all on function sehat_call_next(uuid, uuid) from anon;
revoke all on function sehat_set_token_status(uuid, text, uuid) from anon;
