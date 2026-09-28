-- ============================================================================
-- Sehatsandhi — adding, removing or promoting clinic staff needs an emailed code
--
-- Run AFTER 0146. Safe to re-run.
--
-- Decided 28 Sep 2026, for a business that is live (not still 'pending'):
--
--   • Adding a staff member, removing one, bringing one back, or making one a
--     doctor or an owner needs a six-digit code emailed to the owner or manager
--     making the change. Removing needs a reason. The staff member and the
--     business get an email saying what changed, by whom, and why.
--   • Every staff change — with or without a code — goes in business_staff_log,
--     which the business's owners and managers can read.
--   • "Bring back" restores the role the person had. It used to hard-code
--     'doctor', so a receptionist brought back became a prescribing, billed doctor.
--   • Promoting someone already on the staff to doctor is held for the
--     extra-doctor fee exactly like adding a new doctor (0140). It used to skip
--     the hold, because the hold only looked at status changes.
--
-- ── HOW THE CODE IS ENFORCED ────────────────────────────────────────────────
-- The business-staff-action edge function makes and emails the code, checks it,
-- marks the request 'verified', and then — as the signed-in owner/manager, not
-- as the service role — calls sehat_staff_apply(request). That function sets a
-- transaction-local marker and calls the same attach/detach functions as before.
-- A trigger on business_practitioners refuses any of the changes above unless
-- that marker names a verified request by the same person for the same staff
-- member. So the rule holds for the RPCs and for direct table writes alike.
--
-- Not gated: the service role (payments releasing a paid doctor, the bot, cron),
-- Sehatsandhi admins, and a business still 'pending' — its signup and the
-- doctors it registers with happen before it is live.
-- ============================================================================

-- ── The requests ────────────────────────────────────────────────────────────
create table if not exists business_staff_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  action text not null check (action in ('add', 'remove', 'restore', 'role')),
  role text,                                 -- for add and role: the role being given
  reason text,
  requested_by uuid not null,
  requested_by_email text not null,
  code_hash text not null,                   -- sha256(id || ':' || code), hex
  expires_at timestamptz not null,
  attempts integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'used', 'expired', 'superseded', 'locked', 'failed')),
  verified_at timestamptz,
  used_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists business_staff_requests_lookup
  on business_staff_requests (business_id, practitioner_id, requested_by, created_at desc);

do $$ begin
  alter table business_staff_requests add constraint business_staff_requests_reason
    check (action <> 'remove' or char_length(btrim(coalesce(reason, ''))) between 10 and 1000);
exception when duplicate_object then null; end $$;

-- Service role only: holds code hashes.
alter table business_staff_requests enable row level security;
revoke all on business_staff_requests from anon, authenticated;

-- ── The log ─────────────────────────────────────────────────────────────────
create table if not exists business_staff_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  practitioner_id uuid,
  practitioner_name text,
  action text not null,                      -- added, removed, restored, role_changed
  role_from text,
  role_to text,
  status_to text,
  reason text,
  actor_uid uuid,
  actor_label text,                          -- email, or 'Sehatsandhi' / 'system'
  request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists business_staff_log_business_idx on business_staff_log (business_id, created_at desc);

alter table business_staff_log enable row level security;
revoke all on business_staff_log from anon, authenticated;
grant select on business_staff_log to authenticated;
drop policy if exists "business_reads_staff_log" on business_staff_log;
create policy "business_reads_staff_log" on business_staff_log
  for select using (sehat_caller_is_business(business_id) or sehat_is_admin());

-- ── Which change is this? ───────────────────────────────────────────────────
-- null when it is not one that needs a code.
create or replace function sehat_staff_change_kind(
  p_op text, p_old_status text, p_new_status text, p_old_role text, p_new_role text
) returns text
language sql immutable as $$
  select case
    when p_op = 'INSERT' then 'add'
    when p_old_status is distinct from 'suspended' and p_new_status = 'suspended' then 'remove'
    when p_old_status = 'suspended' and p_new_status is distinct from 'suspended' then 'restore'
    when p_new_role in ('doctor', 'owner') and p_old_role is distinct from p_new_role then 'role'
    else null
  end;
$$;

-- ── The gate ────────────────────────────────────────────────────────────────
create or replace function sehat_staff_change_needs_code()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_req uuid := nullif(current_setting('sehat.staff_request', true), '')::uuid;
begin
  if auth.uid() is null or sehat_is_admin() then return new; end if;
  if (select status from businesses where id = new.business_id) = 'pending' then return new; end if;

  -- attach is INSERT … ON CONFLICT DO UPDATE. For someone already on the staff
  -- the insert never lands; it becomes an UPDATE, and this trigger judges that
  -- update on its own (a restore or a promotion needs the code; a plain role
  -- change does not). Judging the doomed insert as an 'add' would demand a code
  -- for every role change.
  if tg_op = 'INSERT' and exists (select 1 from business_practitioners
                                   where business_id = new.business_id and practitioner_id = new.practitioner_id) then
    return new;
  end if;

  v_kind :=sehat_staff_change_kind(tg_op,
    case when tg_op = 'UPDATE' then old.status end, new.status,
    case when tg_op = 'UPDATE' then old.role end, new.role);
  if v_kind is null then return new; end if;

  -- Matched on who and whom, not the exact kind: a request made as 'role' may
  -- land as a restore when the person was suspended in the meantime.
  if v_req is null or not exists (
    select 1 from business_staff_requests r
     where r.id = v_req and r.status = 'verified'
       and r.requested_by = auth.uid()
       and r.business_id = new.business_id and r.practitioner_id = new.practitioner_id)
  then
    raise exception 'Adding, removing or promoting staff needs the code we email you. Use Doctors & staff on your dashboard.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists a_staff_change_needs_code on business_practitioners;
create trigger a_staff_change_needs_code before insert or update on business_practitioners
  for each row execute function sehat_staff_change_needs_code();

-- ── Promoting to doctor is held for the fee like joining ────────────────────
-- 0140's body, plus one case: someone already live becoming a doctor.
create or replace function sehat_affiliation_joins_live_business()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  b record;
  v_promoted boolean := tg_op = 'UPDATE'
    and new.role = 'doctor' and old.role is distinct from 'doctor'
    and old.status is distinct from 'suspended';
begin
  -- A doctor joining (insert), coming back (suspended → not suspended), or
  -- (0147) someone on the staff becoming a doctor.
  if new.status = 'suspended' then return new; end if;
  if tg_op = 'UPDATE' and old.status is distinct from 'suspended' and not v_promoted then return new; end if;

  select status, term_end into b from businesses where id = new.business_id;
  if b.status is distinct from 'active' then return new; end if;   -- activates with the business (0131)

  if new.role = 'doctor' and not sehat_is_admin()
     and b.term_end is not null and b.term_end > (now() at time zone 'Asia/Kolkata')::date
     and coalesce(sehat_extra_doctor_monthly(new.business_id, new.practitioner_id), 0) > 0 then
    new.status := 'pending';
    new.awaiting_payment := true;
    return new;
  end if;

  if v_promoted then return new; end if;   -- already live; nothing to switch on
  new.status := 'active';
  new.awaiting_payment := false;
  update practitioners set status = 'active' where id = new.practitioner_id and status = 'pending';
  return new;
end $$;

drop trigger if exists business_practitioners_join_live on business_practitioners;
create trigger business_practitioners_join_live
  before insert or update of status, role on business_practitioners
  for each row execute function sehat_affiliation_joins_live_business();

-- ── Carrying out a verified request ─────────────────────────────────────────
-- Called by the edge function WITH THE CALLER'S TOKEN, so attach/detach check
-- the caller exactly as they always have.
create or replace function sehat_staff_apply(p_request uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r business_staff_requests%rowtype;
  bp business_practitioners%rowtype;
  v_role text;
begin
  select * into r from business_staff_requests where id = p_request for update;
  if r.id is null or r.requested_by is distinct from auth.uid() then
    raise exception 'That request was not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'verified' or r.verified_at < now() - interval '10 minutes' then
    raise exception 'That code has already been used or has expired. Start again.' using errcode = 'P0001';
  end if;

  perform set_config('sehat.staff_request', r.id::text, true);
  select * into bp from business_practitioners
   where business_id = r.business_id and practitioner_id = r.practitioner_id;

  if r.action = 'remove' then
    perform sehat_detach_practitioner(r.business_id, r.practitioner_id);
  else
    -- restore keeps the role they had; add and role use the one asked for.
    v_role := case when r.action = 'restore' then coalesce(bp.role, 'doctor') else coalesce(r.role, 'doctor') end;
    perform sehat_attach_practitioner(r.business_id, r.practitioner_id, v_role,
                                      coalesce(bp.is_primary, false), coalesce(bp.consultation_fee, 0));
  end if;

  select * into bp from business_practitioners
   where business_id = r.business_id and practitioner_id = r.practitioner_id;
  update business_staff_requests
     set status = 'used', used_at = now(),
         result = jsonb_build_object('status', bp.status, 'role', bp.role, 'awaiting_payment', bp.awaiting_payment)
   where id = r.id;
  perform set_config('sehat.staff_request', '', true);

  return jsonb_build_object('status', bp.status, 'role', bp.role, 'awaiting_payment', bp.awaiting_payment);
end $$;

revoke all on function sehat_staff_apply(uuid) from public, anon;
grant execute on function sehat_staff_apply(uuid) to authenticated;

-- ── Writing the log ─────────────────────────────────────────────────────────
create or replace function sehat_log_staff_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_req uuid := nullif(current_setting('sehat.staff_request', true), '')::uuid;
  v_reason text;
  v_actor text;
begin
  if tg_op = 'INSERT' then
    v_action := 'added';
  elsif old.status is distinct from 'suspended' and new.status = 'suspended' then
    v_action := 'removed';
  elsif old.status = 'suspended' and new.status is distinct from 'suspended' then
    v_action := 'restored';
  elsif old.role is distinct from new.role then
    v_action := 'role_changed';
  else
    return null;
  end if;

  if v_req is not null then select reason into v_reason from business_staff_requests where id = v_req; end if;
  v_actor := case
    when auth.uid() is null then 'system'
    when sehat_is_admin() then 'Sehatsandhi'
    else coalesce((select email from auth.users where id = auth.uid()), auth.uid()::text)
  end;

  insert into business_staff_log (business_id, practitioner_id, practitioner_name, action,
                                  role_from, role_to, status_to, reason, actor_uid, actor_label, request_id)
  values (new.business_id, new.practitioner_id,
          (select full_name from practitioners where id = new.practitioner_id),
          v_action, case when tg_op = 'UPDATE' then old.role end, new.role, new.status,
          v_reason, auth.uid(), v_actor, v_req);
  return null;
end $$;

drop trigger if exists staff_log on business_practitioners;
create trigger staff_log after insert or update on business_practitioners
  for each row execute function sehat_log_staff_change();

notify pgrst, 'reload schema';
