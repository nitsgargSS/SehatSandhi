-- ============================================================================
-- Sehatsandhi — one login may own several listings
--
-- Run AFTER 0023. Safe to re-run.
--
-- 0023 put a unique index on doctors.auth_uid, which forbids the same person
-- owning two listings. That is wrong for the actual business: a doctor who also
-- runs a pharmacy, an owner with a clinic and an ambulance service, or anyone
-- registering a second branch as its own listing would all use the same
-- WhatsApp number — and the second signup could never be logged into.
--
-- sehat_caller_listing_ids() already returns a SET, so the rest of the design
-- assumed several all along; only the index disagreed.
--
-- A plain index is still wanted: every RLS check on a doctor-facing table
-- resolves through that function, which looks listings up by auth_uid.
-- ============================================================================

drop index if exists doctors_auth_uid_key;

create index if not exists doctors_auth_uid_idx
  on doctors (auth_uid) where auth_uid is not null;

comment on column doctors.auth_uid is
  'The Supabase Auth user that owns this listing, linked on first phone login. '
  'NOT unique: one number may own a clinic and a pharmacy, and both must be '
  'reachable from the same login. Null until they first sign in.';
