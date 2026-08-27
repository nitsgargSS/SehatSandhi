-- ============================================================================
-- Sehatsandhi — a dose record is evidence, so stop it being editable
--
-- Run AFTER 0068. Safe to re-run.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
-- 0067 built the drug chart on a promise:
--
--     "Administrations are append-only; a wrong entry is voided with a reason
--      and struck through, the way a line goes through paper."
--
-- Nothing enforced it. medication_administrations carried exactly one policy —
-- clinic_reads_med_admins, for SELECT — and no triggers at all. Append-only was
-- true only in the sense that no write policy existed, so `authenticated` could
-- not reach it. Anything that does not go through RLS could: the service role,
-- an edge function, a support script, a future admin RPC. All of them could
-- rewrite what dose a patient was given, or delete the row, and leave nothing
-- behind.
--
-- Found by asserting the promise in scripts/test-suite.mjs and watching the
-- UPDATE succeed.
--
-- prescriptions and patient_bills have had `_immutable` triggers since 0048 and
-- 0056. This is the same guarantee for the table where it matters most: a
-- prescription records what was intended, an administration records what was
-- actually put into a patient. When a drug chart is read back — at a handover,
-- at an inquiry — it has to be what was written at the bedside.
--
-- ── WHAT IS STILL ALLOWED ───────────────────────────────────────────────────
-- Exactly one transition: an un-voided entry becoming a voided one, which is
-- what sehat_void_administration does and all it does. Struck through, reason
-- recorded, original values untouched and still readable. A line through paper
-- cannot be un-drawn either, so voiding is one-way.
-- ============================================================================

create or replace function sehat_administration_is_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'a dose record cannot be deleted — void it with a reason instead'
      using errcode = 'check_violation';
  end if;

  -- Everything that says WHAT HAPPENED is frozen. Note given_at and dose_given
  -- especially: "when was it given" and "how much" are the two facts the chart
  -- exists to answer.
  if new.order_id      is distinct from old.order_id
  or new.admission_id  is distinct from old.admission_id
  or new.business_id   is distinct from old.business_id
  or new.due_at        is distinct from old.due_at
  or new.status        is distinct from old.status
  or new.given_at      is distinct from old.given_at
  or new.dose_given    is distinct from old.dose_given
  or new.route_given   is distinct from old.route_given
  or new.given_by      is distinct from old.given_by
  or new.witnessed_by  is distinct from old.witnessed_by
  or new.reason        is distinct from old.reason
  or new.notes         is distinct from old.notes
  or new.created_at    is distinct from old.created_at
  then
    raise exception
      'a dose record cannot be edited — void it with a reason and chart it again'
      using errcode = 'check_violation';
  end if;

  -- The void itself: once only, and it must say why.
  if old.voided_at is not null
     and (new.voided_at   is distinct from old.voided_at
       or new.voided_by   is distinct from old.voided_by
       or new.void_reason is distinct from old.void_reason)
  then
    raise exception
      'this dose record is already struck out — a strike-out cannot be rewritten'
      using errcode = 'check_violation';
  end if;

  if new.voided_at is not null and coalesce(btrim(new.void_reason), '') = '' then
    raise exception 'say why the dose record is being struck out'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function sehat_administration_is_append_only is
  'Added in 0069. 0067 promised the drug chart was append-only and nothing '
  'enforced it: the table had a SELECT policy and no triggers, so anything '
  'bypassing RLS could rewrite what a patient was given.';

drop trigger if exists med_admins_append_only on medication_administrations;
create trigger med_admins_append_only
  before update or delete on medication_administrations
  for each row execute function sehat_administration_is_append_only();

-- Belt and braces, matching what 0068 did elsewhere: the browser roles have no
-- business writing this table directly under any circumstances. Everything goes
-- through sehat_record_administration and sehat_void_administration.
revoke insert, update, delete, truncate on medication_administrations from anon, authenticated;
