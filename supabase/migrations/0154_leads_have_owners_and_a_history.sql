-- ============================================================================
-- Sehatsandhi — leads have an owner, a history, a target date and a way to close
--
-- Run AFTER 0153. Safe to re-run.
--
-- Decided 28 Sep 2026 (admin Phase 2):
--
--   • A lead is ASSIGNED to one admin or manager. An admin assigns anyone; a
--     manager may take an unassigned lead or give one back, not hand it to
--     somebody else. A manager sees their own leads and the unassigned ones;
--     an admin sees all.
--   • Every touch is an ACTIVITY with an author: a call (with its outcome), a
--     WhatsApp, an email, a meeting or a note — and, written automatically,
--     every change of stage, owner, follow-up date, target date, and every
--     close or reopen. doctor_lead_notes becomes that timeline; old notes stay
--     as kind 'note' with no author.
--   • A lead has a TARGET date to close by, and is CLOSED with a reason:
--     registered, not interested, too expensive, uses other software,
--     unreachable, duplicate, other. It can be reopened.
--   • Admin gets a per-person summary: open, due, overdue, touched this week,
--     won and lost this month.
-- ============================================================================

-- ── The lead ────────────────────────────────────────────────────────────────
alter table doctor_leads add column if not exists assigned_to uuid;          -- admin_users.auth_uid
alter table doctor_leads add column if not exists target_close date;
alter table doctor_leads add column if not exists closed_at timestamptz;
alter table doctor_leads add column if not exists close_reason text;
alter table doctor_leads add column if not exists email text;
alter table doctor_leads add column if not exists city text;
alter table doctor_leads add column if not exists created_by uuid;

do $$ begin
  alter table doctor_leads add constraint doctor_leads_close_reason_check check (
    close_reason is null or close_reason in
      ('registered', 'not_interested', 'too_expensive', 'other_software', 'unreachable', 'duplicate', 'other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table doctor_leads add constraint doctor_leads_closed_has_reason
    check ((closed_at is null) = (close_reason is null));
exception when duplicate_object then null; end $$;

create index if not exists doctor_leads_assigned_idx on doctor_leads (assigned_to, next_followup) where closed_at is null;

-- ── The timeline ────────────────────────────────────────────────────────────
alter table doctor_lead_notes add column if not exists kind text not null default 'note';
alter table doctor_lead_notes add column if not exists outcome text;
alter table doctor_lead_notes add column if not exists author_uid uuid default auth.uid();
alter table doctor_lead_notes add column if not exists author_label text;
alter table doctor_lead_notes add column if not exists detail jsonb not null default '{}'::jsonb;

do $$ begin
  alter table doctor_lead_notes add constraint doctor_lead_notes_kind_check check (kind in
    ('note', 'call', 'whatsapp', 'email', 'meeting',
     'stage', 'assigned', 'followup', 'target', 'closed', 'reopened', 'created'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table doctor_lead_notes add constraint doctor_lead_notes_outcome_check check (outcome is null or outcome in
    ('connected', 'no_answer', 'busy', 'switched_off', 'callback', 'wrong_number', 'interested', 'not_interested'));
exception when duplicate_object then null; end $$;

-- Automatic entries have a sentence, not free text; allow the note to be empty for them.
alter table doctor_lead_notes drop constraint if exists doctor_lead_notes_note_check;
do $$ begin
  alter table doctor_lead_notes add constraint doctor_lead_notes_note_present
    check (kind not in ('note') or length(btrim(note)) > 0);
exception when duplicate_object then null; end $$;

-- The author is whoever is signed in; the browser cannot claim to be someone else.
create or replace function sehat_lead_note_author()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_uid := auth.uid();
  new.author_label := coalesce(
    (select coalesce(nullif(a.full_name, ''), a.email) from admin_users a where a.auth_uid = auth.uid()),
    (select email from auth.users where id = auth.uid()),
    new.author_label);
  return new;
end $$;
drop trigger if exists lead_note_author on doctor_lead_notes;
create trigger lead_note_author before insert on doctor_lead_notes
  for each row execute function sehat_lead_note_author();

-- ── Who sees and changes what ───────────────────────────────────────────────
create or replace function sehat_sees_lead(p_assigned uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select sehat_is_admin() or (sehat_is_manager() and (p_assigned is null or p_assigned = auth.uid()));
$$;
grant execute on function sehat_sees_lead(uuid) to authenticated;

drop policy if exists "admins_read_doctor_leads" on doctor_leads;
create policy "admins_read_doctor_leads" on doctor_leads for select using (sehat_sees_lead(assigned_to));
drop policy if exists "admins_insert_doctor_leads" on doctor_leads;
create policy "admins_insert_doctor_leads" on doctor_leads for insert
  with check (sehat_is_staff() and sehat_sees_lead(assigned_to));
drop policy if exists "admins_update_doctor_leads" on doctor_leads;
create policy "admins_update_doctor_leads" on doctor_leads for update
  using (sehat_sees_lead(assigned_to)) with check (sehat_sees_lead(assigned_to));

drop policy if exists "admins_read_doctor_lead_notes" on doctor_lead_notes;
create policy "admins_read_doctor_lead_notes" on doctor_lead_notes for select
  using (exists (select 1 from doctor_leads l where l.id = lead_id));      -- RLS on doctor_leads decides
drop policy if exists "admins_insert_doctor_lead_notes" on doctor_lead_notes;
create policy "admins_insert_doctor_lead_notes" on doctor_lead_notes for insert
  with check (sehat_is_staff() and exists (select 1 from doctor_leads l where l.id = lead_id)
              and kind in ('note', 'call', 'whatsapp', 'email', 'meeting'));   -- the rest are written by triggers

-- A manager takes an unassigned lead or gives theirs back; only an admin
-- hands a lead to someone else.
create or replace function sehat_lead_assign_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    -- A manager's new lead is theirs unless they leave it for the pool.
    if sehat_is_manager() and not sehat_is_admin() and new.assigned_to is distinct from auth.uid() then
      new.assigned_to := case when new.assigned_to is null then null else auth.uid() end;
    end if;
    return new;
  end if;
  if new.assigned_to is distinct from old.assigned_to and not sehat_is_admin() and auth.uid() is not null then
    if not (new.assigned_to = auth.uid() and old.assigned_to is null)       -- take
       and not (new.assigned_to is null and old.assigned_to = auth.uid()) then -- give back
      raise exception 'Only an admin can hand a lead to someone else.' using errcode = '42501';
    end if;
  end if;
  -- Closing and reopening keep stage and the close fields in step.
  if new.close_reason is not null and old.close_reason is null then
    new.closed_at := coalesce(new.closed_at, now());
    if new.close_reason = 'registered' and new.stage not in ('registered', 'active') then new.stage := 'registered'; end if;
    if new.close_reason <> 'registered' then new.stage := 'not_interested'; end if;
    new.next_followup := null;
  elsif new.close_reason is null and old.close_reason is not null then
    new.closed_at := null;
    if new.stage = 'not_interested' then new.stage := 'interested'; end if;
  end if;
  return new;
end $$;
drop trigger if exists a_lead_assign_guard on doctor_leads;
create trigger a_lead_assign_guard before insert or update on doctor_leads
  for each row execute function sehat_lead_assign_guard();

-- ── The automatic timeline ──────────────────────────────────────────────────
create or replace function sehat_lead_history()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  add_row boolean;
begin
  if tg_op = 'INSERT' then
    insert into doctor_lead_notes (lead_id, kind, note, detail)
    values (new.id, 'created', 'Lead added', jsonb_build_object('source', new.source));
    if new.assigned_to is not null then
      insert into doctor_lead_notes (lead_id, kind, note, detail)
      values (new.id, 'assigned', 'Assigned to ' || coalesce((select coalesce(nullif(full_name, ''), email) from admin_users where auth_uid = new.assigned_to), 'someone'),
              jsonb_build_object('to', new.assigned_to));
    end if;
    return null;
  end if;

  if old.close_reason is null and new.close_reason is not null then
    insert into doctor_lead_notes (lead_id, kind, note, detail)
    values (new.id, 'closed', 'Closed: ' || replace(new.close_reason, '_', ' '), jsonb_build_object('reason', new.close_reason));
  elsif old.close_reason is not null and new.close_reason is null then
    insert into doctor_lead_notes (lead_id, kind, note) values (new.id, 'reopened', 'Reopened');
  elsif old.stage is distinct from new.stage then
    insert into doctor_lead_notes (lead_id, kind, note, detail)
    values (new.id, 'stage', 'Stage: ' || replace(old.stage, '_', ' ') || ' → ' || replace(new.stage, '_', ' '),
            jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  if old.assigned_to is distinct from new.assigned_to then
    v_name := (select coalesce(nullif(full_name, ''), email) from admin_users where auth_uid = new.assigned_to);
    insert into doctor_lead_notes (lead_id, kind, note, detail)
    values (new.id, 'assigned', case when new.assigned_to is null then 'Returned to the unassigned pool' else 'Assigned to ' || coalesce(v_name, 'someone') end,
            jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;
  if old.next_followup is distinct from new.next_followup and new.close_reason is null then
    insert into doctor_lead_notes (lead_id, kind, note, detail)
    values (new.id, 'followup', coalesce('Next follow-up ' || to_char(new.next_followup, 'DD Mon'), 'Follow-up cleared'),
            jsonb_build_object('from', old.next_followup, 'to', new.next_followup));
  end if;
  if old.target_close is distinct from new.target_close then
    insert into doctor_lead_notes (lead_id, kind, note, detail)
    values (new.id, 'target', coalesce('Target to close by ' || to_char(new.target_close, 'DD Mon'), 'Target cleared'),
            jsonb_build_object('from', old.target_close, 'to', new.target_close));
  end if;
  return null;
end $$;
drop trigger if exists lead_history on doctor_leads;
create trigger lead_history after insert or update on doctor_leads
  for each row execute function sehat_lead_history();

-- ── For the screens ─────────────────────────────────────────────────────────
-- Who a lead can be assigned to: the active team.
create or replace function sehat_lead_assignees()
returns table (auth_uid uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select a.auth_uid, coalesce(nullif(a.full_name, ''), a.email), a.role
    from admin_users a
   where a.is_active and sehat_is_staff()
   order by (a.role = 'manager'), 2;
$$;
grant execute on function sehat_lead_assignees() to authenticated;

-- Per person: the admin's view of who is working which leads, and how.
create or replace function sehat_lead_team_summary()
returns table (auth_uid uuid, name text, role text, open_leads integer, due_today integer, overdue integer,
               touches_7d integer, calls_7d integer, won_30d integer, lost_30d integer, last_touch timestamptz)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date d)
  select a.auth_uid, coalesce(nullif(a.full_name, ''), a.email), a.role,
         (select count(*)::int from doctor_leads l where l.assigned_to = a.auth_uid and l.closed_at is null),
         (select count(*)::int from doctor_leads l, today where l.assigned_to = a.auth_uid and l.closed_at is null and l.next_followup = today.d),
         (select count(*)::int from doctor_leads l, today where l.assigned_to = a.auth_uid and l.closed_at is null and l.next_followup < today.d),
         (select count(*)::int from doctor_lead_notes n where n.author_uid = a.auth_uid
             and n.kind in ('note', 'call', 'whatsapp', 'email', 'meeting') and n.created_at > now() - interval '7 days'),
         (select count(*)::int from doctor_lead_notes n where n.author_uid = a.auth_uid
             and n.kind = 'call' and n.created_at > now() - interval '7 days'),
         (select count(*)::int from doctor_leads l where l.assigned_to = a.auth_uid and l.close_reason = 'registered' and l.closed_at > now() - interval '30 days'),
         (select count(*)::int from doctor_leads l where l.assigned_to = a.auth_uid and l.close_reason <> 'registered' and l.closed_at > now() - interval '30 days'),
         (select max(n.created_at) from doctor_lead_notes n where n.author_uid = a.auth_uid
             and n.kind in ('note', 'call', 'whatsapp', 'email', 'meeting'))
    from admin_users a
   where a.is_active and sehat_is_admin()
   order by 4 desc, 2;
$$;
grant execute on function sehat_lead_team_summary() to authenticated;

notify pgrst, 'reload schema';
