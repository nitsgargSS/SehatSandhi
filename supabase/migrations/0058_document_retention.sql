-- ============================================================================
-- Sehatsandhi — how long an uploaded document is kept
--
-- Run AFTER 0057. Safe to re-run.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
-- patient_documents is the only store in this system that grows without bound.
-- Consultation audio is deleted the moment it is transcribed; prescriptions,
-- bills and summaries are rows. A scanned lab report is a megabyte that nothing
-- ever removed.
--
-- That is a cost problem second and a compliance problem first. The DPDP Act's
-- storage-limitation principle is that personal data is kept while it serves
-- the purpose it was collected for and not indefinitely — so "keep everything
-- forever" was never the safe default it looks like. Having a defensible policy
-- is better than having none, in both directions.
--
-- ── THE NUMBER IS A PLACEHOLDER UNTIL A LAWYER CONFIRMS IT ──────────────────
-- Default here is 10 years. What I can point at: the Indian Medical Council's
-- conduct regulations require indoor-patient records to be kept for 3 years
-- from the start of treatment, and ordinary civil limitation runs to 3 years,
-- with consumer complaints admissible within 2 years of the cause of action.
-- 10 years clears all of those comfortably and matches what many Indian
-- hospitals adopt for medico-legal safety.
--
-- It is NOT legal advice and I am not able to give any. It is a conservative
-- default chosen so the system is never the reason a record was destroyed too
-- early. Confirm it, then change one row — that is why it is configuration and
-- not a constant in a function body.
--
-- ── WHAT PURGING DOES, AND DOES NOT DO ──────────────────────────────────────
-- It deletes the FILE. The row stays, as a tombstone: kind, title, date and who
-- uploaded it, with purged_at set and storage_path cleared. A medical record
-- where documents silently vanish is indistinguishable from one that has been
-- tampered with, and a clinic asked "where is the July scan" must be able to
-- answer "held to policy, destroyed on this date" rather than shrug.
-- ============================================================================


-- ============================================================================
-- 1. The policy
-- ============================================================================

create table if not exists document_retention_policies (
  business_id uuid not null references businesses(id) on delete cascade,
  -- null = the business's default, applied to any kind without its own row.
  kind text,
  retain_years integer not null check (retain_years between 1 and 99),
  note text,
  updated_at timestamptz not null default now(),
  primary key (business_id, kind)
);

-- Postgres treats NULLs as distinct in a primary key, so the default row would
-- be insertable twice over. One default per business, enforced.
create unique index if not exists document_retention_default_once
  on document_retention_policies (business_id) where kind is null;

comment on table document_retention_policies is
  'How long each kind of uploaded document is kept, per clinic. A row with a '
  'null kind is that clinic''s default. Absent entirely, sehat_retention_years '
  'falls back to the system default.';

-- The fallback when a business has said nothing. Its own function so there is
-- exactly one place to change it, and so the value is greppable.
create or replace function sehat_default_retention_years()
returns integer language sql immutable as $$ select 10 $$;

comment on function sehat_default_retention_years is
  'System-wide fallback retention in years. See 0058''s header: chosen to clear '
  'the IMC 3-year floor and ordinary limitation periods with margin. Confirm '
  'with counsel before treating it as settled.';

create or replace function sehat_retention_years(p_business uuid, p_kind text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    -- Most specific first: this kind at this business.
    (select retain_years from document_retention_policies
      where business_id = p_business and kind = p_kind),
    -- Then the business's own default.
    (select retain_years from document_retention_policies
      where business_id = p_business and kind is null),
    sehat_default_retention_years()
  );
$$;


-- ============================================================================
-- 2. What it does to a document
-- ============================================================================

alter table patient_documents add column if not exists retain_until date;
alter table patient_documents add column if not exists legal_hold boolean not null default false;
alter table patient_documents add column if not exists legal_hold_reason text;
alter table patient_documents add column if not exists purged_at timestamptz;

comment on column patient_documents.retain_until is
  'Stamped at upload from the policy then, not computed on read — so a clinic '
  'can see when a document is due to go, and shortening the policy later cannot '
  'silently bring forward the destruction of something already held. '
  'sehat_reapply_retention re-stamps deliberately.';
comment on column patient_documents.legal_hold is
  'Blocks the sweeper outright. A document that is evidence in a complaint, a '
  'medico-legal case or an insurance dispute must outlive its retention date, '
  'and that decision is a human one.';
comment on column patient_documents.purged_at is
  'The file is gone; this row is the tombstone. Kept so a clinic can say '
  '"destroyed to policy on this date" instead of having no answer.';

create index if not exists patient_documents_retain_idx
  on patient_documents (retain_until)
  where purged_at is null and not legal_hold;

-- Dated from document_date where the paper says when it is from, because a
-- scan made this week of a report from 2019 is a 2019 record. Falls back to
-- upload time when it says nothing.
create or replace function sehat_stamp_document_retention()
returns trigger language plpgsql as $$
begin
  if new.retain_until is null then
    new.retain_until :=
      coalesce(new.document_date, current_date)
      + make_interval(years => sehat_retention_years(new.business_id, new.kind));
  end if;
  return new;
end $$;

drop trigger if exists patient_documents_stamp_retention on patient_documents;
create trigger patient_documents_stamp_retention
  before insert on patient_documents
  for each row execute function sehat_stamp_document_retention();

-- Re-stamp existing documents after a policy change. Deliberate rather than
-- automatic: lengthening retention is safe, shortening it destroys things
-- earlier than whoever uploaded them expected, and neither should happen as a
-- side effect of editing a settings row.
create or replace function sehat_reapply_retention(p_business uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not sehat_caller_is_business(p_business) then
    raise exception 'only an owner or manager can change retention';
  end if;

  update patient_documents d
     set retain_until = coalesce(d.document_date, d.created_at::date)
                        + make_interval(years => sehat_retention_years(d.business_id, d.kind))
   where d.business_id = p_business
     and d.purged_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;


-- ============================================================================
-- 3. What the sweeper picks up
-- ============================================================================

create or replace view patient_documents_to_purge as
  select d.id, d.business_id, d.storage_path, d.kind, d.title, d.retain_until
    from patient_documents d
   where d.storage_path is not null
     and d.purged_at is null
     and not d.legal_hold
     and d.retain_until is not null
     and d.retain_until < current_date;

comment on view patient_documents_to_purge is
  'Documents whose retention has run out and which are not under legal hold. '
  'Read by the purge-documents function, which deletes the objects — SQL cannot '
  'delete a storage object — and calls sehat_mark_document_purged for each.';

create or replace function sehat_mark_document_purged(p_document_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update patient_documents
     set purged_at = now(),
         -- Cleared for the same reason audio_path is: a path that no longer
         -- resolves reads as though the file is still there.
         storage_path = null
   where id = p_document_id;
end $$;

-- Putting a document beyond the sweeper's reach, and taking it back.
create or replace function sehat_set_legal_hold(
  p_document_id uuid, p_hold boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from patient_documents where id = p_document_id;
  if not found then raise exception 'no such document'; end if;
  if not sehat_caller_owns_business(v_biz) then raise exception 'not your business'; end if;
  if p_hold and coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why this document is being held';
  end if;

  update patient_documents
     set legal_hold = p_hold,
         legal_hold_reason = case when p_hold then p_reason else null end
   where id = p_document_id;
end $$;


-- ============================================================================
-- 4. RLS
-- ============================================================================

alter table document_retention_policies enable row level security;

drop policy if exists "clinic_reads_retention" on document_retention_policies;
create policy "clinic_reads_retention" on document_retention_policies
  for select using (sehat_caller_owns_business(business_id));

-- Owner and manager only. How long a clinic keeps medical records is a business
-- and legal decision, not a clinical one — the same line 0057 draws.
drop policy if exists "business_writes_retention" on document_retention_policies;
create policy "business_writes_retention" on document_retention_policies
  for all using (sehat_caller_is_business(business_id))
  with check (sehat_caller_is_business(business_id));

grant select on patient_documents_to_purge to authenticated;
grant execute on function sehat_retention_years(uuid, text) to authenticated;
grant execute on function sehat_reapply_retention(uuid) to authenticated;
grant execute on function sehat_set_legal_hold(uuid, boolean, text) to authenticated;

revoke all on function sehat_mark_document_purged(uuid) from anon, authenticated;
revoke all on function sehat_reapply_retention(uuid) from anon;
revoke all on function sehat_set_legal_hold(uuid, boolean, text) from anon;


-- ============================================================================
-- NOT HERE
--   Minors. Records for a child are commonly kept until some years past
--     majority, which is a rule about the PATIENT's age and not the document's
--     age, and it needs date_of_birth to be reliably present before it can be
--     enforced rather than guessed.
--   Automatic legal hold from a complaint workflow — there is no complaints
--     model yet, so the hold is set by hand.
--   Deleting tombstone rows. They are ~400 bytes and they are the evidence
--     that a destruction was policy rather than an accident.
-- ============================================================================
