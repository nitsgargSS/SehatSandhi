-- ============================================================================
-- 0289 — A planned surgery, and the WhatsApp messages before and after it
-- ============================================================================
-- Decided 29 Oct 2026 — phase 2 of "the full hospital flow" (plan doc).
-- Surgery is suggested; the hospital sets a date; from then on the patient
-- hears from the hospital by themselves: what to do before (tests, fasting,
-- what to bring) and what to do after (diet, wound care, warning signs).
--
--   surgery_message_plans / _steps   the hospital's own message plans: each
--        step is a day before or after the surgery, a time (8 am to 9 pm),
--        and the words. A starter plan is made the first time a hospital
--        looks; it changes it, or makes one per kind of operation.
--   planned_surgeries   procedure, date and time, OT, surgeon, admission —
--        planned, then done (linked to the OT register's record, 0162) or
--        cancelled.
--   surgery_messages    one row per message for one patient, made from the
--        plan when the surgery is planned. Each can be changed or skipped for
--        this patient, and more added. Moving the date moves every message
--        still to go; cancelling the surgery cancels them; recording the
--        operation on another day moves the after-care ones to that day.
--
-- Sent like WhatsApp Pro's other automatic messages (0262): an app
-- notification for a patient with the app, otherwise WhatsApp through
-- wa-auto-send, from the clinic's own number when it has one. Two Utility
-- templates carry the hospital's words — surgery_reminder (before) and
-- surgery_aftercare (after). Not to a patient who said STOP; nothing past
-- the time it was due by more than a day.
-- ============================================================================

-- ── The hospital's message plans ────────────────────────────────────────────
create table if not exists surgery_message_plans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists surgery_message_plans_name on surgery_message_plans (business_id, lower(btrim(name)));
create unique index if not exists surgery_message_plans_one_default on surgery_message_plans (business_id) where is_default;

create table if not exists surgery_message_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references surgery_message_plans(id) on delete cascade,
  -- Days from the surgery: -3 is three days before, 0 the day itself, 7 a week after.
  day_offset integer not null check (day_offset between -30 and 90),
  send_at time not null default '10:00' check (send_at between '08:00' and '20:59'),
  body text not null check (char_length(btrim(body)) between 10 and 600),
  sort_order integer not null default 0
);
create index if not exists surgery_message_steps_plan_idx on surgery_message_steps (plan_id, day_offset, send_at);

-- ── A planned surgery ───────────────────────────────────────────────────────
create table if not exists planned_surgeries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  admission_id uuid references admissions(id) on delete set null,
  procedure_name text not null check (char_length(btrim(procedure_name)) between 3 and 160),
  planned_on date not null,
  planned_time time,
  ot_type text not null default 'major' check (ot_type in ('major', 'minor')),
  surgeon_id uuid references practitioners(id) on delete set null,
  surgeon_name text,
  notes text,
  plan_id uuid references surgery_message_plans(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  surgery_id uuid references surgeries(id) on delete set null,
  cancelled_reason text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists planned_surgeries_business_idx on planned_surgeries (business_id, planned_on) where status = 'planned';
create index if not exists planned_surgeries_member_idx on planned_surgeries (patient_member_id, planned_on desc);

create table if not exists surgery_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  planned_id uuid not null references planned_surgeries(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  day_offset integer not null,
  body text not null check (char_length(btrim(body)) between 10 and 600),
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  channel text check (channel in ('whatsapp', 'push')),
  why text,
  wa_message_id text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists surgery_messages_due_idx on surgery_messages (due_at) where status in ('pending', 'sending');
create index if not exists surgery_messages_planned_idx on surgery_messages (planned_id, due_at);

-- Read: as the OT register (0162). Write: only through the functions below.
alter table surgery_message_plans enable row level security;
alter table surgery_message_steps enable row level security;
alter table planned_surgeries enable row level security;
alter table surgery_messages enable row level security;

drop policy if exists surgery_message_plans_read on surgery_message_plans;
create policy surgery_message_plans_read on surgery_message_plans for select to authenticated
  using (sehat_caller_owns_business(business_id) or sehat_is_admin());
drop policy if exists surgery_message_steps_read on surgery_message_steps;
create policy surgery_message_steps_read on surgery_message_steps for select to authenticated
  using (exists (select 1 from surgery_message_plans p where p.id = plan_id and (sehat_caller_owns_business(p.business_id) or sehat_is_admin())));
drop policy if exists planned_surgeries_read on planned_surgeries;
create policy planned_surgeries_read on planned_surgeries for select to authenticated using (
  sehat_is_admin() or sehat_caller_is_business(business_id)
  or (sehat_caller_is_clinical(business_id) and sehat_caller_sees_patient(business_id, patient_member_id)));
drop policy if exists surgery_messages_read on surgery_messages;
create policy surgery_messages_read on surgery_messages for select to authenticated using (
  sehat_is_admin() or sehat_caller_is_business(business_id)
  or (sehat_caller_is_clinical(business_id) and sehat_caller_sees_patient(business_id, patient_member_id)));

revoke all on surgery_message_plans, surgery_message_steps, planned_surgeries, surgery_messages from anon;
revoke insert, update, delete on surgery_message_plans, surgery_message_steps, planned_surgeries, surgery_messages from authenticated;
grant select on surgery_message_plans, surgery_message_steps, planned_surgeries, surgery_messages to authenticated;


-- ── Switched on with WhatsApp Pro, like the other automatic messages ───────
alter table wa_auto_settings add column if not exists surgery boolean not null default true;

create or replace function sehat_wa_auto_on(p_business uuid, p_kind text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_wa_accounts a where a.business_id = p_business and a.plan = 'pro')
     and sehat_wa_addon_blocker(p_business) is null
     and coalesce((select case p_kind when 'welcome' then s.welcome when 'visit_summary' then s.visit_summary
                                      when 'thank_you' then s.thank_you when 'follow_up' then s.follow_up
                                      when 'surgery' then s.surgery end
                     from wa_auto_settings s where s.business_id = p_business), true);
$$;
revoke all on function sehat_wa_auto_on(uuid, text) from public, anon, authenticated;

-- The owner switches surgery messages off (or on) for the whole hospital.
create or replace function sehat_wa_auto_surgery_set(p_business uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_role(p_business) = 'owner') then
    raise exception 'Only the owner can change automatic messages.' using errcode = '42501';
  end if;
  insert into wa_auto_settings (business_id, surgery, updated_at, updated_by) values (p_business, coalesce(p_on, true), now(), auth.uid())
  on conflict (business_id) do update set surgery = excluded.surgery, updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function sehat_wa_auto_surgery_set(uuid, boolean) from public, anon;
grant execute on function sehat_wa_auto_surgery_set(uuid, boolean) to authenticated;

-- What the screen shows: whether surgery messages will actually go out here.
create or replace function sehat_surgery_messages_on(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select sehat_caller_owns_business(p_business) and sehat_wa_auto_on(p_business, 'surgery');
$$;
revoke all on function sehat_surgery_messages_on(uuid) from public, anon;
grant execute on function sehat_surgery_messages_on(uuid) to authenticated;


-- ── Plans: list (with a starter plan), save, delete ─────────────────────────
create or replace function sehat_surgery_plan_editor(p_business uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or coalesce(sehat_caller_role(p_business) in ('owner', 'manager', 'doctor'), false)) then
    raise exception 'Only the owner, a manager or a doctor changes the message plans.' using errcode = '42501';
  end if;
end $$;
revoke all on function sehat_surgery_plan_editor(uuid) from public, anon, authenticated;

create or replace function sehat_surgery_plans(p_business uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_plan uuid;
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  -- The first look makes a starter plan for the hospital to change.
  if not exists (select 1 from surgery_message_plans where business_id = p_business) then
    insert into surgery_message_plans (business_id, name, is_default) values (p_business, 'Standard surgery', true)
    returning id into v_plan;
    insert into surgery_message_steps (plan_id, day_offset, send_at, body, sort_order) values
      (v_plan, -3, '10:00', 'Please complete the pre-surgery tests if you have not already, and keep all your reports and a list of the medicines you take ready to bring to the hospital.', 0),
      (v_plan, -1, '18:00', 'Do not eat or drink anything after 10 pm tonight unless your doctor told you otherwise. Take only the medicines your doctor asked you to. Bring your reports, an ID and one attendant.', 1),
      (v_plan, 1, '10:00', 'Take your medicines on time as prescribed. Keep the wound clean and dry, and eat light home-cooked food. Call the hospital at once if you have fever, bleeding, swelling or severe pain.', 2),
      (v_plan, 7, '10:00', 'Please come for your check-up as your doctor advised. Keep following the care instructions, avoid lifting heavy weights, and call the hospital if anything worries you.', 3);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'is_default', p.is_default,
             'steps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'day_offset', s.day_offset,
                                                 'send_at', to_char(s.send_at, 'HH24:MI'), 'body', s.body)
                                      order by s.day_offset, s.send_at, s.sort_order)
                                 from surgery_message_steps s where s.plan_id = p.id), '[]'::jsonb))
           order by p.is_default desc, p.name)
      from surgery_message_plans p where p.business_id = p_business), '[]'::jsonb);
end $$;
revoke all on function sehat_surgery_plans(uuid) from public, anon;
grant execute on function sehat_surgery_plans(uuid) to authenticated;

-- p_plan: { id?, name, is_default, steps: [{ day_offset, send_at 'HH:MM', body }] }
-- Changing a plan changes what future surgeries get; messages already made for
-- a planned surgery stay as they are.
create or replace function sehat_surgery_plan_save(p_business uuid, p_plan jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_plan->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_plan->>'name', ''));
  v_default boolean := coalesce((p_plan->>'is_default')::boolean, false);
  s jsonb;
  n integer := 0;
begin
  perform sehat_surgery_plan_editor(p_business);
  if char_length(v_name) < 2 then raise exception 'Give the plan a name, like "Cataract" or "Major surgery".' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_plan->'steps', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one message.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_plan->'steps') > 12 then raise exception 'At most 12 messages in a plan.' using errcode = '22023'; end if;

  if v_default then update surgery_message_plans set is_default = false where business_id = p_business and is_default and id is distinct from v_id; end if;
  if v_id is null then
    insert into surgery_message_plans (business_id, name, is_default) values (p_business, v_name, v_default) returning id into v_id;
  else
    update surgery_message_plans set name = v_name, is_default = v_default, updated_at = now()
     where id = v_id and business_id = p_business;
    if not found then raise exception 'No such plan here.' using errcode = 'P0002'; end if;
    delete from surgery_message_steps where plan_id = v_id;
  end if;

  for s in select * from jsonb_array_elements(p_plan->'steps') loop
    if coalesce((s->>'day_offset')::integer, 999) not between -30 and 90 then
      raise exception 'A message can be up to 30 days before or 90 days after.' using errcode = '22023';
    end if;
    if coalesce(s->>'send_at', '10:00')::time not between '08:00' and '20:59' then
      raise exception 'Messages go out between 8 am and 9 pm.' using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(s->>'body', ''))) not between 10 and 600 then
      raise exception 'Each message needs 10 to 600 letters.' using errcode = '22023';
    end if;
    insert into surgery_message_steps (plan_id, day_offset, send_at, body, sort_order)
    values (v_id, (s->>'day_offset')::integer, coalesce(s->>'send_at', '10:00')::time, btrim(s->>'body'), n);
    n := n + 1;
  end loop;
  return v_id;
exception when unique_violation then
  raise exception 'There is already a plan called "%".', v_name using errcode = '23505';
end $$;
revoke all on function sehat_surgery_plan_save(uuid, jsonb) from public, anon;
grant execute on function sehat_surgery_plan_save(uuid, jsonb) to authenticated;

create or replace function sehat_surgery_plan_delete(p_plan uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_business uuid;
begin
  select business_id into v_business from surgery_message_plans where id = p_plan;
  if v_business is null then return; end if;
  perform sehat_surgery_plan_editor(v_business);
  delete from surgery_message_plans where id = p_plan;
end $$;
revoke all on function sehat_surgery_plan_delete(uuid) from public, anon;
grant execute on function sehat_surgery_plan_delete(uuid) to authenticated;


-- ── Planning a surgery ──────────────────────────────────────────────────────
-- When, in India, a message for a surgery on p_date is due.
create or replace function sehat_surgery_due(p_date date, p_offset integer, p_time time)
returns timestamptz language sql immutable as $$
  select ((p_date + p_offset) + p_time) at time zone 'Asia/Kolkata';
$$;

create or replace function sehat_planned_surgery_check(p_business uuid, p_member uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or (sehat_caller_is_clinical(p_business) and sehat_caller_sees_patient(p_business, p_member))) then
    raise exception 'Only the clinical staff who see this patient can plan a surgery.' using errcode = '42501';
  end if;
end $$;
revoke all on function sehat_planned_surgery_check(uuid, uuid) from public, anon, authenticated;

-- p: { procedure_name, planned_on, planned_time?, ot_type?, surgeon_id?, surgeon_name?, admission_id?, notes?, plan_id? }
-- plan_id null with no "no_messages" flag takes the hospital's default plan.
create or replace function sehat_plan_surgery(p_business uuid, p_member uuid, p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
  v_on date := nullif(p->>'planned_on', '')::date;
  v_plan uuid := nullif(p->>'plan_id', '')::uuid;
  v_surgeon uuid := nullif(p->>'surgeon_id', '')::uuid;
  v_adm uuid := nullif(p->>'admission_id', '')::uuid;
begin
  perform sehat_planned_surgery_check(p_business, p_member);
  if not exists (select 1 from business_patients where business_id = p_business and patient_member_id = p_member) then
    raise exception 'That patient is not registered here.' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p->>'procedure_name', ''))) < 3 then raise exception 'Name the operation.' using errcode = '22023'; end if;
  if v_on is null then raise exception 'Choose the date.' using errcode = '22023'; end if;
  if v_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'The date has passed — record the operation instead.' using errcode = '22023'; end if;
  if v_adm is not null and not exists (select 1 from admissions a where a.id = v_adm and a.business_id = p_business and a.patient_member_id = p_member) then
    raise exception 'That admission is not this patient''s here.' using errcode = '23514';
  end if;
  if v_plan is null and not coalesce((p->>'no_messages')::boolean, false) then
    perform sehat_surgery_plans(p_business);    -- makes the starter plan if there is none
    select id into v_plan from surgery_message_plans where business_id = p_business and is_default;
  elsif v_plan is not null and not exists (select 1 from surgery_message_plans where id = v_plan and business_id = p_business) then
    raise exception 'No such message plan here.' using errcode = 'P0002';
  end if;

  insert into planned_surgeries (business_id, patient_member_id, admission_id, procedure_name, planned_on, planned_time,
                                 ot_type, surgeon_id, surgeon_name, notes, plan_id, created_by, created_by_name)
  values (p_business, p_member, v_adm, btrim(p->>'procedure_name'), v_on, nullif(p->>'planned_time', '')::time,
          coalesce(nullif(p->>'ot_type', ''), 'major'), v_surgeon,
          coalesce(nullif(btrim(coalesce(p->>'surgeon_name', '')), ''), (select full_name from practitioners where id = v_surgeon)),
          nullif(btrim(coalesce(p->>'notes', '')), ''), v_plan, auth.uid(), sehat_mo_actor_name(p_business))
  returning id into v_id;

  -- The plan's messages that are still ahead.
  insert into surgery_messages (business_id, planned_id, patient_member_id, day_offset, body, due_at)
  select p_business, v_id, p_member, s.day_offset, s.body, sehat_surgery_due(v_on, s.day_offset, s.send_at)
    from surgery_message_steps s
   where s.plan_id = v_plan and sehat_surgery_due(v_on, s.day_offset, s.send_at) > now();
  return v_id;
end $$;
revoke all on function sehat_plan_surgery(uuid, uuid, jsonb) from public, anon;
grant execute on function sehat_plan_surgery(uuid, uuid, jsonb) to authenticated;

-- A new date: every message still to go moves by the same number of days.
create or replace function sehat_surgery_reschedule(p_planned uuid, p_date date, p_time time default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s planned_surgeries; v_days integer;
begin
  select * into s from planned_surgeries where id = p_planned for update;
  if s.id is null then raise exception 'No such planned surgery.' using errcode = 'P0002'; end if;
  perform sehat_planned_surgery_check(s.business_id, s.patient_member_id);
  if s.status <> 'planned' then raise exception 'Only a planned surgery can be moved.' using errcode = 'P0001'; end if;
  if p_date is null or p_date < (now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose a date from today on.' using errcode = '22023'; end if;
  v_days := p_date - s.planned_on;
  update planned_surgeries set planned_on = p_date, planned_time = p_time, updated_at = now() where id = p_planned;
  update surgery_messages set due_at = due_at + make_interval(days => v_days)
   where planned_id = p_planned and status = 'pending';
  -- One that would now fall in the past is not sent late.
  update surgery_messages set status = 'skipped', why = 'its day passed when the surgery was moved'
   where planned_id = p_planned and status = 'pending' and due_at < now();
end $$;
revoke all on function sehat_surgery_reschedule(uuid, date, time) from public, anon;
grant execute on function sehat_surgery_reschedule(uuid, date, time) to authenticated;

create or replace function sehat_surgery_cancel(p_planned uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s planned_surgeries;
begin
  select * into s from planned_surgeries where id = p_planned for update;
  if s.id is null then raise exception 'No such planned surgery.' using errcode = 'P0002'; end if;
  perform sehat_planned_surgery_check(s.business_id, s.patient_member_id);
  if s.status <> 'planned' then raise exception 'It is not planned any more.' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why it is cancelled.' using errcode = '22023'; end if;
  update planned_surgeries set status = 'cancelled', cancelled_reason = btrim(p_reason), updated_at = now() where id = p_planned;
  update surgery_messages set status = 'cancelled', why = 'surgery cancelled' where planned_id = p_planned and status = 'pending';
end $$;
revoke all on function sehat_surgery_cancel(uuid, text) from public, anon;
grant execute on function sehat_surgery_cancel(uuid, text) to authenticated;

-- The operation is recorded in the OT register: the plan is done. Before-
-- messages not yet sent are dropped; after-care moves to the day it was done.
create or replace function sehat_surgery_mark_done(p_planned uuid, p_surgery uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s planned_surgeries; o surgeries; v_days integer;
begin
  select * into s from planned_surgeries where id = p_planned for update;
  select * into o from surgeries where id = p_surgery;
  if s.id is null or o.id is null or o.business_id <> s.business_id or o.patient_member_id <> s.patient_member_id then
    raise exception 'That operation is not this planned surgery''s patient.' using errcode = '23514';
  end if;
  perform sehat_planned_surgery_check(s.business_id, s.patient_member_id);
  v_days := o.performed_on - s.planned_on;
  update planned_surgeries set status = 'done', surgery_id = o.id, updated_at = now() where id = p_planned;
  update surgery_messages set status = 'skipped', why = 'the operation is done'
   where planned_id = p_planned and status = 'pending' and day_offset <= 0;
  if v_days <> 0 then
    update surgery_messages set due_at = due_at + make_interval(days => v_days)
     where planned_id = p_planned and status = 'pending' and day_offset > 0;
    update surgery_messages set status = 'skipped', why = 'its day had passed when the operation was recorded'
     where planned_id = p_planned and status = 'pending' and due_at < now();
  end if;
end $$;
revoke all on function sehat_surgery_mark_done(uuid, uuid) from public, anon;
grant execute on function sehat_surgery_mark_done(uuid, uuid) to authenticated;

-- One patient's messages: change the words or the day, skip one, add one.
create or replace function sehat_surgery_message_save(p_planned uuid, p_message uuid, p_day_offset integer, p_send_at time, p_body text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare s planned_surgeries; v_due timestamptz; v_id uuid := p_message;
begin
  select * into s from planned_surgeries where id = p_planned;
  if s.id is null then raise exception 'No such planned surgery.' using errcode = 'P0002'; end if;
  perform sehat_planned_surgery_check(s.business_id, s.patient_member_id);
  if s.status = 'cancelled' then raise exception 'This surgery is cancelled.' using errcode = 'P0001'; end if;
  if p_day_offset is null or p_day_offset not between -30 and 90 then raise exception 'Up to 30 days before or 90 days after.' using errcode = '22023'; end if;
  if p_send_at is null or p_send_at not between '08:00' and '20:59' then raise exception 'Messages go out between 8 am and 9 pm.' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 10 and 600 then raise exception 'The message needs 10 to 600 letters.' using errcode = '22023'; end if;
  v_due := sehat_surgery_due(coalesce((select performed_on from surgeries where id = s.surgery_id), s.planned_on), p_day_offset, p_send_at);
  if v_due < now() then raise exception 'That time has passed.' using errcode = '22023'; end if;
  if v_id is null then
    insert into surgery_messages (business_id, planned_id, patient_member_id, day_offset, body, due_at)
    values (s.business_id, s.id, s.patient_member_id, p_day_offset, btrim(p_body), v_due) returning id into v_id;
  else
    update surgery_messages set day_offset = p_day_offset, body = btrim(p_body), due_at = v_due
     where id = v_id and planned_id = p_planned and status = 'pending';
    if not found then raise exception 'That message has already gone, or was skipped.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end $$;
revoke all on function sehat_surgery_message_save(uuid, uuid, integer, time, text) from public, anon;
grant execute on function sehat_surgery_message_save(uuid, uuid, integer, time, text) to authenticated;

create or replace function sehat_surgery_message_skip(p_message uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m surgery_messages;
begin
  select * into m from surgery_messages where id = p_message;
  if m.id is null then return; end if;
  perform sehat_planned_surgery_check(m.business_id, m.patient_member_id);
  update surgery_messages set status = 'skipped', why = 'skipped by ' || sehat_mo_actor_name(m.business_id)
   where id = p_message and status = 'pending';
end $$;
revoke all on function sehat_surgery_message_skip(uuid) from public, anon;
grant execute on function sehat_surgery_message_skip(uuid) to authenticated;

-- Surgeries planned from today on, for the hospital's list.
create or replace function sehat_upcoming_surgeries(p_business uuid, p_days integer default 14)
returns table (id uuid, patient_member_id uuid, patient_name text, procedure_name text, planned_on date, planned_time time,
               ot_type text, surgeon_name text, messages_left integer)
language sql stable security definer set search_path = public as $$
  select s.id, s.patient_member_id, m.full_name, s.procedure_name, s.planned_on, s.planned_time, s.ot_type, s.surgeon_name,
         (select count(*)::integer from surgery_messages x where x.planned_id = s.id and x.status = 'pending')
    from planned_surgeries s join patient_members m on m.id = s.patient_member_id
   where s.business_id = p_business and s.status = 'planned'
     and s.planned_on between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + greatest(1, least(coalesce(p_days, 14), 90))
     and (sehat_is_admin() or sehat_caller_is_business(p_business)
          or (sehat_caller_is_clinical(p_business) and sehat_caller_sees_patient(p_business, s.patient_member_id)))
   order by s.planned_on, s.planned_time nulls last;
$$;
revoke all on function sehat_upcoming_surgeries(uuid, integer) from public, anon;
grant execute on function sehat_upcoming_surgeries(uuid, integer) to authenticated;


-- ── Sending ─────────────────────────────────────────────────────────────────
-- As sehat_wa_auto_claim (0262): every check again at the moment of sending,
-- the app first, and what is left is returned for wa-auto-send to WhatsApp.
-- The hospital's words go in as one template variable, so they are made one
-- line (Meta refuses line breaks inside a variable).
create or replace function sehat_surgery_msg_claim(p_limit integer default 50)
returns setof jsonb
language plpgsql security definer set search_path = public as $$
declare
  m surgery_messages;
  s planned_surgeries;
  v_phone text; v_name text; v_first text; v_clinic text; v_uid uuid;
  v_day date; v_when text; v_words text; v_skip text; v_pushed integer;
begin
  for m in
    select * from surgery_messages
     where (status = 'pending' and due_at <= now())
        or (status = 'sending' and claimed_at < now() - interval '15 minutes' and attempts < 3)
     order by due_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  loop
    v_skip := null;
    select * into s from planned_surgeries where id = m.planned_id;
    select sehat_normalise_phone(pa.phone), pm.full_name into v_phone, v_name
      from patient_members pm join patients pa on pa.id = pm.patient_id where pm.id = m.patient_member_id;
    v_first := nullif(split_part(btrim(coalesce(v_name, '')), ' ', 1), '');
    select b.name into v_clinic from businesses b where b.id = m.business_id;
    v_day := coalesce((select performed_on from surgeries where id = s.surgery_id), s.planned_on);
    v_when := to_char(v_day, 'Dy FMDD Mon') || case when m.day_offset <= 0 and s.planned_time is not null
                                                   then ' at ' || to_char(s.planned_time, 'FMHH12:MI AM') else '' end;
    v_words := btrim(regexp_replace(regexp_replace(m.body, '\s*[\r\n]+\s*', ' · ', 'g'), '\s{2,}', ' ', 'g'));

    if s.status = 'cancelled' then v_skip := 'surgery cancelled';
    elsif m.day_offset <= 0 and s.status = 'done' then v_skip := 'the operation is done';
    elsif m.due_at < now() - interval '1 day' then v_skip := 'more than a day late';
    elsif not sehat_wa_auto_on(m.business_id, 'surgery') then v_skip := 'switched off, or WhatsApp Pro is not active';
    elsif v_phone is null then v_skip := 'no mobile number';
    elsif exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(v_phone)) then v_skip := 'the patient said STOP';
    end if;
    if v_skip is not null then
      update surgery_messages set status = 'skipped', why = v_skip where id = m.id;
      continue;
    end if;

    select a.auth_uid into v_uid from patient_app_accounts a where a.phone = v_phone;
    if v_uid is not null then
      v_pushed := sehat_queue_push('clinic', m.business_id, array[v_uid], v_clinic,
        left((case when m.day_offset <= 0 then 'Before your ' else 'After your ' end) || s.procedure_name || ' (' || v_when || '): ' || v_words, 240),
        jsonb_build_object('kind', 'surgery', 'business_id', m.business_id, 'planned_id', s.id));
      if v_pushed > 0 then
        update surgery_messages set status = 'sent', channel = 'push', sent_at = now(), attempts = attempts + 1, claimed_at = now() where id = m.id;
        continue;
      end if;
    end if;

    update surgery_messages set status = 'sending', attempts = attempts + 1, claimed_at = now() where id = m.id;
    return next jsonb_build_object(
      'id', m.id, 'kind', 'surgery', 'business_id', m.business_id, 'phone', v_phone,
      'name', coalesce(v_first, 'Patient'), 'clinic', v_clinic,
      'campaign', case when m.day_offset <= 0 then 'AISENSY_SURGERY_REMINDER_CAMPAIGN' else 'AISENSY_SURGERY_AFTERCARE_CAMPAIGN' end,
      'params', jsonb_build_array(coalesce(v_name, 'Patient'), v_clinic, s.procedure_name, v_when, v_words));
  end loop;
end $$;
revoke all on function sehat_surgery_msg_claim(integer) from public, anon, authenticated;
grant execute on function sehat_surgery_msg_claim(integer) to service_role;

create or replace function sehat_surgery_msg_done(p_id uuid, p_ok boolean, p_message_id text default null,
                                                  p_error text default null, p_retry boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare m surgery_messages;
begin
  select * into m from surgery_messages where id = p_id;
  if m.id is null then return; end if;
  if p_ok then
    update surgery_messages set status = 'sent', channel = 'whatsapp', sent_at = now(), why = null,
           wa_message_id = nullif(p_message_id, '') where id = p_id;
  elsif p_retry and m.attempts < 3 then
    update surgery_messages set status = 'pending', due_at = now() + interval '10 minutes', why = left(p_error, 300) where id = p_id;
  else
    update surgery_messages set status = 'failed', why = left(p_error, 300) where id = p_id;
  end if;
end $$;
revoke all on function sehat_surgery_msg_done(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function sehat_surgery_msg_done(uuid, boolean, text, text, boolean) to service_role;

-- wa-auto-send runs while either queue has something due.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'wa-auto-send';
  perform cron.schedule('wa-auto-send', '*/2 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/wa-auto-send',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
    where exists (select 1 from wa_auto_messages where status = 'pending' and due_at <= now())
       or exists (select 1 from surgery_messages where status = 'pending' and due_at <= now())
  $job$);
end $$;

notify pgrst, 'reload schema';
