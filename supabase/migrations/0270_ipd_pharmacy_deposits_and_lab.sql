-- ============================================================================
-- 0270 — IPD: medicines from the hospital's pharmacy onto the patient's bill,
--         deposits with a running balance, and lab tests on the IPD bill
-- ============================================================================
-- Decided 27 Oct 2026. Before this the drug chart, the pharmacy and the bill
-- were three separate things: a dose given took nothing from stock and
-- charged nothing; a pharmacy bill could not be attached to an admission; and
-- money taken during a stay showed only as a per-patient balance.
--
-- 1. LAB. A test ordered for a patient who is admitted here is charged to the
--    admission (patient_charges.admission_id), so it comes on the IPD bill —
--    it was charged to the patient only and sat unbilled. Unbilled lab charges
--    of patients admitted now are moved onto their stay.
--
-- 2. WARD → PHARMACY. The ward sends a request (pharmacy_ward_requests) for an
--    admitted patient; the pharmacy issues it from stock — earliest expiry
--    first, through the counter's own sehat_pharmacy_issue_bill — and each
--    line goes on the admission as a 'medicine' charge. Nothing is paid at the
--    counter: the issue is marked with the admission (pharmacy_bills.
--    admission_id), counts as no due at the counter, and is paid with the
--    hospital bill. Cancelling an issue not yet billed puts the stock back and
--    takes the charges off. Inside the IPD bill medicines carry no separate
--    GST (treated as part of the treatment).
--
-- 3. DEPOSITS. Money taken during a stay was already counted by the final IPD
--    bill. Now the admission shows its running balance — deposits, what has
--    been used (charges so far, plus the bed days not yet posted), and what is
--    left — and warns when it falls below the hospital's own level
--    (businesses.deposit_low_at, default ₹2,000, set by the owner). The Today
--    tab says how many deposits are low. Issuing medicines never waits on the
--    deposit: the counter is told, not stopped.
-- ============================================================================

-- ── 1. Lab tests during a stay go on the stay ──────────────────────────────
create or replace function sehat_charge_to_open_stay()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.admission_id is null and new.category = 'lab' then
    select a.id into new.admission_id from admissions a
     where a.business_id = new.business_id and a.patient_member_id = new.patient_member_id and a.status = 'admitted'
     order by a.admitted_at desc limit 1;
  end if;
  return new;
end $$;
drop trigger if exists charge_to_open_stay on patient_charges;
create trigger charge_to_open_stay before insert on patient_charges
  for each row execute function sehat_charge_to_open_stay();

update patient_charges c set admission_id = a.id
  from admissions a
 where c.admission_id is null and c.bill_id is null and c.category = 'lab'
   and a.business_id = c.business_id and a.patient_member_id = c.patient_member_id and a.status = 'admitted'
   and c.charged_on >= (a.admitted_at at time zone 'Asia/Kolkata')::date;

-- ── 2. Deposits ─────────────────────────────────────────────────────────────
alter table businesses add column if not exists deposit_low_at numeric(12,2) not null default 2000;

create or replace function sehat_set_deposit_low_at(p_business uuid, p_amount numeric)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or coalesce(sehat_caller_role(p_business) = 'owner', false)) then
    raise exception 'Only the owner can set this.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 10000000 then raise exception 'Enter an amount in rupees.' using errcode = '22023'; end if;
  update businesses set deposit_low_at = p_amount where id = p_business;
end $$;
revoke all on function sehat_set_deposit_low_at(uuid, numeric) from public, anon;
grant execute on function sehat_set_deposit_low_at(uuid, numeric) to authenticated;

-- What a stay has used so far: its charges, plus bed days not yet posted
-- (the same arithmetic as sehat_post_bed_charges, read-only).
create or replace function sehat_admission_used(p_admission uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(c.amount) from patient_charges c where c.admission_id = p_admission and c.category <> 'bed'), 0)
       + greatest(
           coalesce((select sum(c.amount) from patient_charges c where c.admission_id = p_admission and c.category = 'bed'), 0),
           coalesce((select sum(greatest(1, ceil(extract(epoch from coalesce(bs.to_at, a.discharged_at, now()) - bs.from_at) / 86400.0))
                                * coalesce(bs.daily_charge_snapshot, 0))
                       from admission_bed_stays bs join admissions a on a.id = bs.admission_id
                      where bs.admission_id = p_admission), 0));
$$;
revoke all on function sehat_admission_used(uuid) from public, anon, authenticated;

create or replace function sehat_admission_money(p_admission uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a admissions;
  v_dep numeric;
  v_used numeric;
  v_low numeric;
begin
  select * into a from admissions where id = p_admission;
  if a.id is null then raise exception 'No such admission.' using errcode = 'P0002'; end if;
  if not sehat_caller_owns_business(a.business_id) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  select coalesce(sum(amount), 0) into v_dep from patient_payments where admission_id = p_admission;
  v_used := sehat_admission_used(p_admission);
  select deposit_low_at into v_low from businesses where id = a.business_id;
  return jsonb_build_object('deposits', v_dep, 'used', v_used, 'left', v_dep - v_used, 'low_at', v_low,
    'low', a.status = 'admitted' and v_dep - v_used < v_low,
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p.method, 'on', p.received_on,
                   'by', p.received_by_name, 'kind', p.kind) order by p.created_at), '[]'::jsonb)
                   from patient_payments p where p.admission_id = p_admission));
end $$;
revoke all on function sehat_admission_money(uuid) from public, anon;
grant execute on function sehat_admission_money(uuid) to authenticated;

-- Every admitted patient's deposit left, for the bed board and Today.
create or replace function sehat_deposit_board(p_business uuid)
returns table (admission_id uuid, deposits numeric, used numeric, left_amount numeric, low boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_low numeric;
begin
  if not sehat_caller_owns_business(p_business) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  select deposit_low_at into v_low from businesses where id = p_business;
  return query
    select a.id, d.dep, u.used, d.dep - u.used, d.dep - u.used < v_low
      from admissions a
      cross join lateral (select coalesce(sum(p.amount), 0)::numeric dep from patient_payments p where p.admission_id = a.id) d
      cross join lateral (select sehat_admission_used(a.id) used) u
     where a.business_id = p_business and a.status = 'admitted';
end $$;
revoke all on function sehat_deposit_board(uuid) from public, anon;
grant execute on function sehat_deposit_board(uuid) to authenticated;

-- ── 3. Ward → pharmacy ──────────────────────────────────────────────────────
alter table pharmacy_bills add column if not exists admission_id uuid references admissions(id) on delete set null;
create index if not exists pharmacy_bills_admission_idx on pharmacy_bills (admission_id) where admission_id is not null;
alter table patient_charges add column if not exists pharmacy_bill_id uuid references pharmacy_bills(id) on delete set null;

drop view if exists pharmacy_bill_detail;
create view pharmacy_bill_detail with (security_invoker = true) as
  select b.*,
         coalesce(p.paid, 0) as paid,
         coalesce(r.credited, 0) as credited,
         coalesce(r.refunded, 0) as refunded,
         -- 0270: medicines issued to an admitted patient go on the hospital bill, not the counter's dues.
         case when b.status = 'cancelled' or b.admission_id is not null then 0
              else b.net_payable - coalesce(r.credited, 0) - coalesce(p.paid, 0) + coalesce(r.refunded, 0) end as balance_due,
         -- paid | partly_paid | unpaid | cancelled — what the counter and the
         -- manager filter on.
         case when b.status = 'cancelled' then 'cancelled'
              when b.admission_id is not null then 'on_ipd_bill'
              when b.net_payable - coalesce(r.credited, 0) - coalesce(p.paid, 0) + coalesce(r.refunded, 0) <= 0 then 'paid'
              when coalesce(p.paid, 0) - coalesce(r.refunded, 0) > 0 then 'partly_paid'
              else 'unpaid' end as payment_status,
         coalesce((select jsonb_agg(to_jsonb(bi) order by bi.sort_order) from pharmacy_bill_items bi where bi.bill_id = b.id), '[]'::jsonb) as items,
         coalesce((select jsonb_agg(jsonb_build_object('amount', pp.amount, 'method', pp.method, 'reference', pp.reference,
                                                       'received_at', pp.received_at, 'received_by_name', pp.received_by_name) order by pp.received_at)
                     from pharmacy_payments pp where pp.bill_id = b.id), '[]'::jsonb) as payments,
         coalesce((select jsonb_agg(to_jsonb(pr) - 'business_id' order by pr.created_at)
                     from pharmacy_returns pr where pr.bill_id = b.id), '[]'::jsonb) as returns
    from pharmacy_bills b
    left join (select bill_id, sum(amount) as paid from pharmacy_payments group by bill_id) p on p.bill_id = b.id
    left join (select bill_id, sum(credit_amount) as credited, sum(refund_amount) as refunded
                 from pharmacy_returns group by bill_id) r on r.bill_id = b.id;

grant select on pharmacy_bill_detail to authenticated;

create table if not exists pharmacy_ward_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  admission_id uuid not null references admissions(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  -- [{ "name": "Inj. Ceftriaxone 1 g", "qty": "3", "order_id": "<drug chart order>" }]
  items jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'requested' check (status in ('requested', 'issued', 'cancelled')),
  requested_by uuid,
  requested_by_name text,
  issued_bill_id uuid references pharmacy_bills(id) on delete set null,
  issued_at timestamptz,
  issued_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists pharmacy_ward_requests_open_idx on pharmacy_ward_requests (business_id, created_at) where status = 'requested';
alter table pharmacy_ward_requests enable row level security;
revoke all on pharmacy_ward_requests from anon;
grant select on pharmacy_ward_requests to authenticated;
drop policy if exists clinic_reads_ward_requests on pharmacy_ward_requests;
create policy clinic_reads_ward_requests on pharmacy_ward_requests for select to authenticated
  using (sehat_caller_owns_business(business_id));

create or replace function sehat_pharmacy_ward_request(p_admission uuid, p_items jsonb, p_note text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  a admissions;
  v_id uuid;
begin
  select * into a from admissions where id = p_admission;
  if a.id is null or a.status <> 'admitted' then raise exception 'That patient is not admitted.' using errcode = 'P0001'; end if;
  if not sehat_caller_owns_business(a.business_id) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one medicine.' using errcode = '22023';
  end if;
  insert into pharmacy_ward_requests (business_id, admission_id, patient_member_id, items, note, requested_by, requested_by_name)
  values (a.business_id, a.id, a.patient_member_id, p_items, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
          coalesce(sehat_caller_staff_name(a.business_id), 'Ward'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function sehat_pharmacy_ward_request(uuid, jsonb, text) from public, anon;
grant execute on function sehat_pharmacy_ward_request(uuid, jsonb, text) to authenticated;

create or replace function sehat_pharmacy_ward_request_cancel(p_request uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r pharmacy_ward_requests;
begin
  select * into r from pharmacy_ward_requests where id = p_request for update;
  if r.id is null then raise exception 'No such request.' using errcode = 'P0002'; end if;
  if not sehat_caller_owns_business(r.business_id) then raise exception 'Not your clinic.' using errcode = '42501'; end if;
  if r.status <> 'requested' then raise exception 'That request has already been dealt with.' using errcode = 'P0001'; end if;
  update pharmacy_ward_requests set status = 'cancelled' where id = r.id;
end $$;
revoke all on function sehat_pharmacy_ward_request_cancel(uuid) from public, anon;
grant execute on function sehat_pharmacy_ward_request_cancel(uuid) to authenticated;

-- Issue medicines to an admitted patient: stock out, and on the admission's account.
create or replace function sehat_pharmacy_issue_to_admission(p_admission uuid, p_lines jsonb, p_request uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  a admissions;
  v_bill uuid;
  v_no text;
  v_total numeric;
  i record;
begin
  select * into a from admissions where id = p_admission;
  if a.id is null or a.status <> 'admitted' then raise exception 'That patient is not admitted.' using errcode = 'P0001'; end if;
  perform sehat_pharmacy_check(a.business_id, false);

  -- The counter's own issue: stock, batches, earliest expiry first. No payment.
  v_bill := sehat_pharmacy_issue_bill(a.business_id, p_lines, a.patient_member_id, null, null, null, 0, null, null);
  update pharmacy_bills set admission_id = a.id where id = v_bill returning bill_no, net_payable into v_no, v_total;

  -- One charge per medicine on the admission. Medicines inside the IPD bill
  -- carry no separate GST.
  for i in
    select bi.name, sum(bi.quantity) qty, max(bi.unit_mrp) mrp, sum(bi.amount) amount
      from pharmacy_bill_items bi where bi.bill_id = v_bill group by bi.name, bi.item_id order by min(bi.sort_order)
  loop
    insert into patient_charges (business_id, patient_member_id, admission_id, category, description,
                                 quantity, unit_price, amount, charged_on, recorded_by, pharmacy_bill_id)
    values (a.business_id, a.patient_member_id, a.id, 'medicine', i.name || ' (' || v_no || ')',
            i.qty, i.mrp, i.amount, (now() at time zone 'Asia/Kolkata')::date, sehat_caller_practitioner_id(), v_bill);
  end loop;

  if p_request is not null then
    update pharmacy_ward_requests set status = 'issued', issued_bill_id = v_bill, issued_at = now(),
           issued_by_name = sehat_caller_staff_name(a.business_id)
     where id = p_request and admission_id = a.id and status = 'requested';
  end if;

  return jsonb_build_object('bill_id', v_bill, 'bill_no', v_no, 'amount', v_total,
                            'money', sehat_admission_money(a.id));
end $$;
revoke all on function sehat_pharmacy_issue_to_admission(uuid, jsonb, uuid) from public, anon;
grant execute on function sehat_pharmacy_issue_to_admission(uuid, jsonb, uuid) to authenticated;

-- Take back an issue that is not on a bill yet: stock back, charges off.
create or replace function sehat_pharmacy_cancel_ipd_issue(p_bill uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  b pharmacy_bills;
  v_billed text;
begin
  select * into b from pharmacy_bills where id = p_bill;
  if b.id is null or b.admission_id is null then raise exception 'That is not a ward issue.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(b.business_id, false);
  select pb.bill_no into v_billed from patient_charges c join patient_bills pb on pb.id = c.bill_id and pb.status = 'issued'
   where c.pharmacy_bill_id = p_bill limit 1;
  if v_billed is not null then
    raise exception 'These medicines are already on bill %. Cancel that bill first.', v_billed using errcode = 'P0001';
  end if;
  delete from patient_charges where pharmacy_bill_id = p_bill and bill_id is null;
  perform sehat_pharmacy_cancel_bill(p_bill, coalesce(nullif(btrim(p_reason), ''), 'Returned from the ward'));
  update pharmacy_ward_requests set status = 'requested', issued_bill_id = null, issued_at = null, issued_by_name = null
   where issued_bill_id = p_bill;
end $$;
revoke all on function sehat_pharmacy_cancel_ipd_issue(uuid, text) from public, anon;
grant execute on function sehat_pharmacy_cancel_ipd_issue(uuid, text) to authenticated;

-- ── 4. Today: deposits running low ──────────────────────────────────────────
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
        -- 0270: admitted patients whose deposit is running low.
        select jsonb_build_object('kind', 'deposit', 'text', count(*) || ' admitted patient' || case when count(*) = 1 then '''s deposit is' else 's'' deposits are' end
                 || ' running low — take more.')
          from sehat_deposit_board(p_business) d where d.low
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
