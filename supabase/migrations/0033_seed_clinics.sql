-- ============================================================================
-- Sehatsandhi — clinics we know exist but who have not signed up
--
-- Run AFTER 0032. Safe to re-run.
--
-- WHY
-- A directory with nothing in it helps nobody. A patient searching Yamunanagar
-- should find the clinics that are actually there, and a clinic is far easier to
-- sell to when we can show them the listing already waiting for them.
--
-- These come from the National Hospital Directory on data.gov.in, published by
-- MoHFW/NIHFW under the Government Open Data License – India, which grants a
-- royalty-free licence to adapt and publish for commercial purposes provided the
-- source is attributed. 80 records for Yamunanagar, of which all but two are
-- private. See scripts/seed-clinics-import.mjs.
--
-- SEPARATE FROM doctors ON PURPOSE
-- A row here is a claim someone else published, not a business that agreed to be
-- listed. Nobody has confirmed it, paid for it, or checked it is still open. Kept
-- apart from doctors so no query can mistake one for the other, and so a real
-- listing never has to carry a flag saying "actually, this one is made up".
--
-- WHAT THE SOURCE ACTUALLY GIVES US, measured across all 80 rows:
--   name 100%, address 96%, pincode 100%, coordinates 60%
--   phone 0%, specialities 1%, category 5%, email 3%
-- So this is a skeleton to enrich by phoning people, not a directory. Anything
-- shown to a patient must survive that: no hours, no fees, no phone we invented.
-- ============================================================================

create table if not exists seed_clinics (
  id uuid primary key default gen_random_uuid(),

  -- Where this came from, so a bad import can be undone and attribution is not
  -- a comment in a script somewhere.
  source        text not null default 'data.gov.in/nhp-hospital-directory',
  source_ref    text not null,          -- _sr_no upstream; unique within a source

  name          text not null,
  address       text,
  pincode       text,
  district      text,
  state         text,
  latitude      numeric,
  longitude     numeric,

  -- Almost always null from this source. Present because the Ayushman
  -- empanelment list does carry phone numbers for ~38 of these, and because the
  -- first thing anyone does with this table is start filling them in by calling.
  phone         text,
  category      text,

  -- The point of the table. 'unclaimed' is a clinic we have heard of;
  -- 'contacted' we have called; 'claimed' has become a real listing and should
  -- stop appearing as a seed; 'rejected' asked us not to list them, which must
  -- be remembered so a later import does not resurrect them.
  status        text not null default 'unclaimed'
                check (status in ('unclaimed','contacted','claimed','rejected')),

  -- Set when a real listing is created from this row.
  claimed_by    uuid references doctors(id) on delete set null,

  notes         text,
  imported_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (source, source_ref)
);

comment on table seed_clinics is
  'Clinics known to exist but not yet signed up, imported from open government '
  'data (currently the National Hospital Directory, GODL-India, attribution '
  'required). Not listings: unverified, unpaid, unconfirmed by the business. '
  'Deliberately a separate table so nothing can confuse a seed with a customer.';

comment on column seed_clinics.status is
  'unclaimed → heard of, never contacted. contacted → we have called them. '
  'claimed → became a real listing, see claimed_by. rejected → asked not to be '
  'listed; a re-import must honour this and never revive the row.';

create index if not exists seed_clinics_district_idx on seed_clinics (district, status);
create index if not exists seed_clinics_pincode_idx  on seed_clinics (pincode);

alter table seed_clinics enable row level security;

-- No policies. This is a sales list and a set of unverified claims about other
-- people's businesses; the anon key has no business reading it. Admin tooling
-- goes through the service role. If seeded clinics are ever shown to patients
-- that needs its own view, chosen field by field, the way
-- public_listing_doctors was — not a policy over the whole row.
