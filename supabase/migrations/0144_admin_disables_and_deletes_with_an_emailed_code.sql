-- ============================================================================
-- Sehatsandhi — admin disables or deletes a business, confirmed by an emailed code
--
-- Run AFTER 0143. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • The admin panel can DISABLE any business (status 'suspended', whatever it
--     was before) and DELETE one outright. Until now there was no delete at all,
--     and an unpaid listing had no action but Verify.
--   • Both need a reason, and both need a six-digit code emailed to the admin
--     who asked. The email says exactly what will happen: which business, why,
--     who asked, and — for a delete — how many records go with it.
--   • A business with a PAID payment cannot be deleted: its GST invoices must be
--     kept. Nor can one with patients: medical records must be kept, and doses,
--     charges and prescription lines are append-only by trigger. Disable those
--     instead. Unpaid order attempts go with the business.
--   • Deleting also removes the business's doctors when no other business lists
--     them, and the logins nothing else uses. An admin's login is never touched.
--
-- The admin-business-action edge function does the work: it checks the caller
-- is an admin, makes and hashes the code, sends the email and, once the code
-- matches, calls the functions below. Neither function is callable from the
-- browser; the code check cannot be skipped by calling them directly.
-- ============================================================================

-- ── One row per request, kept after the business is gone ────────────────────
-- No foreign key to businesses on purpose: the record of a delete has to
-- outlive what it deleted. The name and details are copied in for that reason.
create table if not exists admin_business_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  business_name text,
  business_snapshot jsonb not null default '{}'::jsonb,
  action text not null check (action in ('disable', 'delete')),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  requested_by_uid uuid not null,
  requested_by_email text not null,
  -- sha256(id || ':' || code), hex. The code itself is never stored.
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'expired', 'superseded', 'locked', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists admin_business_actions_business_idx
  on admin_business_actions (business_id, created_at desc);
create index if not exists admin_business_actions_requester_idx
  on admin_business_actions (requested_by_uid, created_at desc);

-- Service role only. An admin reading code_hash could brute-force six digits.
alter table admin_business_actions enable row level security;
revoke all on admin_business_actions from anon, authenticated;

comment on table admin_business_actions is
  '0144: every disable/delete an admin asked for, with the reason and the '
  'outcome. Survives the business it describes. Written by the '
  'admin-business-action edge function only.';

-- ── What a business has, table by table ─────────────────────────────────────
-- Every public table with a business_id column, counted. Read at request time
-- for the email and again at delete time for the record. Tables are found, not
-- listed, so a table added next month is counted without touching this.
create or replace function sehat_admin_business_footprint(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t record;
  n bigint;
  v jsonb := '{}'::jsonb;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'business_id'
       and tb.table_type = 'BASE TABLE'
       and c.table_name <> 'admin_business_actions'
     order by c.table_name
  loop
    execute format('select count(*) from public.%I where business_id = $1', t.table_name)
      into n using p_business;
    if n > 0 then v := v || jsonb_build_object(t.table_name, n); end if;
  end loop;
  return v;
end $$;

revoke all on function sehat_admin_business_footprint(uuid) from public, anon, authenticated;
grant execute on function sehat_admin_business_footprint(uuid) to service_role;

-- ── Why a delete would be refused, or null when it would not ────────────────
create or replace function sehat_admin_delete_blocker(p_business uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from payments where business_id = p_business and status = 'paid';
  if n > 0 then
    return format('This business has %s paid payment%s. Its GST invoices must be kept, so it cannot be deleted — disable it instead.',
                  n, case when n = 1 then '' else 's' end);
  end if;
  -- Medical records are kept too. Doses, charges and prescription lines are
  -- append-only by trigger, so the delete would fail on them anyway; this says
  -- why before a code is sent rather than after it is typed.
  select count(*) into n from business_patients where business_id = p_business;
  if n > 0 then
    return format('This business has records for %s patient%s. Medical records must be kept, so it cannot be deleted — disable it instead.',
                  n, case when n = 1 then '' else 's' end);
  end if;
  return null;
end $$;

revoke all on function sehat_admin_delete_blocker(uuid) from public, anon, authenticated;
grant execute on function sehat_admin_delete_blocker(uuid) to service_role;

-- ── The delete ──────────────────────────────────────────────────────────────
-- One transaction: either everything below happens or nothing does.
create or replace function sehat_admin_delete_business(p_business uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_biz businesses%rowtype;
  v_blocker text;
  v_footprint jsonb;
  v_docs uuid[];
  v_uids uuid[];
  v_docs_removed integer := 0;
  v_logins_removed integer := 0;
begin
  select * into v_biz from businesses where id = p_business for update;
  if v_biz.id is null then raise exception 'Business not found' using errcode = 'P0002'; end if;

  v_blocker := sehat_admin_delete_blocker(p_business);
  if v_blocker is not null then raise exception '%', v_blocker using errcode = 'P0001'; end if;

  v_footprint := sehat_admin_business_footprint(p_business);

  -- Whose doctors and logins might be left with nothing once this is gone.
  select coalesce(array_agg(distinct bp.practitioner_id), '{}') into v_docs
    from business_practitioners bp where bp.business_id = p_business;
  select coalesce(array_agg(distinct u), '{}') into v_uids
    from (select v_biz.auth_uid as u
          union select p.auth_uid from practitioners p where p.id = any(v_docs)) x
   where u is not null;

  -- The two references that do not cascade. Unpaid order attempts only: a paid
  -- one would have stopped us above.
  delete from discount_code_usage where business_id = p_business;
  delete from payments where business_id = p_business;

  delete from businesses where id = p_business;

  -- Doctors no other business lists, and who wrote nothing for anyone else.
  with gone as (
    delete from practitioners p
     where p.id = any(v_docs)
       and not exists (select 1 from business_practitioners bp where bp.practitioner_id = p.id)
       and not exists (select 1 from prescriptions r where r.practitioner_id = p.id)
       and not exists (select 1 from discharge_summaries d where d.practitioner_id = p.id)
    returning 1)
  select count(*) into v_docs_removed from gone;

  -- Logins nothing uses any more. Never an admin's: admin_users cascades from
  -- auth.users, and losing the last row locks everyone out of the panel.
  with gone as (
    delete from auth.users u
     where u.id = any(v_uids)
       and not exists (select 1 from admin_users a where a.auth_uid = u.id)
       and not exists (select 1 from businesses b where b.auth_uid = u.id)
       and not exists (select 1 from practitioners p where p.auth_uid = u.id)
    returning 1)
  select count(*) into v_logins_removed from gone;

  return jsonb_build_object(
    'removed', v_footprint,
    'doctors_removed', v_docs_removed,
    'logins_removed', v_logins_removed);
end $$;

revoke all on function sehat_admin_delete_business(uuid) from public, anon, authenticated;
grant execute on function sehat_admin_delete_business(uuid) to service_role;

notify pgrst, 'reload schema';
