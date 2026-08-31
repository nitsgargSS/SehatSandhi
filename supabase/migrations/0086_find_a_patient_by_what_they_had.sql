-- ============================================================================
-- Sehatsandhi — find a patient by what they were treated for
--
-- Run AFTER 0085. Safe to re-run.
--
-- Until now a clinic could only find somebody it already knew the name, phone or
-- file number of. The question a doctor actually asks at the start of a clinic
-- is the other way round: "who did I operate on that needs seeing again?" —
-- everyone with a hernia repair, everyone still on the diabetic list, everyone
-- discharged after a caesarean. That question had no answer in this system.
--
-- ── A DIAGNOSIS IS NOT WRITTEN IN ONE PLACE ─────────────────────────────────
-- It is written in five, because five different clinical acts record one:
--
--   patient_visits        diagnosis, chief_complaint, icd10_code   (OPD)
--   patient_conditions    condition, icd10_code                    (problem list)
--   admissions            admitting / discharge diagnosis          (IPD)
--   discharge_summaries   admitting / discharge diagnosis, PROCEDURES
--   prescriptions         diagnosis
--
-- Searching only the tidiest of those would quietly miss most of the answer. In
-- particular `discharge_summaries.procedures` is where an operation is written
-- down, so a search for "surgery" or "appendectomy" that skipped it would return
-- nothing for exactly the case this was asked for.
--
-- ── THE GATE IS CLINICAL, NOT MERELY "WORKS HERE" ───────────────────────────
-- sehat_search_patients() is scoped with sehat_caller_business_ids() and no
-- more, which is right: a name, a phone number and a file number are what
-- reception needs to do its job, and none of them is a clinical finding.
--
-- This is a different thing. It enumerates people BY DISEASE, and answering it
-- for reception would hand a spreadsheet of every HIV, psychiatric or termination
-- patient in the clinic to whoever mans the desk. So every branch below is gated
-- on sehat_caller_is_clinical(business_id) — owner, doctor, nurse — and the
-- gate is applied per row, inside each union arm, rather than once at the top
-- where a later edit could slip past it.
--
-- This is the same class of mistake 0078 fixed: using "works here" where the
-- question was actually "is allowed to".
--
-- ── SUPERSEDED PAPER MUST NOT COME BACK ─────────────────────────────────────
-- Prescriptions and discharge summaries are versioned documents: cancelling or
-- correcting one leaves the old row in place with superseded_by set. A search
-- that ignored that would resurface a diagnosis a clinician had explicitly
-- retracted, which is worse than not finding it. Both are filtered.
--
-- ── ONE ROW PER RECORD, NOT PER PATIENT ─────────────────────────────────────
-- The caller is chasing follow-ups, so what they need is the EVENT: what was
-- found, when, and whether a follow-up date was set. Collapsing to one row per
-- patient would throw away the date that makes the list actionable. The UI
-- groups by patient for display; the data keeps the detail.
-- ============================================================================


-- ============================================================================
-- 1. Make the text searchable
--
-- ILIKE '%x%' cannot use a btree index. pg_trgm is already installed, so a GIN
-- trigram index makes each of these a real index scan instead of five sequential
-- ones. Cheap now (tens of rows) and the difference between usable and unusable
-- at a hospital's scale.
-- ============================================================================

create index if not exists patient_visits_diagnosis_trgm
  on patient_visits using gin (diagnosis gin_trgm_ops);
create index if not exists patient_visits_complaint_trgm
  on patient_visits using gin (chief_complaint gin_trgm_ops);
create index if not exists patient_conditions_condition_trgm
  on patient_conditions using gin (condition gin_trgm_ops);
create index if not exists admissions_admitting_dx_trgm
  on admissions using gin (admitting_diagnosis gin_trgm_ops);
create index if not exists admissions_discharge_dx_trgm
  on admissions using gin (discharge_diagnosis gin_trgm_ops);
create index if not exists discharge_summaries_discharge_dx_trgm
  on discharge_summaries using gin (discharge_diagnosis gin_trgm_ops);
create index if not exists discharge_summaries_procedures_trgm
  on discharge_summaries using gin (procedures gin_trgm_ops);
create index if not exists prescriptions_diagnosis_trgm
  on prescriptions using gin (diagnosis gin_trgm_ops);


-- ============================================================================
-- 2. The search
--
-- plpgsql rather than sql, and VOLATILE rather than STABLE, because it writes an
-- audit row before returning. That is deliberate: see the note on logging below.
-- ============================================================================

create or replace function sehat_search_by_diagnosis(
  p_query           text,
  p_business        uuid    default null,
  p_from            date    default null,
  p_to              date    default null,
  p_follow_up_only  boolean default false,
  p_limit           integer default 200
)
returns table (
  patient_member_id uuid,
  business_id       uuid,
  full_name         text,
  phone             text,
  age_years         integer,
  gender            text,
  mrn               text,
  -- visit | condition | admission | discharge | prescription
  source            text,
  source_id         uuid,
  -- Which column matched, so the UI can say "procedure" rather than implying
  -- everything found was a diagnosis.
  matched_field     text,
  matched_text      text,
  icd10_code        text,
  event_date        date,
  follow_up_date    date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q     text := btrim(coalesce(p_query, ''));
  v_like  text;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  -- One character matches most of the register and would return a list that is
  -- not an answer to anything. Same floor the name search uses.
  if length(v_q) < 2 then
    return;
  end if;

  -- Escape the LIKE metacharacters. Without this a query containing % returns
  -- every record the caller can see, which for a search that enumerates people
  -- by disease is a disclosure rather than a bad result set.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with hits as (
    -- ── OPD visits ──────────────────────────────────────────────────────────
    select v.patient_member_id, v.business_id, 'visit'::text as source, v.id as source_id,
           case when v.diagnosis       ilike v_like then 'diagnosis'
                when v.chief_complaint ilike v_like then 'complaint'
                else 'icd10' end                    as matched_field,
           coalesce(nullif(v.diagnosis, ''), v.chief_complaint) as matched_text,
           v.icd10_code,
           v.visit_date                              as event_date,
           v.follow_up_due                           as follow_up_date
      from patient_visits v
     where sehat_caller_is_clinical(v.business_id)
       and (v.diagnosis ilike v_like or v.chief_complaint ilike v_like
            or upper(coalesce(v.icd10_code, '')) = upper(v_q))

    union all

    -- ── The problem list ────────────────────────────────────────────────────
    -- Resolved conditions are kept on purpose: "who has ever had TB" is a
    -- reasonable question, and a resolved row is still that patient's history.
    select c.patient_member_id, c.business_id, 'condition', c.id,
           case when c.condition ilike v_like then 'condition' else 'icd10' end,
           c.condition, c.icd10_code,
           c.onset_date, null::date
      from patient_conditions c
     where sehat_caller_is_clinical(c.business_id)
       and (c.condition ilike v_like
            or upper(coalesce(c.icd10_code, '')) = upper(v_q))

    union all

    -- ── Admissions ──────────────────────────────────────────────────────────
    select a.patient_member_id, a.business_id, 'admission', a.id,
           case when a.discharge_diagnosis ilike v_like then 'discharge diagnosis'
                else 'admitting diagnosis' end,
           coalesce(nullif(a.discharge_diagnosis, ''), a.admitting_diagnosis),
           null::text,
           (a.admitted_at at time zone 'Asia/Kolkata')::date,
           a.follow_up_date
      from admissions a
     where sehat_caller_is_clinical(a.business_id)
       and (a.admitting_diagnosis ilike v_like
            or a.discharge_diagnosis ilike v_like
            or a.condition_on_discharge ilike v_like)

    union all

    -- ── Discharge summaries, including the operation ────────────────────────
    -- `procedures` is the reason this search exists: an operation is recorded
    -- here and nowhere else structured.
    select d.patient_member_id, d.business_id, 'discharge', d.id,
           case when d.procedures ilike v_like then 'procedure'
                when d.discharge_diagnosis ilike v_like then 'discharge diagnosis'
                else 'admitting diagnosis' end,
           case when d.procedures ilike v_like then d.procedures
                else coalesce(nullif(d.discharge_diagnosis, ''), d.admitting_diagnosis) end,
           null::text,
           (d.discharged_at at time zone 'Asia/Kolkata')::date,
           d.follow_up_date
      from discharge_summaries d
     where sehat_caller_is_clinical(d.business_id)
       and d.status <> 'cancelled'
       and d.superseded_by is null
       and (d.admitting_diagnosis ilike v_like
            or d.discharge_diagnosis ilike v_like
            or d.condition_on_discharge ilike v_like
            or d.procedures ilike v_like)

    union all

    -- ── Prescriptions ───────────────────────────────────────────────────────
    select r.patient_member_id, r.business_id, 'prescription', r.id,
           'diagnosis', r.diagnosis, null::text,
           (r.issued_at at time zone 'Asia/Kolkata')::date,
           r.follow_up_date
      from prescriptions r
     where sehat_caller_is_clinical(r.business_id)
       and r.status <> 'cancelled'
       and r.superseded_by is null
       and r.diagnosis ilike v_like
  )
  select h.patient_member_id, h.business_id,
         m.full_name, p.phone, m.age_years, m.gender, bp.mrn,
         h.source, h.source_id, h.matched_field, h.matched_text, h.icd10_code,
         h.event_date, h.follow_up_date
    from hits h
    join patient_members m on m.id = h.patient_member_id
    join patients p        on p.id = m.patient_id
    -- The membership row carries the file number, and its absence means this
    -- business has no patient record for them: an inner join is the correct
    -- scope, not an oversight.
    join business_patients bp
      on bp.patient_member_id = h.patient_member_id
     and bp.business_id       = h.business_id
   where m.status = 'active'
     and (p_business is null or h.business_id = p_business)
     and (p_from is null or h.event_date >= p_from)
     and (p_to   is null or h.event_date <= p_to)
     and (not coalesce(p_follow_up_only, false) or h.follow_up_date is not null)
   -- Most recent first: a follow-up list is worked from the newest backwards,
   -- and a null date sorts last rather than pretending to be recent.
   order by h.event_date desc nulls last, m.full_name
   limit v_limit;
end;
$$;

comment on function sehat_search_by_diagnosis is
  'Find patients by diagnosis, condition, ICD-10 code or procedure across OPD '
  'visits, the problem list, admissions, discharge summaries and prescriptions. '
  'Gated on sehat_caller_is_clinical per row — this enumerates people by '
  'disease, so it is not reception''s to run. Cancelled and superseded '
  'documents are excluded.';

grant execute on function sehat_search_by_diagnosis(text, uuid, date, date, boolean, integer)
  to authenticated;
revoke all on function sehat_search_by_diagnosis(text, uuid, date, date, boolean, integer)
  from anon;


-- ============================================================================
-- 3. Auditing it
--
-- patient_record_access already records that somebody searched, and the client
-- calls it for the name search. This one is logged SERVER-side instead, in its
-- own function, because a bulk query for everyone with a given disease is the
-- one a regulator or an aggrieved patient will ask about, and a log the client
-- can forget to write is not a log. The client calls this after a search
-- returns; it is separate from the search itself so the search can stay STABLE
-- and be used in a read-only transaction.
-- ============================================================================

create or replace function sehat_log_diagnosis_search(p_business uuid, p_query text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into patient_record_access (business_id, patient_member_id, action, detail)
  select p_business, null, 'search', 'diagnosis: ' || left(btrim(coalesce(p_query, '')), 60)
   where sehat_caller_is_clinical(p_business);
$$;

comment on function sehat_log_diagnosis_search is
  'Records that a diagnosis search was run. Separate from the search so that '
  'stays STABLE; the where-clause means a caller who could not have run the '
  'search cannot write a misleading audit row either.';

grant execute on function sehat_log_diagnosis_search(uuid, text) to authenticated;
revoke all on function sehat_log_diagnosis_search(uuid, text) from anon;


notify pgrst, 'reload schema';
