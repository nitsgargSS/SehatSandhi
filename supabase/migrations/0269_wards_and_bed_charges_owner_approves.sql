-- ============================================================================
-- 0269 — Wards, beds and bed charges: who may set them up, and who approves
-- ============================================================================
-- Decided 26 Oct 2026:
--   - the OWNER and a MANAGER set up wards and beds, with each bed's daily
--     charge (the setup screen had no box for the charge at all);
--   - once set up, a change — a bed's or a whole ward's charge, a new name, a
--     bed or ward taken out — is the OWNER's: an owner's change applies at
--     once; a manager's waits for the owner to approve it;
--   - nobody else (reception, nurses, doctors) changes wards or beds; they go
--     on admitting, moving and discharging patients as before.
--
-- The table policies on wards and beds said only "works at this clinic", so a
-- receptionist could have changed what every patient is charged per day.
-- Inserting is now owner or manager; updating and deleting is the owner only
-- (the approval below applies a manager's change as the owner's decision).
-- A bed or ward is never deleted from here: it is taken out of service, so
-- the stays and bills that name it keep their history.
-- ============================================================================

-- ── 1. Who may write ────────────────────────────────────────────────────────
create or replace function sehat_can_set_up_wards(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select sehat_is_admin() or coalesce(sehat_caller_role(p_business) in ('owner', 'manager'), false);
$$;
create or replace function sehat_can_change_wards(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select sehat_is_admin() or coalesce(sehat_caller_role(p_business) = 'owner', false);
$$;
revoke all on function sehat_can_set_up_wards(uuid) from public, anon;
revoke all on function sehat_can_change_wards(uuid) from public, anon;
grant execute on function sehat_can_set_up_wards(uuid) to authenticated;
grant execute on function sehat_can_change_wards(uuid) to authenticated;

drop policy if exists clinic_writes_wards on wards;
create policy clinic_writes_wards on wards for insert to authenticated with check (sehat_can_set_up_wards(business_id));
drop policy if exists clinic_updates_wards on wards;
create policy clinic_updates_wards on wards for update to authenticated
  using (sehat_can_change_wards(business_id)) with check (sehat_can_change_wards(business_id));
drop policy if exists clinic_removes_wards on wards;
create policy clinic_removes_wards on wards for delete to authenticated using (sehat_can_change_wards(business_id));

drop policy if exists clinic_writes_beds on beds;
create policy clinic_writes_beds on beds for insert to authenticated with check (sehat_can_set_up_wards(business_id));
drop policy if exists clinic_updates_beds on beds;
create policy clinic_updates_beds on beds for update to authenticated
  using (sehat_can_change_wards(business_id)) with check (sehat_can_change_wards(business_id));
drop policy if exists clinic_removes_beds on beds;
create policy clinic_removes_beds on beds for delete to authenticated using (sehat_can_change_wards(business_id));

-- ── 2. A change, and the owner's approval ──────────────────────────────────
create table if not exists ward_change_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('bed_charge', 'ward_charge', 'bed_label', 'ward_name', 'bed_remove', 'ward_remove')),
  target_id uuid not null,
  target_label text,
  value jsonb not null default '{}'::jsonb,
  before_text text,
  after_text text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  requested_by uuid,
  requested_by_name text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists ward_change_requests_business_idx on ward_change_requests (business_id, created_at desc);
alter table ward_change_requests enable row level security;
revoke all on ward_change_requests from anon;
grant select on ward_change_requests to authenticated;
drop policy if exists clinic_reads_ward_changes on ward_change_requests;
create policy clinic_reads_ward_changes on ward_change_requests for select to authenticated
  using (sehat_can_set_up_wards(business_id));

-- Do it. Called only from the two functions below, which have checked who may.
create or replace function sehat_ward_change_apply(r ward_change_requests)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_charge numeric := nullif(r.value->>'charge', '')::numeric;
  v_text text := nullif(btrim(coalesce(r.value->>'text', '')), '');
begin
  if r.kind in ('bed_charge', 'ward_charge') and (v_charge is null or v_charge < 0 or v_charge > 1000000) then
    raise exception 'Enter a daily charge between ₹0 and ₹10,00,000.' using errcode = '22023';
  end if;
  if r.kind in ('bed_label', 'ward_name') and (v_text is null or length(v_text) > 60) then
    raise exception 'Enter a name (up to 60 letters).' using errcode = '22023';
  end if;
  if r.kind = 'bed_remove' and exists (select 1 from admissions a where a.bed_id = r.target_id and a.status = 'admitted') then
    raise exception 'That bed has a patient in it. Move or discharge them first.' using errcode = 'P0001';
  end if;
  if r.kind = 'ward_remove' and exists (select 1 from admissions a join beds b on b.id = a.bed_id where b.ward_id = r.target_id and a.status = 'admitted') then
    raise exception 'That ward has patients in it. Move or discharge them first.' using errcode = 'P0001';
  end if;

  case r.kind
    when 'bed_charge' then update beds set daily_charge = v_charge where id = r.target_id and business_id = r.business_id;
    when 'ward_charge' then update beds set daily_charge = v_charge where ward_id = r.target_id and business_id = r.business_id and is_active;
    when 'bed_label' then update beds set label = v_text where id = r.target_id and business_id = r.business_id;
    when 'ward_name' then update wards set name = v_text where id = r.target_id and business_id = r.business_id;
    when 'bed_remove' then update beds set is_active = false where id = r.target_id and business_id = r.business_id;
    when 'ward_remove' then
      update beds set is_active = false where ward_id = r.target_id and business_id = r.business_id;
      update wards set is_active = false where id = r.target_id and business_id = r.business_id;
  end case;
exception when unique_violation then
  raise exception 'There is already a bed or ward with that name.' using errcode = 'P0001';
end $$;
revoke all on function sehat_ward_change_apply(ward_change_requests) from public, anon, authenticated;

-- Ask for a change. The owner's applies now; a manager's waits for the owner.
create or replace function sehat_ward_change(p_business uuid, p_kind text, p_target uuid, p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_role text := sehat_caller_role(p_business);
  v_owner boolean := sehat_can_change_wards(p_business);
  r ward_change_requests;
  v_label text;
  v_before text;
  v_after text;
begin
  if not sehat_can_set_up_wards(p_business) then
    raise exception 'Only the owner or a manager can change wards and beds.' using errcode = '42501';
  end if;
  if p_kind like 'bed%' then
    select w.name || ' · bed ' || b.label,
           case p_kind when 'bed_charge' then coalesce('₹' || b.daily_charge::text, 'no charge') when 'bed_label' then b.label else 'in service' end
      into v_label, v_before
      from beds b join wards w on w.id = b.ward_id where b.id = p_target and b.business_id = p_business;
  else
    select w.name,
           case p_kind when 'ward_charge' then (select coalesce(string_agg(distinct coalesce('₹' || x.daily_charge::text, 'no charge'), ', '), 'no beds')
                                                   from beds x where x.ward_id = w.id and x.is_active)
                       when 'ward_name' then w.name else 'in service' end
      into v_label, v_before
      from wards w where w.id = p_target and w.business_id = p_business;
  end if;
  if v_label is null then raise exception 'That bed or ward is not in this hospital.' using errcode = 'P0002'; end if;
  v_after := case when p_kind in ('bed_charge', 'ward_charge') then '₹' || (p_value->>'charge')
                  when p_kind in ('bed_label', 'ward_name') then p_value->>'text' else 'taken out of service' end;

  insert into ward_change_requests (business_id, kind, target_id, target_label, value, before_text, after_text,
                                    status, requested_by, requested_by_name)
  values (p_business, p_kind, p_target, v_label, coalesce(p_value, '{}'::jsonb), v_before, v_after,
          case when v_owner then 'applied' else 'pending' end, auth.uid(), sehat_caller_staff_name(p_business))
  returning * into r;

  if v_owner then
    perform sehat_ward_change_apply(r);
    update ward_change_requests set decided_by = auth.uid(), decided_by_name = r.requested_by_name, decided_at = now() where id = r.id;
    return jsonb_build_object('applied', true, 'id', r.id);
  end if;
  return jsonb_build_object('applied', false, 'id', r.id,
    'text', 'Sent to the owner for approval: ' || v_label || ' — ' || v_after || '.');
end $$;
revoke all on function sehat_ward_change(uuid, text, uuid, jsonb) from public, anon;
grant execute on function sehat_ward_change(uuid, text, uuid, jsonb) to authenticated;

-- The owner approves or rejects a manager's change.
create or replace function sehat_ward_change_decide(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  r ward_change_requests;
begin
  select * into r from ward_change_requests where id = p_request for update;
  if r.id is null then raise exception 'No such change.' using errcode = 'P0002'; end if;
  if not sehat_can_change_wards(r.business_id) then
    raise exception 'Only the owner can approve changes to wards and beds.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'That change has already been decided.' using errcode = 'P0001'; end if;
  if p_approve then perform sehat_ward_change_apply(r); end if;
  update ward_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_by_name = sehat_caller_staff_name(r.business_id), decided_at = now(),
         note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
end $$;
revoke all on function sehat_ward_change_decide(uuid, boolean, text) from public, anon;
grant execute on function sehat_ward_change_decide(uuid, boolean, text) to authenticated;

-- ── 3. The Today tab tells the owner a change is waiting ────────────────────
create or replace function sehat_today(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := sehat_caller_role(p_business);
  v_me uuid := sehat_caller_practitioner_id();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_day_start timestamptz := v_today::timestamp at time zone 'Asia/Kolkata';
  v_day_end timestamptz := (v_today + 1)::timestamp at time zone 'Asia/Kolkata';
  b businesses;
  v_only uuid;
  v_doctors jsonb;
  v_out jsonb;
begin
  if v_role is null and not sehat_is_admin() then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  select * into b from businesses where id = p_business;
  -- A doctor sees their own day; reception, nurses, the manager and the owner see everyone's.
  v_only := case when v_role = 'doctor' then v_me end;

  -- ── Doctors: today's appointments, and their free times ──
  with docs as (
    select p.id, p.full_name, coalesce(bp.sort_order, 0) so
      from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = p_business and bp.role = 'doctor' and bp.status = 'active'
       and (v_only is null or p.id = v_only)
  ), appts as (
    select a.id, a.practitioner_id, a.slot_datetime, a.patient_name, a.patient_member_id, a.status,
           right(regexp_replace(coalesce(a.patient_phone, ''), '\D', '', 'g'), 4) phone4,
           (select jsonb_build_object('id', q.id, 'number', q.token_number, 'status', q.status)
              from opd_queue q where q.business_id = p_business and q.queue_date = v_today
               and (q.appointment_id = a.id or (a.patient_member_id is not null and q.patient_member_id = a.patient_member_id
                                                and q.practitioner_id is not distinct from a.practitioner_id))
             order by q.created_at desc limit 1) token
      from appointments a
     where a.business_id = p_business and a.slot_datetime >= v_day_start and a.slot_datetime < v_day_end
       and a.status <> 'cancelled'
       and (v_only is null or a.practitioner_id = v_only)
  )
  select coalesce(jsonb_agg(d order by d->>'sort', d->>'name'), '[]'::jsonb) into v_doctors from (
    select jsonb_build_object(
      'id', dd.id, 'name', dd.full_name, 'sort', lpad(dd.so::text, 4, '0'), 'me', dd.id = v_me,
      'appointments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'at', x.slot_datetime, 'name', x.patient_name, 'member_id', x.patient_member_id,
          'status', x.status, 'phone4', x.phone4, 'token', x.token) order by x.slot_datetime)
        from appts x where x.practitioner_id = dd.id), '[]'::jsonb),
      'free_today', (select count(*) from sehat_open_windows(p_business, v_today, dd.id) w
                      where w.seats_left > 0 and w.window_start > now() and not coalesce(w.blocked_elsewhere, false)),
      'next_free', (select min(w.window_start) from sehat_open_windows(p_business, v_today, dd.id) w
                     where w.seats_left > 0 and w.window_start > now() and not coalesce(w.blocked_elsewhere, false))
    ) d
      from docs dd
    union all
    -- Booked with no doctor chosen.
    select jsonb_build_object('id', null, 'name', 'Any doctor', 'sort', '9999', 'me', false,
      'appointments', (select jsonb_agg(jsonb_build_object(
          'id', x.id, 'at', x.slot_datetime, 'name', x.patient_name, 'member_id', x.patient_member_id,
          'status', x.status, 'phone4', x.phone4, 'token', x.token) order by x.slot_datetime)
        from appts x where x.practitioner_id is null),
      'free_today', 0, 'next_free', null)
     where v_only is null and exists (select 1 from appts x where x.practitioner_id is null)
  ) s;

  v_out := jsonb_build_object(
    'role', v_role, 'today', v_today, 'doctors', v_doctors,
    'next', (select jsonb_build_object('at', a.slot_datetime, 'doctor', p.full_name)
               from appointments a left join practitioners p on p.id = a.practitioner_id
              where a.business_id = p_business and a.slot_datetime >= v_day_end and a.status in ('booked', 'confirmed')
                and (v_only is null or a.practitioner_id = v_only)
              order by a.slot_datetime limit 1));

  -- ── OPD ──
  if coalesce(b.opd_module, true) then
    v_out := v_out || jsonb_build_object('opd', (
      select jsonb_build_object(
        'waiting', count(*) filter (where q.status = 'waiting'),
        'with_doctor', count(*) filter (where q.status in ('called', 'in_consultation')),
        'seen', count(*) filter (where q.status = 'completed'),
        'left', count(*) filter (where q.status in ('skipped', 'left')))
        from opd_queue q where q.business_id = p_business and q.queue_date = v_today
         and (v_only is null or q.practitioner_id = v_only)));
  end if;

  -- ── Follow-ups ──
  v_out := v_out || jsonb_build_object('follow_ups', (
    with f as (
      select p.patient_member_id m, p.follow_up_date d from prescriptions p
       where p.business_id = p_business and p.status = 'issued' and p.follow_up_date between v_today - 7 and v_today
         and (v_only is null or p.practitioner_id = v_only)
      union
      select v.patient_member_id, v.follow_up_due from patient_visits v
       where v.business_id = p_business and v.follow_up_due between v_today - 7 and v_today and v.patient_member_id is not null
         and (v_only is null or v.practitioner_id = v_only)
    )
    select jsonb_build_object(
      'due_today', count(distinct f.m) filter (where f.d = v_today),
      'missed_7d', count(distinct f.m) filter (where f.d < v_today and not exists (
          select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = f.m
             and (bp.last_seen_at at time zone 'Asia/Kolkata')::date >= f.d)))
      from f));

  -- ── Wards ──
  if coalesce(b.ipd_module, false) then
    v_out := v_out || jsonb_build_object('ipd', jsonb_build_object(
      'beds', (select count(*) from beds where business_id = p_business and is_active),
      'occupied', (select count(*) from admissions where business_id = p_business and status = 'admitted' and bed_id is not null),
      'admitted', (select count(*) from admissions where business_id = p_business and status = 'admitted'
                      and (v_only is null or attending_practitioner_id = v_only)),
      'admitted_today', (select count(*) from admissions where business_id = p_business and admitted_at >= v_day_start and admitted_at < v_day_end),
      'discharge_due', (select count(*) from admissions where business_id = p_business and status = 'admitted'
                           and expected_discharge is not null and (expected_discharge at time zone 'Asia/Kolkata')::date <= v_today
                           and (v_only is null or attending_practitioner_id = v_only)),
      'discharged_today', (select count(*) from admissions where business_id = p_business and discharged_at >= v_day_start and discharged_at < v_day_end)));
  end if;

  -- ── Lab ──
  if coalesce(b.lab_module, false) then
    v_out := v_out || jsonb_build_object('lab', (
      select jsonb_build_object(
        'ordered', count(*) filter (where o.status = 'ordered'),
        'home', count(*) filter (where o.status = 'ordered' and o.collection = 'home'),
        'collected', count(*) filter (where o.status = 'collected'),
        'in_progress', count(*) filter (where o.status = 'in_progress'),
        'ready', count(*) filter (where o.status = 'ready'),
        'reported_today', count(*) filter (where o.status = 'reported' and o.reported_at >= v_day_start))
        from lab_orders o where o.business_id = p_business
         and (o.status in ('ordered', 'collected', 'in_progress', 'ready') or o.reported_at >= v_day_start)));
  end if;

  -- ── Pharmacy ──
  if coalesce(b.pharmacy_module, false) and v_role is distinct from 'doctor' then
    v_out := v_out || jsonb_build_object('pharmacy', jsonb_build_object(
      'sales_today', (select coalesce(sum(net_payable), 0) from pharmacy_bills
                       where business_id = p_business and status <> 'cancelled' and issued_at >= v_day_start and issued_at < v_day_end),
      'bills_today', (select count(*) from pharmacy_bills
                       where business_id = p_business and status <> 'cancelled' and issued_at >= v_day_start and issued_at < v_day_end),
      'low_stock', (select count(*) from pharmacy_items i
                     where i.business_id = p_business and i.is_active and coalesce(i.reorder_level, 0) > 0
                       and coalesce((select sum(bt.qty_in_hand) from pharmacy_batches bt
                                      where bt.item_id = i.id and (bt.expiry_date is null or bt.expiry_date > v_today)), 0) <= i.reorder_level),
      'expiring_30d', (select count(*) from pharmacy_batches bt
                        where bt.business_id = p_business and bt.qty_in_hand > 0 and bt.expiry_date between v_today and v_today + 30)));
  end if;

  -- ── Money: owner and manager ──
  if v_role in ('owner', 'manager') or sehat_is_admin() then
    v_out := v_out || jsonb_build_object('money', jsonb_build_object(
      'billed_today', (select coalesce(sum(net_payable), 0) from patient_bills
                        where business_id = p_business and status = 'issued' and issued_at >= v_day_start and issued_at < v_day_end),
      'collected_today', (select coalesce(sum(case when kind = 'refund' then -amount else amount end), 0) from patient_payments
                           where business_id = p_business and received_on = v_today),
      'unpaid_bills', (select count(*) from business_bills_outstanding where business_id = p_business and balance_due > 0.5),
      'unpaid_amount', (select coalesce(sum(balance_due), 0) from business_bills_outstanding where business_id = p_business and balance_due > 0.5)));

    -- ── Alerts: only what is wrong ──
    v_out := v_out || jsonb_build_object('alerts', (
      select coalesce(jsonb_agg(a), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'plan', 'text',
                 'Your plan ends on ' || to_char(b.term_end - 1, 'DD Mon') || ' — renew to keep everything running.') a
         where b.term_end is not null and b.term_end - 1 between v_today and v_today + 7
        union all
        select jsonb_build_object('kind', 'wallet', 'text',
                 'WhatsApp wallet is low (₹' || round(w.balance_paise / 100.0) || '). Top up so messages keep going.')
          from business_wallets w
         where w.business_id = p_business and w.balance_paise < 5000
           and exists (select 1 from business_wa_accounts x where x.business_id = p_business and x.subscription_status = 'active' and x.plan = 'basic')
        union all
        select jsonb_build_object('kind', 'auto', 'text', count(*) || ' automatic WhatsApp message' || case when count(*) = 1 then '' else 's' end
                 || ' failed today — see the WhatsApp tab.')
          from wa_auto_messages m where m.business_id = p_business and m.status = 'failed' and m.created_at >= v_day_start
         having count(*) > 0
        union all
        -- 0269: a manager's change to wards, beds or bed charges, for the owner to approve.
        select jsonb_build_object('kind', 'beds', 'text', count(*) || ' change' || case when count(*) = 1 then '' else 's' end
                 || ' to wards or bed charges waiting for your approval.')
          from ward_change_requests r where r.business_id = p_business and r.status = 'pending' and v_role = 'owner'
         having count(*) > 0
        union all
        select jsonb_build_object('kind', 'lab', 'text', count(*) || ' lab report' || case when count(*) = 1 then ' is' else 's are' end
                 || ' ready and waiting to be signed.')
          from lab_orders o where o.business_id = p_business and o.status = 'ready' and coalesce(b.lab_module, false)
         having count(*) > 0
      ) s));
  end if;

  return v_out;
end $$;
revoke all on function sehat_today(uuid) from public, anon;
grant execute on function sehat_today(uuid) to authenticated;

notify pgrst, 'reload schema';
