-- ============================================================================
-- Sehatsandhi — a bed a patient has left is still a bed they occupied
--
-- Run AFTER 0052. Safe to re-run.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- admissions.bed_id points at where the patient is NOW, and
-- sehat_post_bed_charges multiplied the WHOLE stay by THAT bed's rate. A
-- patient three days in ICU at ₹5,000 and then four in general at ₹1,000 was
-- billed 7 × ₹1,000 = ₹7,000 instead of ₹19,000. Reverse the move and the same
-- arithmetic overcharges the patient by ₹12,000.
--
-- The bed-move trigger from 0050 wrote a ward note — prose, for a human to
-- read. Prose does not multiply. Occupancy has to be periods, and it always
-- did; a single pointer cannot express "where they were" once they leave.
--
-- Fixed before any real admission exists. After that, every transferred stay is
-- wrong and nothing in the data says which ones.
--
-- ── WHY THE RATE IS SNAPSHOTTED ─────────────────────────────────────────────
-- daily_charge_snapshot copies beds.daily_charge at the moment the patient
-- occupies the bed. Reading it live would mean a ward repricing its beds in
-- March silently rewrites every bill from February — the same reason invoices
-- snapshot their parties in 0007 and prescriptions snapshot theirs in 0048.
-- ============================================================================


-- ============================================================================
-- 1. Occupancy, as periods
-- ============================================================================

create table if not exists admission_bed_stays (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  -- The bed may be deleted later; the fact that it was occupied is not undone
  -- by that, so the period keeps its own labels below.
  bed_id uuid references beds(id) on delete set null,

  -- Denormalised so a bill still reads correctly after a ward is renamed or a
  -- bed retired. The same reasoning as the snapshot on the rate.
  ward_name text,
  bed_label text,
  daily_charge_snapshot numeric(12,2),

  from_at timestamptz not null default now(),
  -- Null means "still there". Exactly one open period per admission, enforced
  -- below — a patient in two beds at once is a data fault, not a transfer.
  to_at timestamptz,

  created_at timestamptz not null default now(),

  constraint admission_bed_stays_ordered check (to_at is null or to_at >= from_at)
);

create index if not exists admission_bed_stays_admission_idx
  on admission_bed_stays (admission_id, from_at);
create unique index if not exists admission_bed_stays_one_open
  on admission_bed_stays (admission_id) where to_at is null;

comment on table admission_bed_stays is
  'Where a patient slept, and for how long. admissions.bed_id is only the '
  'current pointer; this is the timeline billing multiplies against. Ward name, '
  'bed label and rate are snapshotted so renaming a ward or repricing a bed '
  'cannot rewrite a bill that was already correct.';


-- ============================================================================
-- 2. Keeping the timeline honest
--
-- Written by trigger, never by a caller. The old trigger logged a move as prose
-- and that was the whole defect — a caller who forgets to close a period
-- produces a bill nobody can reconstruct.
-- ============================================================================

create or replace function sehat_open_bed_stay(
  p_admission_id uuid, p_business_id uuid, p_bed_id uuid, p_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_bed_id is null then return; end if;   -- admitted, waiting for a bed

  select b.daily_charge, b.label, w.name as ward_name
    into v
    from beds b left join wards w on w.id = b.ward_id
   where b.id = p_bed_id;

  insert into admission_bed_stays (
    admission_id, business_id, bed_id, ward_name, bed_label,
    daily_charge_snapshot, from_at
  ) values (
    p_admission_id, p_business_id, p_bed_id, v.ward_name, v.label,
    v.daily_charge, p_at
  );
end $$;

create or replace function sehat_close_bed_stay(p_admission_id uuid, p_at timestamptz)
returns void language sql security definer set search_path = public as $$
  update admission_bed_stays
     set to_at = greatest(p_at, from_at)     -- a period never ends before it starts
   where admission_id = p_admission_id and to_at is null;
$$;

-- One trigger for both events. A move closes the old period and opens the new;
-- a discharge closes whatever is open. Both were previously either prose or
-- nothing at all.
create or replace function sehat_admission_tracks_bed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_from text; v_to text;
begin
  if tg_op = 'INSERT' then
    perform sehat_open_bed_stay(new.id, new.business_id, new.bed_id, new.admitted_at);
    return new;
  end if;

  -- A stay that has ended: close the period, whatever the bed says.
  if new.status <> 'admitted' and old.status = 'admitted' then
    perform sehat_close_bed_stay(new.id, coalesce(new.discharged_at, now()));
    return new;
  end if;

  if new.bed_id is distinct from old.bed_id then
    perform sehat_close_bed_stay(new.id, now());
    perform sehat_open_bed_stay(new.id, new.business_id, new.bed_id, now());

    select w.name || ' / ' || b.label into v_from
      from beds b join wards w on w.id = b.ward_id where b.id = old.bed_id;
    select w.name || ' / ' || b.label into v_to
      from beds b join wards w on w.id = b.ward_id where b.id = new.bed_id;

    insert into admission_notes (admission_id, business_id, note_type, body)
    values (new.id, new.business_id, 'bed_move',
            'Moved from ' || coalesce(v_from, 'no bed') || ' to ' || coalesce(v_to, 'no bed'));
  end if;

  return new;
end $$;

comment on function sehat_admission_tracks_bed is
  'Maintains the occupancy timeline and the ward note together. Replaces '
  '0050''s move logger, which wrote the note and nothing else — which is why '
  'bed-day billing was wrong for any patient who moved.';

-- AFTER, not BEFORE: the admission row must exist before a period can point at
-- it, and the previous trigger was BEFORE UPDATE only.
drop trigger if exists admissions_log_bed_move on admissions;
drop trigger if exists admissions_track_bed on admissions;
create trigger admissions_track_bed
  after insert or update of bed_id, status on admissions
  for each row execute function sehat_admission_tracks_bed();

-- Backfill anything already admitted. Nothing should exist yet, but a migration
-- that only works on an empty table is a migration that fails the first time it
-- matters.
insert into admission_bed_stays (
  admission_id, business_id, bed_id, ward_name, bed_label,
  daily_charge_snapshot, from_at, to_at
)
select a.id, a.business_id, a.bed_id, w.name, b.label, b.daily_charge,
       a.admitted_at, a.discharged_at
  from admissions a
  left join beds b on b.id = a.bed_id
  left join wards w on w.id = b.ward_id
 where a.bed_id is not null
   and not exists (select 1 from admission_bed_stays s where s.admission_id = a.id);


-- ============================================================================
-- 3. Billing, per period
--
-- Same contract as before — idempotent, replaces its own previous lines — but
-- now one charge line per bed occupied, so a bill reads the way a stay actually
-- happened rather than flattening it to wherever the patient ended up.
-- ============================================================================

create or replace function sehat_post_bed_charges(p_admission_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_biz uuid;
  v_member uuid;
  v_end timestamptz;
  v_total numeric(12,2) := 0;
  s record;
  v_days integer;
  v_line numeric(12,2);
begin
  select a.business_id, a.patient_member_id, coalesce(a.discharged_at, now())
    into v_biz, v_member, v_end
    from admissions a where a.id = p_admission_id;
  if not found then raise exception 'no such admission'; end if;
  if not sehat_caller_owns_business(v_biz) then raise exception 'not your business'; end if;

  -- Replace this stay's bed lines rather than adding to them, so a re-run after
  -- a transfer or a late discharge corrects the bill instead of doubling it.
  delete from patient_charges
   where admission_id = p_admission_id and category = 'bed';

  for s in
    select bs.*, coalesce(bs.to_at, v_end) as ended_at
      from admission_bed_stays bs
     where bs.admission_id = p_admission_id
     order by bs.from_at
  loop
    continue when coalesce(s.daily_charge_snapshot, 0) = 0;

    -- A part day is a day: a bed occupied from 11pm to 9am has been used, and
    -- every hospital charges it. Applied per period, so two half-days across a
    -- transfer are two days — which is what the wards actually did.
    v_days := greatest(1, ceil(extract(epoch from s.ended_at - s.from_at) / 86400.0)::integer);
    v_line := v_days * s.daily_charge_snapshot;
    v_total := v_total + v_line;

    insert into patient_charges (
      business_id, patient_member_id, admission_id, category, description,
      quantity, unit_price, amount, charged_on
    ) values (
      v_biz, v_member, p_admission_id, 'bed',
      coalesce(nullif(concat_ws(' / ', s.ward_name, 'bed ' || s.bed_label), ''), 'Bed')
        || ' — ' || v_days || ' day' || case when v_days = 1 then '' else 's' end,
      v_days, s.daily_charge_snapshot, v_line,
      coalesce(s.ended_at::date, current_date)
    );
  end loop;

  return v_total;
end $$;

comment on function sehat_post_bed_charges is
  'One charge line per bed occupied, each at the rate snapshotted when the '
  'patient moved in. Replaces the version that multiplied the whole stay by '
  'whichever bed they happened to end up in.';


-- ============================================================================
-- 4. Reading it back
-- ============================================================================

create or replace view admission_bed_history as
  select
    bs.admission_id, bs.business_id,
    bs.ward_name, bs.bed_label, bs.daily_charge_snapshot,
    bs.from_at, bs.to_at,
    greatest(1, ceil(extract(epoch from coalesce(bs.to_at, now()) - bs.from_at) / 86400.0)::integer) as days,
    (bs.to_at is null) as current
  from admission_bed_stays bs
 where bs.business_id in (select sehat_caller_business_ids())
 order by bs.from_at;

alter table admission_bed_stays enable row level security;

drop policy if exists "clinic_reads_bed_stays" on admission_bed_stays;
create policy "clinic_reads_bed_stays" on admission_bed_stays
  for select using (sehat_caller_owns_business(business_id));

-- No insert, update or delete policy. The timeline is written by trigger; a
-- clinic that could edit it by hand could edit a bill after the fact.

grant select on admission_bed_history to authenticated;
revoke all on function sehat_open_bed_stay(uuid, uuid, uuid, timestamptz) from anon, authenticated;
revoke all on function sehat_close_bed_stay(uuid, timestamptz) from anon, authenticated;
