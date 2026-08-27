-- ============================================================================
-- Sehatsandhi — correcting a bed stay that was recorded wrongly
--
-- Run AFTER 0061. Safe to re-run.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
-- 0053 made a stay a series of periods, written by trigger when the bed on an
-- admission changes. admission_bed_stays got exactly one policy — SELECT — so
-- nothing but a trigger can ever write one.
--
-- That is right for the happy path and useless the moment a ward clerk records
-- a move at the wrong time, or into the wrong bed. There was no way to fix it:
-- the only route back was to discharge and re-admit, which invents a second
-- admission for a patient who never left, and takes the discharge summary and
-- the bill with it.
--
-- Found because an UPDATE against this table did nothing and reported success —
-- RLS filtered every row and returned 0 rows affected. Same silent shape as
-- everything else that has bitten this project.
--
-- ── WHY NOT JUST ADD AN UPDATE POLICY ───────────────────────────────────────
-- Because a bed stay is money. Its from_at and to_at multiply by a rate into a
-- charge, so a free-text UPDATE is a free-text edit of a bill. Worse, it can
-- break invariants the rest of the system relies on: two open periods at once,
-- periods that overlap, a period that starts before the patient was admitted.
--
-- So corrections go through a function that validates, in the same way issuing
-- a bill goes through a function rather than an INSERT.
--
-- ── THE RULE THAT MATTERS ───────────────────────────────────────────────────
-- A stay whose charges are already on an ISSUED bill cannot be corrected. That
-- is the same line 0056 draws for patient_charges and for re-posting bed
-- charges: once a document has been handed to a patient or an insurer, the way
-- to change it is to cancel that document, not to edit what it was built from.
-- ============================================================================


-- ============================================================================
-- 1. An edit leaves a mark
-- ============================================================================

alter table admission_bed_stays add column if not exists corrected_at timestamptz;
alter table admission_bed_stays add column if not exists corrected_by uuid references practitioners(id) on delete set null;
alter table admission_bed_stays add column if not exists correction_reason text;

comment on column admission_bed_stays.correction_reason is
  'Why this period was edited after the fact. Required: a bed stay drives a '
  'charge, and an unexplained change to one is what an audit stops on.';


-- ============================================================================
-- 2. Is this stay still ours to change?
-- ============================================================================

create or replace function sehat_bed_stay_is_billed(p_admission_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select b.bill_no
    from patient_charges c
    join patient_bills b on b.id = c.bill_id and b.status = 'issued'
   where c.admission_id = p_admission_id and c.category = 'bed'
   limit 1;
$$;

comment on function sehat_bed_stay_is_billed is
  'The bill number holding this stay''s bed charges, or null if none does. '
  'Null means the periods are still safe to correct.';


-- ============================================================================
-- 3. Correcting one period
--
-- Times, or the bed, or both. Everything else about the row is derived.
-- ============================================================================

create or replace function sehat_correct_bed_stay(
  p_stay_id uuid,
  p_reason text,
  p_from_at timestamptz default null,
  p_to_at timestamptz default null,
  p_bed_id uuid default null,
  p_corrected_by uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  a record;
  v_from timestamptz;
  v_to timestamptz;
  v_billed text;
  -- Scalars, not a record. A RECORD that is never assigned raises the moment a
  -- field of it is read, and this one is only populated when the caller is
  -- changing the bed — so on every time-only correction the UPDATE below would
  -- have thrown. Exactly the trap 0056 hit with its admission record; I wrote
  -- it again here.
  v_bed_ward text;
  v_bed_label text;
  v_bed_rate numeric(12,2);
begin
  select * into s from admission_bed_stays where id = p_stay_id;
  if not found then raise exception 'no such bed stay'; end if;
  if not sehat_caller_owns_business(s.business_id) then raise exception 'not your business'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why this bed stay is being corrected';
  end if;

  v_billed := sehat_bed_stay_is_billed(s.admission_id);
  if v_billed is not null then
    raise exception
      'this stay''s bed charges are on bill % — cancel that bill before correcting the record',
      v_billed using errcode = 'check_violation';
  end if;

  select * into a from admissions where id = s.admission_id;

  -- Null means "leave it": a caller fixing only the time must not have to
  -- restate the bed, and restating it is how you change it by accident.
  v_from := coalesce(p_from_at, s.from_at);
  v_to   := coalesce(p_to_at, s.to_at);

  -- ── The invariants, checked here because nothing else will ──
  if v_to is not null and v_to <= v_from then
    raise exception 'a bed stay has to end after it starts';
  end if;
  if v_from < a.admitted_at then
    raise exception 'a bed stay cannot begin before the patient was admitted';
  end if;
  if a.discharged_at is not null and v_to is not null and v_to > a.discharged_at then
    raise exception 'a bed stay cannot end after the patient was discharged';
  end if;

  -- Overlap with any OTHER period of the same admission. Two beds at once is
  -- not a state a patient can be in, and it would bill them for both.
  if exists (
    select 1 from admission_bed_stays o
     where o.admission_id = s.admission_id
       and o.id <> s.id
       and v_from < coalesce(o.to_at, 'infinity'::timestamptz)
       and coalesce(v_to, 'infinity'::timestamptz) > o.from_at
  ) then
    raise exception 'that would overlap another bed on this stay';
  end if;

  if p_bed_id is not null then
    select w.name, b.label, b.daily_charge
      into v_bed_ward, v_bed_label, v_bed_rate
      from beds b left join wards w on w.id = b.ward_id
     where b.id = p_bed_id and b.business_id = s.business_id;
    if not found then raise exception 'no such bed at this business'; end if;
  end if;

  update admission_bed_stays
     set from_at = v_from,
         to_at   = v_to,
         bed_id  = coalesce(p_bed_id, bed_id),
         -- Re-snapshotted with the bed, not left behind. The snapshot exists so
         -- history is not re-priced by a later rate change; correcting WHICH
         -- bed someone was in is a different thing, and the rate has to follow.
         ward_name             = coalesce(v_bed_ward, ward_name),
         bed_label             = coalesce(v_bed_label, bed_label),
         daily_charge_snapshot = coalesce(v_bed_rate, daily_charge_snapshot),
         corrected_at = now(),
         corrected_by = p_corrected_by,
         correction_reason = p_reason
   where id = p_stay_id;

  -- The charges are now wrong by definition — that is what was being corrected.
  -- Safe to re-post because the guard above proved nothing is billed.
  perform sehat_post_bed_charges(s.admission_id);
end $$;

comment on function sehat_correct_bed_stay is
  'Fix a bed stay recorded wrongly: its times, its bed, or both. Validates '
  'against the admission and the other periods, re-snapshots the rate if the '
  'bed changes, and re-posts the bed charges. Refuses once the stay is on an '
  'issued bill.';


-- ============================================================================
-- 4. Undoing a move that never happened
--
-- The other half, and not expressible as an edit: somebody recorded a transfer
-- by mistake and the patient never left the first bed. Deleting the second
-- period alone would leave the stay with no open bed at all, so the previous
-- one has to be reopened in the same breath.
-- ============================================================================

create or replace function sehat_undo_bed_move(
  p_stay_id uuid, p_reason text, p_corrected_by uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  prev record;
  v_billed text;
begin
  select * into s from admission_bed_stays where id = p_stay_id;
  if not found then raise exception 'no such bed stay'; end if;
  if not sehat_caller_owns_business(s.business_id) then raise exception 'not your business'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why this move is being undone';
  end if;

  v_billed := sehat_bed_stay_is_billed(s.admission_id);
  if v_billed is not null then
    raise exception
      'this stay''s bed charges are on bill % — cancel that bill first', v_billed
      using errcode = 'check_violation';
  end if;

  select * into prev from admission_bed_stays
   where admission_id = s.admission_id and from_at < s.from_at
   order by from_at desc limit 1;
  if not found then
    raise exception 'this is the first bed of the stay — there is no move to undo';
  end if;

  -- Order matters. Delete first, then reopen: the partial unique index allows
  -- exactly one period with a null to_at, so reopening while this row still
  -- exists would collide.
  delete from admission_bed_stays where id = p_stay_id;

  update admission_bed_stays
     set to_at = s.to_at,          -- null when the undone move was the current bed
         corrected_at = now(),
         corrected_by = p_corrected_by,
         correction_reason = p_reason
   where id = prev.id;

  -- Keep the admission pointing at the bed the patient is actually in.
  if s.to_at is null then
    update admissions set bed_id = prev.bed_id where id = s.admission_id;
  end if;

  perform sehat_post_bed_charges(s.admission_id);
end $$;

comment on function sehat_undo_bed_move is
  'Remove a transfer that never happened and reopen the bed before it. Deletes '
  'then reopens, in that order — the one-open-period index would reject the '
  'reverse.';


-- ============================================================================
-- 4b. The history has to carry an id
--
-- admission_bed_history is what a clinic reads, and it selected every column
-- except the primary key — so a screen could show a period and had no way to
-- name it in a correction. Republished with the id and the correction trail.
-- ============================================================================

-- Dropped rather than replaced: `create or replace view` cannot add a column
-- at the FRONT of the list, and the id belongs first. Nothing depends on this
-- view, so the drop is free.
drop view if exists admission_bed_history;

create view admission_bed_history as
  select
    bs.id,
    bs.admission_id, bs.business_id,
    bs.ward_name, bs.bed_label, bs.daily_charge_snapshot,
    bs.from_at, bs.to_at,
    greatest(1, ceil(extract(epoch from coalesce(bs.to_at, now()) - bs.from_at) / 86400.0)::integer) as days,
    (bs.to_at is null) as current,
    bs.corrected_at, bs.correction_reason,
    -- Null while the stay is still correctable; a bill number once it is not.
    sehat_bed_stay_is_billed(bs.admission_id) as billed_on
  from admission_bed_stays bs
 where bs.business_id in (select sehat_caller_business_ids())
 order by bs.from_at;

grant select on admission_bed_history to authenticated;


-- ============================================================================
-- 5. Grants
--
-- Still no UPDATE or DELETE policy on the table, deliberately. Everything above
-- is SECURITY DEFINER and validates first; a policy would let the same edits
-- through with none of the checks.
-- ============================================================================

grant execute on function sehat_bed_stay_is_billed(uuid) to authenticated;
grant execute on function sehat_correct_bed_stay(uuid, text, timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function sehat_undo_bed_move(uuid, text, uuid) to authenticated;

revoke all on function sehat_correct_bed_stay(uuid, text, timestamptz, timestamptz, uuid, uuid) from anon;
revoke all on function sehat_undo_bed_move(uuid, text, uuid) from anon;
revoke all on function sehat_bed_stay_is_billed(uuid) from anon;
