-- ============================================================================
-- Sehatsandhi — prescriptions, and the documents a patient already has on paper
--
-- Run AFTER 0045. Safe to re-run.
--
-- Two different things, deliberately not one table:
--
--   prescriptions        something WE issue. Structured data, rendered from
--                        that data, and immutable once issued.
--   patient_documents    something somebody UPLOADS. A photo of a paper
--                        prescription, a lab report, a discharge summary — an
--                        opaque file we store and hand back.
--
-- ── WHY A PRESCRIPTION IS DATA AND NOT A PDF ────────────────────────────────
-- Same reasoning invoice-send already follows: the invoice is stored as data,
-- rendered by a page, and SENT AS A LINK. No PDF library, no attachment to
-- generate, and the document renders on whatever phone opens it. Prescriptions
-- work the same way — /rx/:token — and gain something invoices do not need:
-- the link expires, because a prescription forwarded into a family WhatsApp
-- group should not still open a year later.
--
-- ── WHY IT IS IMMUTABLE ─────────────────────────────────────────────────────
-- A prescription that can be edited after a patient has taken it to a chemist
-- is not a record of anything. Corrections supersede: a new prescription citing
-- the old one, both kept. That is how invoices behave here already, and it is
-- also how prescribing works on paper — you do not amend a slip somebody has
-- already carried out of the room.
--
-- ── THE RULE 0045 SET, ENFORCED HERE ────────────────────────────────────────
-- A prescription may be built from a confirmed transcript and never from a
-- draft. source_recording_id is checked by trigger: it must point at a
-- recording whose status is 'confirmed'. Speech recognition hearing "15 mg" as
-- "50 mg" writes a wrong dose, so the machine's guess cannot be the source of a
-- dispensing instruction — only what a doctor read and signed off.
--
-- ── WHAT IS NOT MODELLED, ON PURPOSE ────────────────────────────────────────
-- No drug database, no interaction checking, no dose validation. Those need a
-- curated formulary that we do not have, and a half-built one is worse than
-- none: a system that checks some interactions teaches a prescriber to trust it
-- for all of them. drug_name is free text, entered by the doctor, exactly as a
-- paper pad works today.
--
-- Schedule H / H1 / X drugs carry their own record-keeping obligations in India
-- and nothing here tracks them. A clinic dispensing scheduled drugs still needs
-- its own register; this is a prescribing record, not a dispensing one.
-- ============================================================================


-- ============================================================================
-- 1. Numbering — one series per business, per financial year
--
-- Not one global series like invoices: an invoice comes from us, a prescription
-- comes from the clinic, and a clinic's slips should be numbered 0001 upward
-- from the day they start rather than continuing somebody else's count.
-- ============================================================================

create table if not exists prescription_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  fy text not null,
  last_number integer not null default 0,
  primary key (business_id, fy)
);

create or replace function sehat_next_prescription_number(p_business uuid, p_date date default current_date)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_fy text;
  v_n integer;
begin
  v_fy := sehat_financial_year(p_date);

  insert into prescription_counters (business_id, fy, last_number)
  values (p_business, v_fy, 0)
  on conflict (business_id, fy) do nothing;

  -- FOR UPDATE serialises concurrent issuers, so the series has no gaps and no
  -- duplicates when two consulting rooms print at the same moment.
  select last_number + 1 into v_n
    from prescription_counters
   where business_id = p_business and fy = v_fy
     for update;

  update prescription_counters set last_number = v_n
   where business_id = p_business and fy = v_fy;

  return 'RX/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;


-- ============================================================================
-- 2. The prescription
--
-- Party details are SNAPSHOTTED rather than joined, for the same reason
-- invoices snapshot theirs: the slip must still read correctly years later even
-- if the doctor changes clinic, the clinic renames itself, or the patient's
-- record is corrected. A prescription is evidence of what was said on a day.
-- ============================================================================

create table if not exists prescriptions (
  id uuid primary key default gen_random_uuid(),
  prescription_no text not null,

  business_id uuid not null references businesses(id) on delete cascade,
  -- Not nullable. A prescription is issued by a PERSON with a registration
  -- number, never by a clinic — that is what makes it a prescription rather
  -- than a note.
  practitioner_id uuid not null references practitioners(id),
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  visit_id uuid references patient_visits(id) on delete set null,

  -- Snapshots. Every one of these is what was true at issue.
  prescriber_name text not null,
  prescriber_qualification text,
  prescriber_reg_number text,
  clinic_name text,
  clinic_address text,
  clinic_phone text,
  patient_name text not null,
  patient_age integer,
  patient_gender text,
  patient_phone text,

  diagnosis text,
  advice text,
  follow_up_date date,

  -- Set when this was drafted from a recorded consultation. The trigger below
  -- refuses anything that is not a CONFIRMED transcript.
  source_recording_id uuid references consultation_recordings(id) on delete set null,

  issued_at timestamptz not null default now(),
  status text not null default 'issued' check (status in ('issued','cancelled','superseded')),
  -- A correction is a new prescription pointing back at the one it replaces.
  supersedes uuid references prescriptions(id) on delete set null,
  superseded_by uuid references prescriptions(id) on delete set null,
  cancelled_reason text,

  -- How a patient opens it without logging in. Unguessable, and it expires:
  -- a prescription is health data, and a link that never dies is a link that
  -- outlives the reason it was sent.
  public_token uuid not null default gen_random_uuid(),
  token_expires_at timestamptz not null default now() + interval '90 days',

  sent_at timestamptz,
  sent_channels text[] default '{}',
  send_error text,

  created_at timestamptz not null default now()
);

create unique index if not exists prescriptions_token_idx on prescriptions (public_token);
create unique index if not exists prescriptions_no_idx on prescriptions (business_id, prescription_no);
create index if not exists prescriptions_patient_idx
  on prescriptions (patient_member_id, issued_at desc);
create index if not exists prescriptions_business_idx
  on prescriptions (business_id, issued_at desc);

comment on table prescriptions is
  'An issued prescription. Immutable: a correction supersedes rather than '
  'edits, because a slip a patient has already carried to a chemist is not '
  'something you amend. Party details are snapshotted so it still reads '
  'correctly years later.';
comment on column prescriptions.token_expires_at is
  'Prescription links expire. Unlike an invoice, this is health data about a '
  'person, and one forwarded into a family group should not open forever.';

create table if not exists prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  sort_order integer not null default 0,

  drug_name text not null,
  strength text,                           -- '500 mg'
  form text,                               -- 'tablet', 'syrup'
  dosage text,                             -- '1-0-1'
  duration text,                           -- '5 days'
  quantity text,                           -- '10 tablets'
  instructions text,                       -- 'after food'

  created_at timestamptz not null default now()
);

create index if not exists prescription_items_rx_idx on prescription_items (prescription_id, sort_order);

comment on column prescription_items.drug_name is
  'Free text, as a paper pad is. There is no formulary here and no interaction '
  'checking — a half-built checker is worse than none, because it teaches a '
  'prescriber to trust it for the cases it does not cover.';


-- ── Immutability ───────────────────────────────────────────────────────────
-- Status may move (cancelled, superseded) and the send bookkeeping may be
-- written. Nothing clinical may change.

create or replace function sehat_prescription_is_immutable()
returns trigger language plpgsql as $$
begin
  if new.prescription_no       is distinct from old.prescription_no
  or new.business_id           is distinct from old.business_id
  or new.practitioner_id       is distinct from old.practitioner_id
  or new.patient_member_id     is distinct from old.patient_member_id
  or new.prescriber_name       is distinct from old.prescriber_name
  or new.prescriber_reg_number is distinct from old.prescriber_reg_number
  or new.patient_name          is distinct from old.patient_name
  or new.patient_age           is distinct from old.patient_age
  or new.diagnosis             is distinct from old.diagnosis
  or new.advice                is distinct from old.advice
  or new.issued_at             is distinct from old.issued_at
  then
    raise exception
      'a prescription cannot be edited once issued — issue a correction that supersedes it'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists prescriptions_immutable on prescriptions;
create trigger prescriptions_immutable before update on prescriptions
  for each row execute function sehat_prescription_is_immutable();

-- Items belong to an issued document, so they are write-once too.
create or replace function sehat_prescription_items_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'prescription items cannot be changed — supersede the prescription instead'
    using errcode = 'check_violation';
end $$;

drop trigger if exists prescription_items_frozen on prescription_items;
create trigger prescription_items_frozen before update or delete on prescription_items
  for each row execute function sehat_prescription_items_frozen();


-- ── A draft transcript may never be the source ─────────────────────────────

create or replace function sehat_rx_source_must_be_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if new.source_recording_id is null then return new; end if;

  select status into v_status from consultation_recordings where id = new.source_recording_id;

  if v_status is distinct from 'confirmed' then
    raise exception
      'a prescription may only be built from a confirmed transcript (this recording is %)',
      coalesce(v_status, 'missing')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists prescriptions_source_confirmed on prescriptions;
create trigger prescriptions_source_confirmed
  before insert or update of source_recording_id on prescriptions
  for each row execute function sehat_rx_source_must_be_confirmed();


-- ============================================================================
-- 3. Issuing one, in a single call
--
-- One RPC rather than an insert plus N item inserts, because a prescription
-- with a number but no medicines is not a half-written prescription — it is a
-- numbered gap in a series that a chemist could be shown. Either the whole
-- thing exists or none of it does.
-- ============================================================================

create or replace function sehat_issue_prescription(
  p_patient_member_id uuid,
  p_business_id uuid,
  p_practitioner_id uuid,
  p_items jsonb,                            -- [{drug_name, strength, form, dosage, duration, quantity, instructions}]
  p_visit_id uuid default null,
  p_diagnosis text default null,
  p_advice text default null,
  p_follow_up date default null,
  p_source_recording_id uuid default null,
  p_supersedes uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rx uuid;
  v_item jsonb;
  v_i integer := 0;
  v_biz record;
  v_pr record;
  v_pt record;
begin
  if not sehat_caller_owns_business(p_business_id) then
    raise exception 'not your business';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'a prescription needs at least one medicine';
  end if;

  select b.name, b.address, b.phone into v_biz from businesses b where b.id = p_business_id;
  select p.full_name, p.qualification, p.reg_number into v_pr
    from practitioners p where p.id = p_practitioner_id;
  if not found then raise exception 'no such practitioner'; end if;

  select m.full_name, m.age_years, m.gender, pa.phone into v_pt
    from patient_members m join patients pa on pa.id = m.patient_id
   where m.id = p_patient_member_id;
  if not found then raise exception 'no such patient'; end if;

  insert into prescriptions (
    prescription_no, business_id, practitioner_id, patient_member_id, visit_id,
    prescriber_name, prescriber_qualification, prescriber_reg_number,
    clinic_name, clinic_address, clinic_phone,
    patient_name, patient_age, patient_gender, patient_phone,
    diagnosis, advice, follow_up_date, source_recording_id, supersedes
  ) values (
    sehat_next_prescription_number(p_business_id), p_business_id, p_practitioner_id,
    p_patient_member_id, p_visit_id,
    v_pr.full_name, v_pr.qualification, v_pr.reg_number,
    v_biz.name, v_biz.address, v_biz.phone,
    v_pt.full_name, v_pt.age_years, v_pt.gender, v_pt.phone,
    p_diagnosis, p_advice, p_follow_up, p_source_recording_id, p_supersedes
  ) returning id into v_rx;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    continue when coalesce(btrim(v_item ->> 'drug_name'), '') = '';
    v_i := v_i + 1;
    insert into prescription_items (
      prescription_id, sort_order, drug_name, strength, form, dosage,
      duration, quantity, instructions
    ) values (
      v_rx, v_i,
      btrim(v_item ->> 'drug_name'),
      nullif(btrim(coalesce(v_item ->> 'strength', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'form', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'dosage', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'duration', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'quantity', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'instructions', '')), '')
    );
  end loop;

  if v_i = 0 then
    raise exception 'every medicine line was blank';
  end if;

  -- Mark the superseded one, both directions, so either end of the chain leads
  -- to the other.
  if p_supersedes is not null then
    update prescriptions
       set status = 'superseded', superseded_by = v_rx
     where id = p_supersedes and business_id = p_business_id;
  end if;

  -- What was prescribed is also what the patient is now on.
  insert into patient_medications (
    patient_member_id, business_id, visit_id, drug_name, strength, dosage,
    duration, instructions, recorded_by
  )
  select p_patient_member_id, p_business_id, p_visit_id,
         i.drug_name, i.strength, i.dosage, i.duration, i.instructions, p_practitioner_id
    from prescription_items i where i.prescription_id = v_rx;

  return v_rx;
end $$;

comment on function sehat_issue_prescription is
  'Issues a prescription and its items in one transaction, snapshotting the '
  'prescriber, clinic and patient as they are now. Also records the medicines '
  'as current, so the next doctor to open the chart sees what this one gave.';


-- ============================================================================
-- 4. Documents somebody uploads
--
-- A file, not data: a photo of a paper prescription, a lab report, a discharge
-- summary. Stored in a private bucket; this table is the index over it.
-- ============================================================================

create table if not exists patient_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  visit_id uuid references patient_visits(id) on delete set null,
  prescription_id uuid references prescriptions(id) on delete set null,

  kind text not null default 'other'
    check (kind in ('prescription_scan','lab_report','discharge_summary','imaging',
                    'consent_form','insurance','other')),
  title text not null,
  description text,

  -- Path inside the bucket. The first segment is the business id, which is what
  -- the storage policy below checks — so the path is the permission.
  storage_path text not null,
  mime_type text,
  size_bytes integer,

  document_date date,                      -- what the paper says, not when it was scanned
  uploaded_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists patient_documents_patient_idx
  on patient_documents (patient_member_id, created_at desc);
create index if not exists patient_documents_business_idx
  on patient_documents (business_id, created_at desc);

comment on table patient_documents is
  'The index over uploaded files. The file itself is in the private '
  'patient-documents bucket at storage_path, whose first segment is the '
  'business id — so a storage policy can answer "may you read this" without '
  'consulting this table.';

-- Private bucket. Nothing in it is served publicly; reads go through a signed
-- URL the clinic's own session asks for.
insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', false)
on conflict (id) do nothing;

-- A path's first segment is a business id. Cast defensively: a malformed path
-- must fail closed rather than raise and take the whole query with it.
create or replace function sehat_path_business(p_name text)
returns uuid language plpgsql immutable as $$
declare v uuid;
begin
  v := (storage.foldername(p_name))[1]::uuid;
  return v;
exception when others then
  return null;
end $$;

do $$
begin
  execute 'drop policy if exists "clinic reads own patient documents" on storage.objects';
  execute $p$
    create policy "clinic reads own patient documents" on storage.objects
      for select using (
        bucket_id = 'patient-documents'
        and sehat_caller_owns_business(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic writes own patient documents" on storage.objects';
  execute $p$
    create policy "clinic writes own patient documents" on storage.objects
      for insert with check (
        bucket_id = 'patient-documents'
        and sehat_caller_owns_business(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic removes own patient documents" on storage.objects';
  execute $p$
    create policy "clinic removes own patient documents" on storage.objects
      for delete using (
        bucket_id = 'patient-documents'
        and sehat_caller_owns_business(sehat_path_business(name))
      )$p$;
exception when insufficient_privilege then
  -- Managed Postgres sometimes refuses policy creation on storage.objects to
  -- anyone but the storage owner. Say so loudly rather than leaving the bucket
  -- silently unguarded.
  raise warning 'could not create storage.objects policies — create them in the Supabase dashboard before uploading anything';
end $$;


-- ============================================================================
-- 5. Reading it back
-- ============================================================================

create or replace view prescription_detail as
  select
    r.id, r.prescription_no, r.business_id, r.patient_member_id, r.visit_id,
    r.prescriber_name, r.prescriber_qualification, r.prescriber_reg_number,
    r.clinic_name, r.clinic_address, r.clinic_phone,
    r.patient_name, r.patient_age, r.patient_gender,
    r.diagnosis, r.advice, r.follow_up_date,
    r.issued_at, r.status, r.supersedes, r.superseded_by,
    r.sent_at, r.sent_channels,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'drug_name', i.drug_name, 'strength', i.strength, 'form', i.form,
        'dosage', i.dosage, 'duration', i.duration, 'quantity', i.quantity,
        'instructions', i.instructions) order by i.sort_order), '[]'::jsonb)
       from prescription_items i where i.prescription_id = r.id) as items
  from prescriptions r
 where r.business_id in (select sehat_caller_business_ids());

comment on view prescription_detail is
  'A prescription with its medicines already aggregated, for the clinic''s own '
  'screens. The patient-facing copy is served by the prescription-view edge '
  'function, which resolves a token instead.';


-- ============================================================================
-- 6. RLS
-- ============================================================================

alter table prescriptions        enable row level security;
alter table prescription_items   enable row level security;
alter table patient_documents    enable row level security;
alter table prescription_counters enable row level security;

drop policy if exists "clinic_reads_prescriptions" on prescriptions;
create policy "clinic_reads_prescriptions" on prescriptions
  for select using (sehat_caller_owns_business(business_id));

-- No insert policy: issuing goes through sehat_issue_prescription, which is
-- SECURITY DEFINER and checks ownership itself. A direct insert would bypass
-- the numbering and could produce a prescription with no items.
drop policy if exists "clinic_updates_prescriptions" on prescriptions;
create policy "clinic_updates_prescriptions" on prescriptions
  for update using (sehat_caller_owns_business(business_id))
  with check (sehat_caller_owns_business(business_id));

drop policy if exists "clinic_reads_rx_items" on prescription_items;
create policy "clinic_reads_rx_items" on prescription_items
  for select using (exists (
    select 1 from prescriptions r
     where r.id = prescription_items.prescription_id
       and sehat_caller_owns_business(r.business_id)));

drop policy if exists "clinic_reads_documents" on patient_documents;
create policy "clinic_reads_documents" on patient_documents
  for select using (sehat_caller_owns_business(business_id));

drop policy if exists "clinic_writes_documents" on patient_documents;
create policy "clinic_writes_documents" on patient_documents
  for insert with check (sehat_caller_owns_business(business_id));

drop policy if exists "clinic_removes_documents" on patient_documents;
create policy "clinic_removes_documents" on patient_documents
  for delete using (sehat_caller_owns_business(business_id));

-- Counters are internal bookkeeping. Nobody reads them directly; the numbering
-- function is SECURITY DEFINER and owns them.
drop policy if exists "admins_read_rx_counters" on prescription_counters;
create policy "admins_read_rx_counters" on prescription_counters
  for select using (sehat_is_admin());

grant select on prescription_detail to authenticated;
grant execute on function sehat_issue_prescription(uuid, uuid, uuid, jsonb, uuid, text, text, date, uuid, uuid) to authenticated;

-- Never the anon key: the website ships it, and these are prescriptions.
revoke all on function sehat_issue_prescription(uuid, uuid, uuid, jsonb, uuid, text, text, date, uuid, uuid) from anon;
revoke all on function sehat_next_prescription_number(uuid, date) from anon, authenticated;


-- ============================================================================
-- STILL NOT HERE
--   The patient-facing /rx/:token page and the two edge functions that serve
--     and send it land alongside this migration.
--   Emailing goes out as a LINK, never an attachment — same reasoning as
--     invoice-send, and it means no PDF library and no second copy of health
--     data sitting in an inbox forever.
--   No formulary, no interaction checking, no dose validation. See the header.
-- ============================================================================
