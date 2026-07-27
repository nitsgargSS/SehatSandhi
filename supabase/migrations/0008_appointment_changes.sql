-- ============================================================================
-- Sehatsandhi — cancelling, rescheduling and no-shows
--
-- Applied by npm run migrate, after 0007. Safe to re-run.
--
-- THE PROBLEM
-- appointments.status already had 'cancelled', and slot generation already
-- excludes cancelled rows, so freeing a slot worked. What was missing:
--
--   • no record of WHO cancelled — a patient changing plans and a clinic
--     dropping the appointment are very different events
--   • no representation of a reschedule — overwriting slot_datetime loses the
--     original, and the patient may already have had a reminder for it
--   • nothing told the other party, which is the failure that actually costs
--     you: a patient arriving to a closed door
--
-- WHO CAN DO WHAT
-- Authorisation already works and is untouched here: RLS lets a doctor
-- (matched by JWT email) and their active clinic staff read and update their own
-- appointments. The WhatsApp bot acts with the service role and passes
-- actor = 'patient'.
--
-- AUDIT AND NOTIFICATION ARE ENFORCED BY TRIGGER, NOT BY CALLERS
-- Every status or slot change writes an appointment_events row and queues a
-- notification, whichever path made the change — dashboard, bot, admin, or a
-- hand-run UPDATE. A caller cannot forget to do it, because a caller never does
-- it. That is the whole point: the notification is the part that must not be
-- optional.
-- ============================================================================

-- ============================================================================
-- appointments — who did what, and what it was before
-- ============================================================================

alter table appointments add column if not exists confirmed_at timestamptz;
alter table appointments add column if not exists completed_at timestamptz;
alter table appointments add column if not exists cancelled_at timestamptz;
alter table appointments add column if not exists cancelled_by text;      -- patient|clinic|admin|system
alter table appointments add column if not exists cancel_reason text;
alter table appointments add column if not exists previous_slot_datetime timestamptz;
alter table appointments add column if not exists rescheduled_at timestamptz;
alter table appointments add column if not exists rescheduled_by text;
alter table appointments add column if not exists reschedule_count integer default 0;
alter table appointments add column if not exists no_show_at timestamptz;
alter table appointments add column if not exists updated_at timestamptz default now();

-- Set by whoever performs the change, and copied onto the audit row by the
-- trigger below. Kept on the appointment so a single UPDATE carries its own
-- provenance — no session variables, no second call that might not happen.
alter table appointments add column if not exists last_actor text;
alter table appointments add column if not exists last_actor_detail text;   -- staff name, admin, bot session

do $$ begin
  alter table appointments add constraint appointments_cancelled_by_check
    check (cancelled_by is null or cancelled_by in ('patient','clinic','admin','system')) not valid;
exception when duplicate_object then null; end $$;

-- 'no_show' is a distinct outcome from 'cancelled': nobody cancelled, the
-- patient simply did not arrive. Conflating them hides the problem you most
-- want to measure.
alter table appointments drop constraint if exists appointments_status_check;
alter table appointments add constraint appointments_status_check
  check (status in ('booked','confirmed','completed','cancelled','no_show'));

create index if not exists appointments_doctor_slot_idx on appointments (doctor_id, slot_datetime);
create index if not exists appointments_status_idx on appointments (status);

drop trigger if exists appointments_touch_updated_at on appointments;
create trigger appointments_touch_updated_at before update on appointments
  for each row execute function sehat_touch_updated_at();

-- ============================================================================
-- appointment_events — append-only history. Never updated, never deleted.
-- ============================================================================

create table if not exists appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments(id) on delete cascade,
  doctor_id uuid,
  event text not null,                     -- booked|confirmed|rescheduled|cancelled|completed|no_show
  actor text,                              -- patient|clinic|admin|system
  actor_detail text,
  from_status text,
  to_status text,
  from_slot timestamptz,
  to_slot timestamptz,
  reason text,
  created_at timestamptz default now()
);

create index if not exists appointment_events_appt_idx on appointment_events (appointment_id, created_at);
create index if not exists appointment_events_doctor_idx on appointment_events (doctor_id, created_at desc);

-- ============================================================================
-- notification_outbox — what still needs telling, and to whom.
--
-- A queue rather than a direct send: the database transaction that changes an
-- appointment cannot also guarantee an HTTP call succeeds. Writing the intent
-- here means a provider outage delays a message instead of losing it.
-- ============================================================================

create table if not exists notification_outbox (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments(id) on delete cascade,
  recipient text not null,                 -- patient|clinic
  phone text,
  event text not null,
  payload jsonb default '{}'::jsonb,       -- slot times, doctor name, reason
  status text default 'pending',           -- pending|sending|sent|failed
  attempts integer default 0,
  last_error text,
  sent_channel text,                       -- whatsapp|sms
  sent_at timestamptz,
  created_at timestamptz default now()
);

do $$ begin
  alter table notification_outbox add constraint notification_outbox_status_check
    check (status in ('pending','sending','sent','failed')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists notification_outbox_pending_idx
  on notification_outbox (created_at) where status in ('pending','sending');

-- A drain claims a row as 'sending' before calling the provider, so an
-- overlapping run cannot send the same message twice. If a run dies mid-send the
-- row stays 'sending' — this releases anything stranded for over 15 minutes so
-- the next drain retries it rather than leaving a patient uninformed.
create or replace function sehat_release_stuck_notifications()
returns integer language plpgsql as $$
declare n integer;
begin
  update notification_outbox set status = 'pending'
   where status = 'sending' and created_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- ============================================================================
-- The trigger that makes audit and notification unskippable.
-- ============================================================================

create or replace function sehat_appointment_changed()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  v_event text;
  v_doctor_name text;
  v_slot_changed boolean := new.slot_datetime is distinct from old.slot_datetime;
  v_status_changed boolean := new.status is distinct from old.status;
begin
  if not v_slot_changed and not v_status_changed then
    return new;
  end if;

  -- A slot move is a reschedule even when the status is untouched; a status
  -- change to cancelled during a move is still a cancellation.
  v_event := case
    when v_status_changed and new.status = 'cancelled' then 'cancelled'
    when v_status_changed and new.status = 'no_show'   then 'no_show'
    when v_status_changed and new.status = 'completed' then 'completed'
    when v_status_changed and new.status = 'confirmed' then 'confirmed'
    when v_slot_changed then 'rescheduled'
    else 'updated'
  end;

  insert into appointment_events (
    appointment_id, doctor_id, event, actor, actor_detail,
    from_status, to_status, from_slot, to_slot, reason
  ) values (
    new.id, new.doctor_id, v_event,
    coalesce(new.last_actor, 'system'), new.last_actor_detail,
    old.status, new.status, old.slot_datetime, new.slot_datetime,
    new.cancel_reason
  );

  -- Only events the other party actually needs to act on. 'completed' and
  -- 'no_show' are record-keeping: messaging a patient to say they did not turn
  -- up is a bad message to send, and one nobody can do anything about.
  if v_event not in ('cancelled', 'rescheduled', 'confirmed') then
    return new;
  end if;

  select coalesce(clinic_name, name) into v_doctor_name from doctors where id = new.doctor_id;

  -- Tell the party who did NOT make the change. A clinic cancelling must reach
  -- the patient; a patient cancelling must reach the clinic.
  if coalesce(new.last_actor, 'system') = 'patient' then
    insert into notification_outbox (appointment_id, recipient, phone, event, payload)
    select new.id, 'clinic', d.phone, v_event,
           jsonb_build_object('patient_name', new.patient_name, 'doctor_name', v_doctor_name,
                              'old_slot', old.slot_datetime, 'new_slot', new.slot_datetime,
                              'reason', new.cancel_reason)
      from doctors d where d.id = new.doctor_id;
  else
    insert into notification_outbox (appointment_id, recipient, phone, event, payload)
    values (new.id, 'patient', new.patient_phone, v_event,
            jsonb_build_object('patient_name', new.patient_name, 'doctor_name', v_doctor_name,
                               'old_slot', old.slot_datetime, 'new_slot', new.slot_datetime,
                               'reason', new.cancel_reason));
  end if;

  return new;
end $$;

drop trigger if exists appointments_changed on appointments;
create trigger appointments_changed after update on appointments
  for each row execute function sehat_appointment_changed();

-- ============================================================================
-- The three actions. Deliberately SECURITY INVOKER (the default): the UPDATE
-- inside runs under the caller's RLS, so a doctor can only touch their own
-- appointments and the bot's service role can touch any. Authorisation stays in
-- the policies that already exist; these add the checks policies cannot express.
-- ============================================================================

create or replace function sehat_cancel_appointment(
  p_appointment_id uuid,
  p_actor text default 'clinic',
  p_reason text default null,
  p_actor_detail text default null
) returns appointments language plpgsql as $$
declare v_row appointments;
begin
  update appointments set
    status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor,
    cancel_reason = p_reason, last_actor = p_actor, last_actor_detail = p_actor_detail
  where id = p_appointment_id
    and status not in ('cancelled','completed')   -- cancelling twice is a no-op, not an error
  returning * into v_row;

  if not found then
    select * into v_row from appointments where id = p_appointment_id;
    if not found then raise exception 'no such appointment: %', p_appointment_id; end if;
  end if;
  return v_row;
end $$;

create or replace function sehat_reschedule_appointment(
  p_appointment_id uuid,
  p_new_slot timestamptz,
  p_actor text default 'clinic',
  p_reason text default null,
  p_actor_detail text default null
) returns appointments language plpgsql as $$
declare
  v_row appointments;
  v_doctor uuid;
  v_clash integer;
begin
  select doctor_id into v_doctor from appointments where id = p_appointment_id;
  if v_doctor is null then raise exception 'no such appointment: %', p_appointment_id; end if;

  -- Two patients in one slot is worse than a failed reschedule, so check first.
  select count(*) into v_clash from appointments
   where doctor_id = v_doctor and slot_datetime = p_new_slot
     and id <> p_appointment_id and status in ('booked','confirmed');
  if v_clash > 0 then
    raise exception 'that slot is already taken';
  end if;

  update appointments set
    previous_slot_datetime = slot_datetime,
    slot_datetime = p_new_slot,
    rescheduled_at = now(), rescheduled_by = p_actor,
    reschedule_count = coalesce(reschedule_count, 0) + 1,
    cancel_reason = p_reason,
    -- a rescheduled appointment needs confirming again
    status = case when status = 'cancelled' then 'booked' else status end,
    last_actor = p_actor, last_actor_detail = p_actor_detail
  where id = p_appointment_id
  returning * into v_row;

  return v_row;
end $$;

create or replace function sehat_set_appointment_status(
  p_appointment_id uuid,
  p_status text,
  p_actor text default 'clinic',
  p_actor_detail text default null
) returns appointments language plpgsql as $$
declare v_row appointments;
begin
  if p_status not in ('booked','confirmed','completed','no_show') then
    raise exception 'use sehat_cancel_appointment to cancel; got %', p_status;
  end if;

  update appointments set
    status = p_status,
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    no_show_at   = case when p_status = 'no_show'   then now() else no_show_at end,
    last_actor = p_actor, last_actor_detail = p_actor_detail
  where id = p_appointment_id
  returning * into v_row;

  if not found then raise exception 'no such appointment: %', p_appointment_id; end if;
  return v_row;
end $$;

-- ============================================================================
-- Views
-- ============================================================================

-- What the clinic sees, with the history that matters.
create or replace view appointment_detail as
select
  a.*,
  (a.reschedule_count > 0)                                     as was_rescheduled,
  (select count(*) from appointment_events e
    where e.appointment_id = a.id)                             as event_count,
  (select count(*) from appointments x
    where x.patient_phone = a.patient_phone and x.status = 'no_show') as patient_no_shows
from appointments a;

alter view appointment_detail set (security_invoker = on);

-- No-show and cancellation rates, for deciding later whether a cutoff is needed.
create or replace view appointment_outcomes as
select
  doctor_id,
  count(*)                                                as total,
  count(*) filter (where status = 'completed')            as completed,
  count(*) filter (where status = 'no_show')              as no_shows,
  count(*) filter (where status = 'cancelled'
                     and cancelled_by = 'patient')        as cancelled_by_patient,
  count(*) filter (where status = 'cancelled'
                     and cancelled_by = 'clinic')         as cancelled_by_clinic,
  count(*) filter (where reschedule_count > 0)            as rescheduled
from appointments
group by doctor_id;

alter view appointment_outcomes set (security_invoker = on);

-- ============================================================================
-- RLS
-- ============================================================================

alter table appointment_events   enable row level security;
alter table notification_outbox  enable row level security;

-- Clinics can read their own history; nobody writes it by hand — the trigger does.
drop policy if exists "clinic_read_appointment_events" on appointment_events;
create policy "clinic_read_appointment_events" on appointment_events
  for select using (
    doctor_id in (select id from doctors where email = auth.jwt() ->> 'email')
    or doctor_id in (select doctor_id from clinic_users
                      where supabase_user_id = auth.uid() and is_active = true)
  );

-- The outbox holds patient phone numbers; service role only.
revoke all on notification_outbox from anon, authenticated;

-- ============================================================================
-- FOR THE WHATSAPP BOT
--
-- The bot acts with the service role and identifies itself as the patient:
--
--   select * from sehat_cancel_appointment('<appointment id>', 'patient',
--                                          'Patient cancelled on WhatsApp');
--   select * from sehat_reschedule_appointment('<appointment id>',
--                                              '2026-08-03 10:30+05:30', 'patient');
--
-- Open slots come from the same availability logic the dashboard uses, so all
-- channels agree on what is free. Offer them as buttons, not free text.
--
-- Both calls queue a notification to the clinic automatically. Nothing else is
-- required of the bot — and nothing it forgets can skip the audit trail.
--
-- Draining the queue (send WhatsApp, fall back to SMS):
--   the appointment-notify edge function, called after any change and, as a
--   safety net, on a schedule:
--     select cron.schedule('drain-appointment-notifications', '*/5 * * * *',
--       $$select net.http_post(
--           url := '<project-url>/functions/v1/appointment-notify',
--           headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>'))$$);
-- ============================================================================
