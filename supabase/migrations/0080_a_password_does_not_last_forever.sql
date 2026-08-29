-- ============================================================================
-- Sehatsandhi — a password does not last forever
--
-- Run AFTER 0079. Safe to re-run.
--
-- ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
-- Supabase Auth stores the password and will not tell us when it was last set:
-- auth.users.updated_at moves for a dozen unrelated reasons — an email change,
-- a metadata write, a session refresh — so it cannot answer "how old is this
-- password". Nothing in the project records it. So this records it.
--
-- Be clear about the boundary, because it matters when somebody audits this.
-- Expiry here is an ACCOUNT-STATE FLAG and a screen in front of it. It is not
-- an RLS gate: an expired session still holds a valid JWT, and every policy in
-- the schema keys off auth.uid(), not off password age. Somebody who ignored
-- the app and drove the REST API directly would still be served.
--
-- Making it a real gate is one line inside sehat_caller_role() — return null
-- when the password is expired — and that would lock an expired account out of
-- every clinical table at once. It is deliberately NOT done here: that function
-- is called by nearly every policy in the schema, a mistake in it locks out
-- every clinic simultaneously, and it deserves its own migration and its own
-- rehearsal rather than riding along with the feature that motivated it. The
-- hook is left ready — sehat_password_expired() takes a uid and answers.
--
-- ── WHY A TABLE OF OUR OWN ──────────────────────────────────────────────────
-- One row per auth user, not per practitioner or business, because one person
-- may be both and there is only one password between them. Keyed on the auth
-- uid so it survives everything else being renamed around it, which this schema
-- has form for.
-- ============================================================================


create table if not exists auth_password_state (
  auth_uid            uuid primary key,
  password_changed_at timestamptz not null default now(),
  -- Set when somebody else resets it, or when an account is created with a
  -- password the person did not choose. Independent of age: a password can be
  -- one minute old and still need changing because it was not theirs.
  must_change         boolean not null default false,
  must_change_reason  text,
  updated_at          timestamptz not null default now()
);

comment on table auth_password_state is
  'Added in 0080. When each login last set its password. Supabase Auth does not '
  'expose this — auth.users.updated_at moves for unrelated reasons — so it is '
  'recorded here as the password is changed.';

alter table auth_password_state enable row level security;

-- A person may read their own state and nothing else: this row says how close
-- somebody is to being locked out, which is nobody else's business.
drop policy if exists own_password_state on auth_password_state;
create policy own_password_state on auth_password_state
  for select using (auth_uid = auth.uid() or sehat_is_admin());

-- Writes go through the functions below, which are SECURITY DEFINER. No policy
-- for insert or update means no direct write, which is what we want: a caller
-- who could update this row could postpone their own expiry indefinitely.

grant select on auth_password_state to authenticated;


-- ── How long, and who decides ───────────────────────────────────────────────
--
-- Ninety days is the figure most Indian hospital IT policies and the tender
-- paperwork that follows them ask for. It is a poor security control on its own
-- — current NIST guidance argues against forced rotation, because it produces
-- Passw0rd1, Passw0rd2 — and it is here because it is asked for, not because it
-- helps much. Kept as a function so changing it is one migration and not a
-- search through the codebase.
--
-- The warning window is when the UI starts saying "expires in n days" rather
-- than waiting to lock somebody out mid-clinic.

create or replace function sehat_password_max_age_days()
returns integer language sql immutable as $$ select 90 $$;

create or replace function sehat_password_warn_days()
returns integer language sql immutable as $$ select 10 $$;


-- ── The answer, for one login ───────────────────────────────────────────────
--
-- An account with no row has never had its password recorded — everything that
-- existed before this migration. Treated as NOT expired and dated from now on
-- first read, rather than as expired: locking out every account in the system
-- on the day a feature ships is not a security improvement, it is an outage.

create or replace function sehat_password_state()
returns table(
  password_changed_at timestamptz,
  expires_at timestamptz,
  days_left integer,
  expired boolean,
  must_change boolean,
  must_change_reason text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (
    select s.password_changed_at, s.must_change, s.must_change_reason
      from auth_password_state s
     where s.auth_uid = auth.uid()
  ),
  resolved as (
    select coalesce((select password_changed_at from me), now())            as changed_at,
           coalesce((select must_change        from me), false)            as must_change,
           (select must_change_reason from me)                             as reason
  )
  select r.changed_at,
         r.changed_at + make_interval(days => sehat_password_max_age_days()),
         greatest(0, extract(day from
           (r.changed_at + make_interval(days => sehat_password_max_age_days())) - now())::integer),
         now() > r.changed_at + make_interval(days => sehat_password_max_age_days()),
         r.must_change,
         r.reason
    from resolved r
   where auth.uid() is not null;
$$;

comment on function sehat_password_state is
  'Added in 0080. What the caller''s own password situation is. A login with no '
  'row is treated as fresh, not as expired — shipping this must not lock out '
  'every account that predates it.';

grant execute on function sehat_password_state() to authenticated;

-- The same question about somebody else, for an admin screen and for the RLS
-- gate this deliberately does not yet install.
create or replace function sehat_password_expired(p_auth_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select s.must_change
         or now() > s.password_changed_at + make_interval(days => sehat_password_max_age_days())
       from auth_password_state s
      where s.auth_uid = p_auth_uid),
    false);
$$;

grant execute on function sehat_password_expired(uuid) to authenticated, service_role;


-- ── Recording a change ──────────────────────────────────────────────────────
--
-- Called by the client straight after supabase.auth.updateUser({ password }).
-- It can only ever stamp the CALLER's own row — the uid comes from the JWT, not
-- from an argument — so it cannot be used to reset somebody else's clock.

create or replace function sehat_password_changed()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  insert into auth_password_state (auth_uid, password_changed_at, must_change,
                                   must_change_reason, updated_at)
  values (auth.uid(), now(), false, null, now())
  on conflict (auth_uid) do update
    set password_changed_at = now(),
        must_change         = false,
        must_change_reason  = null,
        updated_at          = now();
end $$;

comment on function sehat_password_changed is
  'Added in 0080. Stamps the caller''s own row. Takes no uid on purpose: with '
  'one it would be a way to clear somebody else''s forced change.';

grant execute on function sehat_password_changed() to authenticated;

-- Forcing one, for an admin or for a staff account created with a password
-- somebody else chose.
create or replace function sehat_require_password_change(p_auth_uid uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sehat_is_admin() then
    raise exception 'only Sehatsandhi can require a password change'
      using errcode = 'insufficient_privilege';
  end if;

  insert into auth_password_state (auth_uid, password_changed_at, must_change,
                                   must_change_reason, updated_at)
  values (p_auth_uid, now(), true, p_reason, now())
  on conflict (auth_uid) do update
    set must_change        = true,
        must_change_reason = p_reason,
        updated_at         = now();
end $$;

grant execute on function sehat_require_password_change(uuid, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';


-- ============================================================================
-- NOT DONE HERE
--
--   The RLS gate, as described at the top. sehat_password_expired() is the
--   hook; wiring it into sehat_caller_role() is the move, and it belongs in a
--   migration of its own because that function backs nearly every policy in the
--   schema and a mistake in it is a total outage rather than a bug.
--
--   Nothing backfills password_changed_at for the accounts that already exist.
--   They have no row, which reads as fresh, and they get one the first time
--   they change a password. Dating them from today would be a lie; dating them
--   from account creation would expire most of them on the day this ships.
--
--   Reuse is not checked. "Not one of your last five" needs a history of
--   hashes, and this project does not hold password hashes at all — Supabase
--   Auth does, and does not expose them. It would have to be built there or not
--   at all.
-- ============================================================================
