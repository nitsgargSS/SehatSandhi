-- ============================================================================
-- Sehatsandhi — a local copy of the Indian Medical Register
--
-- Run AFTER 0028. Safe to re-run.
--
-- WHY
-- A doctor signing up types a registration number, and until now nothing checked
-- it. The admin who is supposed to verify it opens the NMC portal and reads the
-- record by hand, for every listing.
--
-- The register is public — the NMC Act 2019 s.31 requires it to be published and
-- makes it a public document — and it is small enough to hold: 1.5M rows, ~110 MB
-- with indexes. Holding it locally turns a ~2 second call to a government server
-- we do not own into an indexed query, which is the difference between a button
-- the doctor has to press and a field that completes itself as they type.
--
-- It also buys the search the upstream API cannot do. Asking it for a name
-- containing a space returns HTTP 500, and 'Sharma' alone returns 20,601 rows.
-- Locally, with a trigram index, both are ordinary queries.
--
-- WHAT IS NOT HERE
-- The register carries each doctor's father's name. It is not copied. We are
-- confirming that a registration number belongs to who someone says it does, and
-- a parent's name does nothing for that. Copying it because the upstream response
-- happened to include it is how a prefill convenience quietly becomes a dossier
-- on 1.5M people who never heard of us.
--
-- STALENESS
-- Deliberately unsolved for now. Everything this prefills is editable by the
-- doctor, so a stale or missing row costs them some typing and nothing else.
-- Roughly 1,500 doctors register a month; a refresh job comes later, and until it
-- does the on-demand lookup handles anyone too new to be in here.
-- ============================================================================

-- Trigram indexes make ILIKE '%name%' searchable rather than a sequential scan
-- over 1.5M rows. Supabase ships the extension; this only enables it.
create extension if not exists pg_trgm;

create table if not exists imr_doctors (
  -- The register's own row id, from the detail link in each listing row. Stable
  -- across refreshes, which is what makes a re-import an upsert and not a
  -- duplicate. Text because it is an opaque identifier, not a number we do sums on.
  imr_id      text primary key,

  reg_no      text not null,          -- as printed: '27776', 'DMC/R/24970', 'G-27776'
  -- Just the digits, unpadded. Councils prefix inconsistently and a doctor types
  -- whatever their certificate shows, so this is what lookups actually match on.
  reg_core    text not null,

  name        text not null,
  smc_id      int  not null,
  council     text not null,
  -- Nullable on purpose: the register goes back to 1921 and old rows are ragged.
  year        int,

  imported_at timestamptz not null default now()
);

comment on table imr_doctors is
  'Local copy of the Indian Medical Register, for verifying doctor registration '
  'numbers at signup. Public data (NMC Act 2019 s.31). Deliberately excludes the '
  'father''s name the register carries — it is not needed to confirm a number.';

comment on column imr_doctors.reg_core is
  'Digits only, leading zeros stripped. The register stores 08567 and a doctor '
  'will type 8567; both resolve here.';

-- Lookup by number within a council: the exact path the signup form takes.
create index if not exists imr_doctors_core_smc_idx on imr_doctors (reg_core, smc_id);

-- Name autocomplete. GIN over trigrams so a partial name anywhere in the string
-- is an index scan.
create index if not exists imr_doctors_name_trgm_idx on imr_doctors using gin (name gin_trgm_ops);

-- Progress ledger for the import, so a run that dies at council 30 of 38 resumes
-- instead of starting over. 327 pages at ~10s each is an hour of work to lose.
create table if not exists imr_sync_state (
  smc_id       int primary key,
  council      text not null,
  expected     int,                   -- what the register said it holds
  imported     int not null default 0,
  last_start   int not null default 0, -- pagination offset reached
  status       text not null default 'pending'
               check (status in ('pending','running','done','error')),
  last_error   text,
  updated_at   timestamptz not null default now()
);

comment on table imr_sync_state is
  'Per-council progress for the IMR import. Paging is per council because a '
  'global offset scan degrades badly (~5s at offset 0, ~17s at 1.5M) while '
  'within one council it stays flat, and because a failure then costs one '
  'council rather than the whole register.';

-- Both tables are ours to write and nobody else's to read. RLS on with no
-- policies: only the service role behind the import and lookup functions
-- touches them, never a browser.
alter table imr_doctors enable row level security;
alter table imr_sync_state enable row level security;

-- ── What a matched lookup leaves on the listing ────────────────────────────
-- Only what a patient benefits from. The register's version of the doctor's
-- name is NOT stored here: allow_read_active_doctors is `using (status =
-- 'active')` with no column list, and Postgres RLS is row-level, so every
-- column on this table is world-readable the moment a listing goes live.
-- Profile.tsx already selects *. The name stays in imr_doctors, where admins
-- reach it by join and patients cannot reach it at all.

alter table doctors add column if not exists smc_id int;
alter table doctors add column if not exists imr_year int;
alter table doctors add column if not exists imr_checked_at timestamptz;

alter table doctors add column if not exists imr_status text
  check (imr_status in ('unchecked','matched','confirmed','no_match','ambiguous','error'));

comment on column doctors.imr_status is
  'Outcome of matching this listing''s registration number against the register. '
  '"confirmed" means the doctor saw the matched record and said it was theirs — '
  'it is not proof of identity and must never gate activation on its own. '
  'Written by the service role only; a caller setting its own status here would '
  'be marking its own homework, the same reason create_listing forces status.';
