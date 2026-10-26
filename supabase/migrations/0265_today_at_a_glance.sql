-- ============================================================================
-- 0265 — Today, at a glance
-- ============================================================================
-- The dashboard's Today tab was a grid of every slot in the day — the whole
-- clinic's hours, not any doctor's — that could not be clicked and told you
-- nothing about who was coming. It is now "what needs attention right now",
-- in one call:
--
--   sehat_today(p_business) → jsonb
--     doctors     each doctor with today's appointments (time, patient,
--                 status, their token if they have arrived), how many free
--                 times are left today and the next one. A doctor sees only
--                 their own; everyone else sees every doctor.
--     next        when nothing is booked today: the next appointment.
--     opd         today's tokens: waiting, with the doctor, seen.
--     follow_ups  due today, and missed in the last 7 days.
--     ipd         beds, occupied, admitted today, discharges due today.
--     lab         orders by stage, home collections, reported today.
--     pharmacy    sales today, items low on stock, batches expiring in 30 days.
--     money       billed and collected today, unpaid bills — owner and
--                 manager only.
--     alerts      the plan ending within 7 days, the WhatsApp wallet low,
--                 automatic messages that failed today.
--   Each section is there only when its module is on.
--
-- Booking from a doctor's "Book" button uses the desk booking of 0152
-- (sehat_desk_book), into the same free windows.
-- ============================================================================

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
