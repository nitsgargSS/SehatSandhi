-- ============================================================================
-- Sehatsandhi — doctors' leave, a doctor's week across clinics, and two fixes
--
-- Run AFTER 0149. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • LEAVE. A doctor marks leave once, as a person — a whole day or some hours
--     — and it holds at every clinic. A clinic can also mark one of its doctors
--     unavailable at that clinic only. The bot and every booking skip those
--     times; a booking that lands on leave is refused by the database, so the
--     desk, the bot and the website all obey it. The bot says "on leave until …".
--   • Bookings already made for a time that becomes leave are NOT cancelled:
--     sehat_leave_conflicts lists them for the clinic to reschedule.
--   • MY WEEK. A doctor sees their appointments at every clinic in one list —
--     time, clinic, status, no patient details. Patients stay inside the clinic
--     that holds their records; opening one means switching to that clinic.
--
-- Fixed:
--   • A doctor removed from a clinic kept "being expected" there: their old
--     weekly hours still blocked the same hours at their other clinics, in the
--     clash check and in the slots the bot offers.
--   • A doctor held for the extra-doctor fee (0140) could already sign in to the
--     clinic and read its patients. Access now starts when the fee is paid.
-- ============================================================================

-- ── Leave ───────────────────────────────────────────────────────────────────
create table if not exists practitioner_leave (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  -- null: the doctor's own leave, at every clinic. Set: unavailable at this one.
  business_id uuid references businesses(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '366 days')
);
create index if not exists practitioner_leave_lookup
  on practitioner_leave (practitioner_id, starts_at) where cancelled_at is null;

alter table practitioner_leave enable row level security;
revoke all on practitioner_leave from anon, authenticated;
grant select on practitioner_leave to authenticated;
-- The doctor sees all of their own. A clinic sees its doctors' leave that
-- applies to it: its own entries, and the doctor's all-clinic leave.
drop policy if exists "leave_readers" on practitioner_leave;
create policy "leave_readers" on practitioner_leave for select using (
  practitioner_id = sehat_caller_practitioner_id()
  or (business_id is not null and sehat_caller_owns_business(business_id))
  or (business_id is null and exists (
        select 1 from business_practitioners bp
         where bp.practitioner_id = practitioner_leave.practitioner_id
           and bp.status <> 'suspended' and sehat_caller_owns_business(bp.business_id)))
  or sehat_is_staff());

create or replace function sehat_on_leave(p_practitioner uuid, p_business uuid, p_from timestamptz, p_to timestamptz)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_practitioner is not null and exists (
    select 1 from practitioner_leave l
     where l.practitioner_id = p_practitioner
       and l.cancelled_at is null
       and (l.business_id is null or l.business_id = p_business)
       and l.starts_at < p_to and p_from < l.ends_at);
$$;
grant execute on function sehat_on_leave(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Adding: the doctor for themself (all clinics, or one they work at), or an
-- owner/manager for one of their doctors at their clinic only.
create or replace function sehat_add_leave(
  p_practitioner uuid, p_business uuid, p_from timestamptz, p_to timestamptz, p_reason text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_self boolean := p_practitioner = sehat_caller_practitioner_id();
  v_id uuid;
begin
  if not v_self then
    if p_business is null or not sehat_caller_manages_business(p_business) then
      raise exception 'Only the doctor, or the clinic''s owner or manager for their own clinic, can mark leave.'
        using errcode = '42501';
    end if;
  end if;
  if p_business is not null and not exists (
       select 1 from business_practitioners where business_id = p_business
          and practitioner_id = p_practitioner and status <> 'suspended') then
    raise exception 'That doctor does not work at this clinic.' using errcode = 'P0001';
  end if;
  if p_to <= p_from then raise exception 'Leave must end after it starts.' using errcode = 'P0001'; end if;

  insert into practitioner_leave (practitioner_id, business_id, starts_at, ends_at, reason, created_by)
  values (p_practitioner, p_business, p_from, p_to, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function sehat_cancel_leave(p_leave uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare l practitioner_leave%rowtype;
begin
  select * into l from practitioner_leave where id = p_leave;
  if l.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  if not (l.practitioner_id = sehat_caller_practitioner_id()
          or (l.business_id is not null and sehat_caller_manages_business(l.business_id))) then
    raise exception 'Only whoever can mark this leave can cancel it.' using errcode = '42501';
  end if;
  update practitioner_leave set cancelled_at = now() where id = p_leave and cancelled_at is null;
end $$;

revoke all on function sehat_add_leave(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function sehat_cancel_leave(uuid) from public, anon;
grant execute on function sehat_add_leave(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function sehat_cancel_leave(uuid) to authenticated;

-- ── No booking lands on leave ───────────────────────────────────────────────
create or replace function sehat_booking_not_on_leave()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' or new.practitioner_id is null or new.slot_datetime is null then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelled'
     and old.slot_datetime is not distinct from new.slot_datetime
     and old.practitioner_id is not distinct from new.practitioner_id then
    return new;   -- a status change on a live booking made before the leave
  end if;
  if sehat_on_leave(new.practitioner_id, new.business_id, new.slot_datetime,
                    sehat_slot_end(new.business_id, new.practitioner_id, new.slot_datetime)) then
    raise exception '% is on leave at that time. Choose another time or doctor.',
      coalesce((select full_name from practitioners where id = new.practitioner_id), 'The doctor')
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists booking_not_on_leave on appointments;
create trigger booking_not_on_leave before insert or update of slot_datetime, practitioner_id, status on appointments
  for each row execute function sehat_booking_not_on_leave();

-- ── Bookings a new leave now covers ─────────────────────────────────────────
create or replace function sehat_leave_conflicts(p_business uuid)
returns table (appointment_id uuid, slot_datetime timestamptz, practitioner_id uuid, doctor_name text,
               patient_name text, patient_phone text, status text)
language sql stable security definer set search_path = public as $$
  select a.id, a.slot_datetime, a.practitioner_id, p.full_name, a.patient_name, a.patient_phone, a.status
    from appointments a
    join practitioners p on p.id = a.practitioner_id
   where a.business_id = p_business
     and sehat_caller_owns_business(p_business)
     and a.status not in ('cancelled', 'completed', 'no_show')
     and a.slot_datetime >= now()
     and sehat_on_leave(a.practitioner_id, a.business_id, a.slot_datetime,
                        sehat_slot_end(a.business_id, a.practitioner_id, a.slot_datetime))
   order by a.slot_datetime;
$$;
grant execute on function sehat_leave_conflicts(uuid) to authenticated;

-- ── My week ─────────────────────────────────────────────────────────────────
-- The caller's own appointments at every clinic they are live at. No patient
-- detail: the record belongs to the clinic, and is read inside it.
create or replace function sehat_my_week(p_from date, p_to date)
returns table (slot_datetime timestamptz, business_id uuid, business_name text, location_name text, status text)
language sql stable security definer set search_path = public as $$
  select a.slot_datetime, a.business_id, b.name, l.name, a.status
    from appointments a
    join businesses b on b.id = a.business_id
    join business_practitioners bp on bp.business_id = a.business_id and bp.practitioner_id = a.practitioner_id
    left join practice_locations l on l.id = a.location_id
   where a.practitioner_id = sehat_caller_practitioner_id()
     and bp.status = 'active'
     and a.slot_datetime >= (p_from::timestamp at time zone 'Asia/Kolkata')
     and a.slot_datetime <  ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
     and p_to - p_from <= 62
   order by a.slot_datetime;
$$;
grant execute on function sehat_my_week(date, date) to authenticated;

-- ── Rewrites of existing functions ──────────────────────────────────────────
-- Each is changed in place from the definition this database holds (identical
-- on production and sandbox when this was written), and FAILS LOUDLY if the
-- text it expects is not there, rather than silently doing nothing.
do $$
declare
  def text; fixed text;
begin
  -- Each rewrite runs once: a definition already carrying '0150' is left alone.
  -- The patterns below are the exact text of the live definitions, whitespace
  -- included, so they must not be re-indented.

  -- 1. Removed doctors' hours stop counting as "expected elsewhere".
  def := pg_get_functiondef('sehat_check_availability_clash()'::regprocedure);
  if position('0150' in def) = 0 then
    fixed := replace(def,
'where obp.practitioner_id = v_practitioner',
'where obp.practitioner_id = v_practitioner
     and obp.status <> ''suspended''   -- 0150: a clinic they left does not expect them');
    if fixed = def then raise exception '0150: clash function text not found'; end if;
    execute fixed;
  end if;

  -- 2. Slots: the same, plus leave.
  def := pg_get_functiondef('sehat_open_windows(uuid, date, uuid)'::regprocedure);
  if position('0150' in def) = 0 then
    fixed := replace(def,
'where obp.practitioner_id = p_practitioner_id
           and oa.is_active',
'where obp.practitioner_id = p_practitioner_id
           and obp.status <> ''suspended''   -- 0150
           and oa.is_active');
    fixed := replace(fixed,
'select p_practitioner_id is not null and (',
'select p_practitioner_id is not null and (
      -- 0150: on leave, here or everywhere
      sehat_on_leave(p_practitioner_id, p_business_id, w.window_start,
                     w.window_start + make_interval(mins => w.slot_duration_minutes))
      or');
    if fixed = def or position('obp.status' in fixed) = 0 or position('sehat_on_leave' in fixed) = 0 then
      raise exception '0150: open-windows text not found';
    end if;
    execute fixed;
  end if;

  -- 3. Held for the fee = not in yet: no clinic in the switcher, no role.
  def := pg_get_functiondef('sehat_caller_business_ids()'::regprocedure);
  if position('0150' in def) = 0 then
    fixed := replace(def,
'and bp.status <> ''suspended''
     and bp.can_login_web',
'and bp.status <> ''suspended''
     and not coalesce(bp.awaiting_payment, false)   -- 0150
     and bp.can_login_web');
    if fixed = def then raise exception '0150: business-ids text not found'; end if;
    execute fixed;
  end if;

  def := pg_get_functiondef('sehat_caller_role(uuid)'::regprocedure);
  if position('0150' in def) = 0 then
    fixed := replace(def,
'and bp.status <> ''suspended''
           and bp.can_login_web',
'and bp.status <> ''suspended''
           and not coalesce(bp.awaiting_payment, false)   -- 0150
           and bp.can_login_web');
    if fixed = def then raise exception '0150: caller-role text not found'; end if;
    execute fixed;
  end if;

  -- 4. The bot says why a doctor has no slots when it is leave.
  def := pg_get_functiondef('bot_available_slots_json(text, text, text, text)'::regprocedure);
  if position('0150' in def) = 0 then
    fixed := replace(def,
'then ''इनके पास अगले 7 दिन कोई समय खाली नहीं है। कृपया कोई और नंबर चुनें:''',
'then coalesce((   -- 0150: say so when it is leave
                select ''डॉक्टर '' || to_char(max(l.ends_at) at time zone ''Asia/Kolkata'', ''DD Mon'')
                       || '' तक छुट्टी पर हैं। कृपया कोई और नंबर चुनें:''
                  from bot_pick(v_kind, v_filter, p_pincode, p_selection) k
                  join practitioner_leave l on l.practitioner_id = k.practitioner_id
                 where l.cancelled_at is null
                   and (l.business_id is null or l.business_id = k.business_id)
                   and l.starts_at < now() + interval ''7 days'' and l.ends_at > now()
                having max(l.ends_at) is not null),
               ''इनके पास अगले 7 दिन कोई समय खाली नहीं है। कृपया कोई और नंबर चुनें:'')');
    if fixed = def then raise exception '0150: bot slots text not found'; end if;
    execute fixed;
  end if;
end $$;

notify pgrst, 'reload schema';
