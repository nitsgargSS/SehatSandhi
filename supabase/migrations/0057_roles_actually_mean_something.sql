-- ============================================================================
-- Sehatsandhi — a role that decides something
--
-- Run AFTER 0056. Safe to re-run.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
-- business_practitioners.role has held 'owner' | 'doctor' | 'receptionist' |
-- 'manager' since 0037, and NOTHING has ever read it for access. The
-- role-checking policies that existed in 0001 belonged to clinic_users, which
-- 0037 dropped, and they were never rebuilt on affiliations.
--
-- So today every person who can log in for a business has identical access to
-- every other: the receptionist at the front desk can open any patient's
-- conditions and medications, read their prescriptions, and play back the audio
-- of their consultation. That is not a hypothetical — the recording toggle in
-- 0047 lives on the patient profile at reception, by design, which makes the
-- receptionist a real user of the screen the recordings hang off.
--
-- ── THE LINE THIS DRAWS ─────────────────────────────────────────────────────
-- Clinical (owner and doctor only): the record itself — conditions,
-- medications, visits, consultation recordings and their consent,
-- prescriptions, uploaded documents, ward notes, discharge summaries.
--
-- Everyone who can log in: identity, the queue, appointments, beds and
-- admissions, and all of billing. Reception cannot do its job without these,
-- and none of them is a clinical finding.
--
-- Two judgement calls worth stating rather than burying:
--
--   VITALS stay open. A height, weight and BP are taken at intake by whoever
--   is at the desk, and a system that refuses to let them be written there
--   just means they are not written.
--
--   ALLERGIES stay open, and are the deliberate exception to everything above.
--   'Penicillin — anaphylaxis' is a safety warning, not a diagnosis, and the
--   person booking the patient in should see it. 0047 renders them in red in
--   the header for the same reason. Hiding a warning from the front desk
--   protects nobody.
--
--   ADMISSIONS stay open even though they carry a diagnosis field, because
--   reception admits patients and runs the bed board. The deep record — notes,
--   recordings, prescriptions — is what is protected.
--
-- ── THE ROUGH EDGE ──────────────────────────────────────────────────────────
-- There is no 'nurse' in the role enum, so a clinic whose nursing staff record
-- medications or read the chart has to give them 'doctor'. That is the wrong
-- shape and worth fixing, but adding a role is a change to 0037's constraint
-- and to every screen that offers the choice; it is not smuggled in here.
-- ============================================================================


-- ============================================================================
-- 1. What the caller is, at this business
--
-- Mirrors the three routes in sehat_caller_business_ids exactly. If those ever
-- diverge, someone gets access with no role or a role with no access, so the
-- two are commented as a pair.
-- ============================================================================

create or replace function sehat_caller_role(p_business uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Routes 1 and 2 of sehat_caller_business_ids: the person who signed the
    -- listing up, by phone or by the legacy email login. They are the owner
    -- whether or not anybody made them a practitioner row.
    when exists (
      select 1 from businesses b
       where b.id = p_business
         and ((b.auth_uid is not null and b.auth_uid = auth.uid())
           or (b.email is not null and b.email <> '' and b.email = auth.jwt() ->> 'email'))
    ) then 'owner'
    -- Route 3: an affiliation that permits web login.
    else (
      select bp.role
        from business_practitioners bp
        join practitioners p on p.id = bp.practitioner_id
       where bp.business_id = p_business
         and p.auth_uid = auth.uid()
         and bp.status <> 'suspended'
         and bp.can_login_web
       -- One row per person per business is a unique constraint, so this
       -- orders a set of at most one. It is here so that if that constraint is
       -- ever relaxed, the answer is the most privileged role rather than
       -- whichever row the planner happened to return.
       order by case bp.role
                  when 'owner' then 0 when 'doctor' then 1
                  when 'manager' then 2 else 3 end
       limit 1
    )
  end;
$$;

comment on function sehat_caller_role is
  'The caller''s role at one business, or null if they have no access. Owning '
  'the listing outright counts as owner. Must be kept in step with '
  'sehat_caller_business_ids, which decides the same question for access.';


create or replace function sehat_caller_is_clinical(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sehat_caller_role(p_business) in ('owner', 'doctor'), false);
$$;

comment on function sehat_caller_is_clinical is
  'May the caller see this business''s medical records — as opposed to its '
  'queue, its beds and its money, which every signed-in member of staff needs. '
  'False for reception and for administrative managers.';


-- The other axis, and it is genuinely a different question rather than the
-- inverse of the one above. A hospital doctor should read a chart and should
-- not be changing the company's GSTIN; a manager is the exact reverse. Neither
-- is "more" trusted than the other.
create or replace function sehat_caller_is_business(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sehat_caller_role(p_business) in ('owner', 'manager'), false);
$$;

comment on function sehat_caller_is_business is
  'May the caller act on the business itself — its listing, its GSTIN and '
  'billing address, its plan, and the tax invoices Sehatsandhi raises against '
  'it. Owner and manager. Orthogonal to sehat_caller_is_clinical, not its '
  'opposite: a doctor is clinical and not business, a manager the reverse.';

grant execute on function sehat_caller_role(uuid) to authenticated;
grant execute on function sehat_caller_is_clinical(uuid) to authenticated;
grant execute on function sehat_caller_is_business(uuid) to authenticated;
revoke all on function sehat_caller_role(uuid) from anon;
revoke all on function sehat_caller_is_clinical(uuid) from anon;
revoke all on function sehat_caller_is_business(uuid) from anon;


-- ── The listing itself ──────────────────────────────────────────────────────
-- 0038 wrote businesses_update_own against sehat_caller_owns_business, which is
-- every member of staff who can log in. So reception could rewrite the
-- business's name, address, GSTIN, billing address and locked plan price.
--
-- Hiding the Clinic tab in the dashboard does not fix that — the tab is a
-- convenience, the policy is the rule, and a hidden tab is one fetch away from
-- not being hidden.
--
-- Read stays wide: everyone who works here needs to see the address and the
-- phone number. It is writing that narrows.
drop policy if exists businesses_update_own on businesses;
create policy businesses_update_own on businesses
  for update using (sehat_caller_is_business(id))
  with check (sehat_caller_is_business(id));


-- ============================================================================
-- 2. Two tables nobody could read at all
--
-- Found while auditing the policies rather than looked for. patient_visits and
-- patient_consents come from 0004, where they were built for a server-side
-- import: RLS on, no policies, and revoked from `authenticated` outright. 0047
-- then added a dozen columns to patient_visits and built the Visits pane on
-- top, and 0052 built the recording consent flow on patient_consents, and
-- neither ever granted them.
--
-- So both are dead from a browser, twice over — no table grant AND no policy.
-- The Visits pane cannot list a visit, and grantRecordingConsent cannot write
-- the consent that consultation_recordings then demands, which means recording
-- could never have started.
--
-- Granted here, and gated to clinical in the same breath, which is where they
-- would have landed if they had ever been given policies at all.
-- ============================================================================

grant select, insert, update on patient_visits   to authenticated;
-- Consent is never edited or deleted: a withdrawal is a NEWER ROW, so the log
-- stays evidence of what was true when. Insert and select, nothing else.
grant select, insert          on patient_consents to authenticated;


-- ============================================================================
-- 3. The clinical gate
-- ============================================================================

alter table patient_visits   enable row level security;
alter table patient_consents enable row level security;

-- Tables whose policies 0047 and 0050 built through format(), so the names are
-- predictable: clinic_reads_<table> and so on.
--
-- Read AND write both. A receptionist who can write a condition they cannot
-- read is not a design, it is an oversight with extra steps.
do $$
declare t text;
begin
  foreach t in array array[
    'patient_conditions', 'patient_medications',
    'consultation_recordings', 'patient_visits'
  ] loop
    execute format('drop policy if exists "clinic_reads_%1$s" on %1$I', t);
    execute format(
      'create policy "clinic_reads_%1$s" on %1$I for select using (sehat_caller_is_clinical(business_id))', t);

    execute format('drop policy if exists "clinic_writes_%1$s" on %1$I', t);
    execute format(
      'create policy "clinic_writes_%1$s" on %1$I for insert with check (sehat_caller_is_clinical(business_id))', t);

    execute format('drop policy if exists "clinic_updates_%1$s" on %1$I', t);
    execute format(
      'create policy "clinic_updates_%1$s" on %1$I for update using (sehat_caller_is_clinical(business_id)) with check (sehat_caller_is_clinical(business_id))', t);
  end loop;
end $$;

-- patient_documents is NOT in that loop, and the reason is a trap worth naming.
-- 0048 named its policies after the concept ("clinic_reads_documents") and not
-- after the table, so a loop keyed on the table name would create a second,
-- narrower policy beside the original instead of replacing it — and RLS
-- policies are PERMISSIVE, meaning access is the OR of all of them. The old one
-- would have kept letting reception straight through, and the new one would
-- have looked like a fix.
drop policy if exists "clinic_reads_documents" on patient_documents;
create policy "clinic_reads_documents" on patient_documents
  for select using (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_writes_documents" on patient_documents;
create policy "clinic_writes_documents" on patient_documents
  for insert with check (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_removes_documents" on patient_documents;
create policy "clinic_removes_documents" on patient_documents
  for delete using (sehat_caller_is_clinical(business_id));

-- Consent. 0047 gave patient_consents a business_id, so it is scoped on that
-- where set; the fallback covers rows written before it existed and the
-- marketing consents from 0004, which carry no business at all.
drop policy if exists "clinic_reads_consents" on patient_consents;
create policy "clinic_reads_consents" on patient_consents
  for select using (
    sehat_caller_is_clinical(patient_consents.business_id)
    or exists (select 1 from business_patients bp
                where bp.patient_member_id = patient_consents.patient_member_id
                  and sehat_caller_is_clinical(bp.business_id))
  );

drop policy if exists "clinic_writes_consents" on patient_consents;
create policy "clinic_writes_consents" on patient_consents
  for insert with check (
    sehat_caller_is_clinical(patient_consents.business_id)
    or exists (select 1 from business_patients bp
                where bp.patient_member_id = patient_consents.patient_member_id
                  and sehat_caller_is_clinical(bp.business_id))
  );

-- Prescriptions, their lines, ward notes and discharge summaries.
drop policy if exists "clinic_reads_prescriptions" on prescriptions;
create policy "clinic_reads_prescriptions" on prescriptions
  for select using (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_updates_prescriptions" on prescriptions;
create policy "clinic_updates_prescriptions" on prescriptions
  for update using (sehat_caller_is_clinical(business_id))
  with check (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_reads_rx_items" on prescription_items;
create policy "clinic_reads_rx_items" on prescription_items
  for select using (exists (
    select 1 from prescriptions p
     where p.id = prescription_items.prescription_id
       and sehat_caller_is_clinical(p.business_id)
  ));

drop policy if exists "clinic_reads_admission_notes" on admission_notes;
create policy "clinic_reads_admission_notes" on admission_notes
  for select using (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_writes_admission_notes" on admission_notes;
create policy "clinic_writes_admission_notes" on admission_notes
  for insert with check (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_updates_admission_notes" on admission_notes;
create policy "clinic_updates_admission_notes" on admission_notes
  for update using (sehat_caller_is_clinical(business_id))
  with check (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_reads_discharge_summaries" on discharge_summaries;
create policy "clinic_reads_discharge_summaries" on discharge_summaries
  for select using (sehat_caller_is_clinical(business_id));

drop policy if exists "clinic_updates_discharge_summaries" on discharge_summaries;
create policy "clinic_updates_discharge_summaries" on discharge_summaries
  for update using (sehat_caller_is_clinical(business_id))
  with check (sehat_caller_is_clinical(business_id));


-- ── The files themselves ────────────────────────────────────────────────────
-- Everything above guards rows. These guard the bytes, and they are the part
-- that actually matters: a scanned lab report and the AUDIO OF A CONSULTATION.
-- Both buckets were written against sehat_caller_owns_business in 0048 and
-- 0052, which is every member of staff.
--
-- Gating the tables alone would have been a paper fix. A path is not a secret —
-- it is derived from the business id and the member id, both of which reception
-- legitimately has — so anyone who could construct one could still have pulled
-- the file down.
do $$
begin
  execute 'drop policy if exists "clinic reads own patient documents" on storage.objects';
  execute $p$
    create policy "clinic reads own patient documents" on storage.objects
      for select using (
        bucket_id = 'patient-documents'
        and sehat_caller_is_clinical(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic writes own patient documents" on storage.objects';
  execute $p$
    create policy "clinic writes own patient documents" on storage.objects
      for insert with check (
        bucket_id = 'patient-documents'
        and sehat_caller_is_clinical(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic removes own patient documents" on storage.objects';
  execute $p$
    create policy "clinic removes own patient documents" on storage.objects
      for delete using (
        bucket_id = 'patient-documents'
        and sehat_caller_is_clinical(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic reads own consultation audio" on storage.objects';
  execute $p$
    create policy "clinic reads own consultation audio" on storage.objects
      for select using (
        bucket_id = 'consultation-audio'
        and sehat_caller_is_clinical(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic writes own consultation audio" on storage.objects';
  execute $p$
    create policy "clinic writes own consultation audio" on storage.objects
      for insert with check (
        bucket_id = 'consultation-audio'
        and sehat_caller_is_clinical(sehat_path_business(name))
      )$p$;

  execute 'drop policy if exists "clinic removes own consultation audio" on storage.objects';
  execute $p$
    create policy "clinic removes own consultation audio" on storage.objects
      for delete using (
        bucket_id = 'consultation-audio'
        and sehat_caller_is_clinical(sehat_path_business(name))
      )$p$;
exception when insufficient_privilege then
  -- Managed Postgres sometimes refuses policy changes on storage.objects to
  -- anyone but the storage owner. This fails CLOSED — if the DROP went through
  -- and the CREATE did not, the bucket has no policy and nobody can read it,
  -- which breaks uploads and playback rather than exposing them. Still needs
  -- fixing by hand, so say so loudly.
  raise warning 'could not update storage.objects policies — apply them in the Supabase dashboard. Until then BOTH BUCKETS MAY HAVE NO READ POLICY, and documents and audio will not open.';
end $$;


-- ============================================================================
-- 4. The RPCs that MAKE clinical records
--
-- sehat_issue_prescription and sehat_issue_discharge_summary are security
-- definer, so RLS does not apply inside them and the policies above would not
-- stop reception issuing a prescription.
--
-- Guarded with triggers rather than by rewriting both functions. A trigger
-- fires on every path into the table — the RPC, a future RPC, a hand-written
-- insert — where a check copied into a function body only guards that copy,
-- and is the kind of thing that gets missed when the function is next
-- replaced. 0055 and 0056 both replaced functions defined in earlier files.
-- ============================================================================

create or replace function sehat_only_clinicians_issue()
returns trigger language plpgsql as $$
begin
  -- auth.uid() is null under the service role, which is the trusted server
  -- context the edge functions and the bot run in. They are not a signed-in
  -- receptionist and are not what this guards against.
  if auth.uid() is null then return new; end if;

  if not sehat_caller_is_clinical(new.business_id) then
    raise exception
      'only a doctor can issue this — your account is registered as %',
      coalesce(sehat_caller_role(new.business_id), 'having no access here')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists prescriptions_clinician_only on prescriptions;
create trigger prescriptions_clinician_only before insert on prescriptions
  for each row execute function sehat_only_clinicians_issue();

drop trigger if exists discharge_summaries_clinician_only on discharge_summaries;
create trigger discharge_summaries_clinician_only before insert on discharge_summaries
  for each row execute function sehat_only_clinicians_issue();


-- ============================================================================
-- 5. The view that went around the back
--
-- patient_summary is granted to every signed-in user and reads conditions and
-- allergies through subqueries — which run as the view's owner, so the table
-- policies above do not touch them. Without this the whole of section 3 is
-- decorative for anyone who knows the view exists.
--
-- Allergies stay, for the reason in the header. Conditions do not.
-- ============================================================================

create or replace view patient_summary as
  select
    m.id as patient_member_id,
    bp.business_id,
    m.full_name, m.relation, m.gender, m.age_years, m.date_of_birth,
    m.blood_group, m.abha_number,
    p.phone, p.lang, p.pin_code, p.area,
    bp.mrn, bp.source, bp.first_seen_at, bp.last_seen_at, bp.visit_count,
    (select count(*) from patient_visits v
      where v.patient_member_id = m.id and v.business_id = bp.business_id) as visits_here,
    -- A safety warning, shown to whoever is dealing with the patient.
    (select array_agg(a.substance order by a.severity desc nulls last)
       from patient_allergies a
      where a.patient_member_id = m.id and a.business_id = bp.business_id and a.is_active) as allergies,
    -- A diagnosis. Null for reception rather than absent, so the column keeps
    -- its shape and every caller keeps working.
    case when sehat_caller_is_clinical(bp.business_id) then
      (select array_agg(c.condition order by c.created_at)
         from patient_conditions c
        where c.patient_member_id = m.id and c.business_id = bp.business_id and c.status = 'active')
    end as conditions,
    case when sehat_caller_is_clinical(bp.business_id) then
      (select max(v.follow_up_due) from patient_visits v
        where v.patient_member_id = m.id and v.business_id = bp.business_id
          and v.follow_up_due >= current_date)
    end as next_follow_up,
    sehat_has_consent(m.id, 'recording', bp.business_id) as recording_consent
  from business_patients bp
  join patient_members m on m.id = bp.patient_member_id
  join patients p on p.id = m.patient_id
 where bp.business_id in (select sehat_caller_business_ids());

comment on view patient_summary is
  'The header a clinic sees above a patient. Allergies are visible to all staff '
  'because they are a safety warning; conditions and follow-ups are null for '
  'anyone who is not clinical, because the subqueries here run as the view''s '
  'owner and would otherwise walk straight past the table policies.';

grant select on patient_summary to authenticated;


-- ============================================================================
-- NOT HERE
--   A 'nurse' role — see the header. It changes 0037's check constraint and
--     every screen that offers the choice.
--   Per-doctor scoping ("my patients only"). Doctors in one clinic cover for
--     each other constantly and a record that vanishes on a day off is a
--     record nobody trusts. The business is the boundary.
--   Field-level redaction on prescriptions for reception. They either handle
--     the document or they do not; a half-readable prescription is worse than
--     a refusal, because it looks complete.
-- ============================================================================
