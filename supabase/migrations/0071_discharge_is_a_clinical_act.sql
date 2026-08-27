-- ============================================================================
-- Sehatsandhi — the front desk should not be recording a discharge diagnosis
--
-- Run AFTER 0070. Safe to re-run.
--
-- ── WHAT WAS FOUND ──────────────────────────────────────────────────────────
-- sehat_discharge_patient gated on sehat_caller_owns_business — membership of
-- the clinic, nothing more. So a receptionist could close an admission and, in
-- the same call, write:
--
--     discharge_diagnosis, discharge_summary, condition_on_discharge
--
-- Those are clinical findings. condition_on_discharge in particular is a
-- constrained clinical judgement — recovered, improved, unchanged, worse,
-- referred, deceased — and it ends up on the discharge summary the patient
-- carries to the next doctor.
--
-- Everything else that writes into the record was narrowed in 0057 and 0067:
-- prescribing, ordering drugs, charting doses, saving examination findings,
-- reading reports. Discharge was missed, and it is the one that produces a
-- document with a diagnosis on it.
--
-- Found by scripts/test-suite.mjs asserting that reception could not discharge,
-- and watching it succeed.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- sehat_caller_is_clinical, not sehat_caller_owns_business. Owner, doctor and
-- nurse; not reception, not an administrative manager. A nurse-led discharge is
-- ordinary ward work, so the wider clinical predicate is the right one here and
-- not may_prescribe — the discharge SUMMARY already requires may_prescribe,
-- which is where the prescriber's signature belongs.
--
-- Beds themselves are untouched. sehat_correct_bed_stay and the bed-move path
-- stay on ownership, because beds ARE the front desk's job — "queue, beds and
-- billing" is what reception is for. Freeing a bed is operational; saying why
-- the patient was well enough to leave is not.
--
-- Safe to make now: no clinic is live, and neither database has a discharge on
-- it. Doing this after a clinic has built a front-desk habit around it would be
-- a different conversation.
-- ============================================================================

create or replace function sehat_discharge_patient(
  p_admission_id uuid,
  p_status text default 'discharged',
  p_discharge_diagnosis text default null,
  p_discharge_summary text default null,
  p_condition text default null,
  p_follow_up date default null,
  p_practitioner_id uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
-- Body is 0050's, unchanged except for the one predicate. Everything else is
-- deliberately identical — the bed is freed by the status change rather than by
-- closing the stay here (sehat_admission_tracks_bed does that), and the
-- status_change note is what makes a discharge visible on the ward notes.
declare v_biz uuid;
begin
  select business_id into v_biz from admissions where id = p_admission_id;
  if not found then raise exception 'no such admission'; end if;

  -- 0071: was sehat_caller_owns_business, which let reception write a discharge
  -- diagnosis. A discharge closes a clinical record; it is not a desk task.
  if not sehat_caller_is_clinical(v_biz) then
    raise exception 'only clinical staff can discharge a patient'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('discharged','lama','transferred_out','deceased') then
    raise exception 'a stay ends as discharged, lama, transferred_out or deceased';
  end if;

  update admissions set
    status = p_status,
    discharged_at = coalesce(discharged_at, now()),
    discharge_diagnosis = coalesce(p_discharge_diagnosis, discharge_diagnosis),
    discharge_summary = coalesce(p_discharge_summary, discharge_summary),
    condition_on_discharge = coalesce(p_condition, condition_on_discharge),
    follow_up_date = coalesce(p_follow_up, follow_up_date),
    discharged_by = coalesce(p_practitioner_id, discharged_by),
    -- The bed is freed by the status change, not by clearing bed_id: which bed
    -- they were in is part of the record. The partial unique index only counts
    -- rows still 'admitted', so the bed is available the moment this commits.
    updated_at = now()
  where id = p_admission_id and status = 'admitted';

  if not found then raise exception 'that admission is already closed'; end if;

  insert into admission_notes (admission_id, business_id, note_type, body, recorded_by)
  values (p_admission_id, v_biz, 'status_change',
          initcap(replace(p_status, '_', ' '))
          || case when p_condition is not null then ' — ' || p_condition else '' end,
          p_practitioner_id);
end $$;

comment on function sehat_discharge_patient is
  'Clinical staff only since 0071. It gated on mere clinic membership, so the '
  'front desk could record a discharge diagnosis and a condition on discharge.';

revoke all on function sehat_discharge_patient(uuid, text, text, text, text, date, uuid) from public, anon;
grant execute on function sehat_discharge_patient(uuid, text, text, text, text, date, uuid) to authenticated;
