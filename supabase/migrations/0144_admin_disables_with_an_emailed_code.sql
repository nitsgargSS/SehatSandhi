-- ============================================================================
-- Sehatsandhi — admin disables a business, confirmed by an emailed code
--
-- Run AFTER 0143. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • The admin panel can DISABLE a business (status 'suspended'). There is no
--     delete, on purpose: a business, its invoices and its patients' records
--     must never disappear by a slip. Reactivate undoes a disable.
--   • Disabling needs a reason and a six-digit code emailed to the admin who
--     asked. The email says which business, why, who asked and when; a receipt
--     follows once it is done.
--
-- The admin-business-action edge function does the work: it checks the caller
-- is an admin, makes and hashes the code, sends the email and, once the code
-- matches, disables the business and records the outcome here.
-- ============================================================================

-- ── One row per request ─────────────────────────────────────────────────────
-- No foreign key to businesses: the record is the audit trail and must not
-- depend on the row it describes. The name and details are copied in.
create table if not exists admin_business_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  business_name text,
  business_snapshot jsonb not null default '{}'::jsonb,
  action text not null,
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

do $$ begin
  alter table admin_business_actions drop constraint if exists admin_business_actions_action_check;
  alter table admin_business_actions add constraint admin_business_actions_action_check
    check (action = 'disable');
end $$;

-- Service role only. An admin reading code_hash could brute-force six digits.
alter table admin_business_actions enable row level security;
revoke all on admin_business_actions from anon, authenticated;

comment on table admin_business_actions is
  '0144: every disable an admin asked for, with the reason and the '
  'outcome. Survives the business it describes. Written by the '
  'admin-business-action edge function only.';

-- ── No delete ───────────────────────────────────────────────────────────────
-- Decided the same day: admin may only disable. A delete path was built and
-- removed before it reached production; this drops it from sandbox, where it
-- was applied while being tested.
drop function if exists sehat_admin_delete_business(uuid);
drop function if exists sehat_admin_delete_blocker(uuid);
drop function if exists sehat_admin_business_footprint(uuid);

notify pgrst, 'reload schema';
