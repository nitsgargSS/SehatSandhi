-- ============================================================================
-- 0288 — The doctor's orders reach the pharmacy and the lab, and come back
-- ============================================================================
-- Decided 29 Oct 2026 — phase 1 of "the full hospital flow" (plan doc). The
-- pieces were there; what was missing was the hand-over between them.
--
-- 1. PHARMACY. An OPD prescription now arrives at the pharmacy by itself, the
--    way a ward request does (0270). Written at a clinic with a pharmacy, it is
--    "waiting" (prescriptions.pharmacy_status) until the counter dispenses it —
--    a pharmacy bill made from it marks it "dispensed", cancelling that bill
--    puts it back — or marks it "not needed" (the patient buys elsewhere). The
--    pharmacists get a phone notification. Prescriptions of the last seven days
--    are listed; older ones still dispense from the patient as before.
--
-- 2. LAB. An order from a doctor (or a patient's app) is new until the lab
--    accepts it (lab_orders.accepted_at) — Accept, or simply collecting the
--    sample. An order made at the lab's own desk is accepted as it is made. The
--    lab technicians get a phone notification for each new one.
--
-- 3. BACK TO THE DOCTOR. When a report is signed, the doctor who ordered it is
--    told — a phone notification, and "Reports ready" on their Today tab until
--    they open it (lab_orders.doctor_seen_at). A corrected report (a new
--    version) tells them again.
-- ============================================================================

-- ── 1. Prescriptions at the pharmacy ────────────────────────────────────────
alter table prescriptions add column if not exists pharmacy_status text;
alter table prescriptions add column if not exists pharmacy_status_at timestamptz;
alter table prescriptions add column if not exists pharmacy_status_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prescriptions_pharmacy_status_check') then
    alter table prescriptions add constraint prescriptions_pharmacy_status_check
      check (pharmacy_status is null or pharmacy_status in ('waiting', 'dispensed', 'not_needed'));
  end if;
end $$;
create index if not exists prescriptions_pharmacy_waiting_idx on prescriptions (business_id, issued_at desc) where pharmacy_status = 'waiting';

-- The phones of a business's staff in some roles.
create or replace function sehat_staff_users(p_business uuid, p_roles text[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.auth_uid), '{}')
    from business_practitioners bp
    join practitioners p on p.id = bp.practitioner_id
   where bp.business_id = p_business and bp.role = any (p_roles)
     and bp.status <> 'suspended' and p.auth_uid is not null;
$$;
revoke all on function sehat_staff_users(uuid, text[]) from public, anon, authenticated;

-- A first name and the initial of the second, as the other notifications do.
create or replace function sehat_short_name(p_name text)
returns text language sql immutable as $$
  select coalesce(nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), ''), 'Patient')
         || coalesce(' ' || left(nullif(split_part(btrim(coalesce(p_name, '')), ' ', 2), ''), 1) || '.', '');
$$;

create or replace function sehat_rx_to_pharmacy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pharmacy_status is null and exists (select 1 from businesses b where b.id = new.business_id and b.pharmacy_module) then
    new.pharmacy_status := 'waiting';
    new.pharmacy_status_at := now();
  end if;
  return new;
end $$;
drop trigger if exists rx_to_pharmacy on prescriptions;
create trigger rx_to_pharmacy before insert on prescriptions
  for each row execute function sehat_rx_to_pharmacy();

create or replace function sehat_push_rx_to_pharmacy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pharmacy_status = 'waiting' then
    perform sehat_queue_push('pharmacy_rx', new.business_id,
      sehat_staff_users(new.business_id, array['pharmacist']),
      'Prescription for the pharmacy',
      sehat_short_name(new.patient_name) || ' · ' || new.prescription_no || ' · ' || coalesce(new.prescriber_name, ''),
      jsonb_build_object('kind', 'pharmacy_rx', 'prescription_id', new.id));
  end if;
  return null;
exception when others then return null;   -- a notification never blocks a prescription
end $$;
drop trigger if exists push_rx_to_pharmacy on prescriptions;
create trigger push_rx_to_pharmacy after insert on prescriptions
  for each row execute function sehat_push_rx_to_pharmacy();

-- A bill made from a prescription dispenses it; cancelling the last such bill
-- puts it back to waiting.
create or replace function sehat_rx_dispensed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_any boolean;
begin
  if new.prescription_id is null then return null; end if;
  select exists (select 1 from pharmacy_bills where prescription_id = new.prescription_id and status = 'issued') into v_any;
  update prescriptions
     set pharmacy_status = case when v_any then 'dispensed' else 'waiting' end,
         pharmacy_status_at = now(),
         pharmacy_status_by = case when v_any then new.issued_by_name else pharmacy_status_by end
   where id = new.prescription_id
     and pharmacy_status is distinct from case when v_any then 'dispensed' else 'waiting' end
     and (v_any or pharmacy_status = 'dispensed');
  return null;
end $$;
drop trigger if exists rx_dispensed on pharmacy_bills;
create trigger rx_dispensed after insert or update of status on pharmacy_bills
  for each row execute function sehat_rx_dispensed();

-- Recent prescriptions at a pharmacy clinic that nobody has dispensed start out waiting.
update prescriptions rx set pharmacy_status = 'waiting', pharmacy_status_at = now()
 where rx.pharmacy_status is null and rx.status = 'issued' and rx.issued_at > now() - interval '2 days'
   and exists (select 1 from businesses b where b.id = rx.business_id and b.pharmacy_module)
   and not exists (select 1 from pharmacy_bills pb where pb.prescription_id = rx.id and pb.status = 'issued');
update prescriptions rx set pharmacy_status = 'dispensed', pharmacy_status_at = now()
 where rx.pharmacy_status is null
   and exists (select 1 from pharmacy_bills pb where pb.prescription_id = rx.id and pb.status = 'issued');

create or replace function sehat_pharmacy_rx_waiting(p_business uuid)
returns table (prescription_id uuid, prescription_no text, issued_at timestamptz, prescriber_name text,
               patient_member_id uuid, patient_name text, phone text, mrn text, items jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_pharmacy_check(p_business, false);
  return query
    select rx.id, rx.prescription_no, rx.issued_at, rx.prescriber_name,
           rx.patient_member_id, m.full_name, pa.phone, bp.mrn,
           (select jsonb_agg(jsonb_build_object('drug_name', pi.drug_name, 'strength', pi.strength, 'form', pi.form,
                                                'dosage', pi.dosage, 'duration', pi.duration, 'quantity', pi.quantity)
                             order by pi.sort_order)
              from prescription_items pi where pi.prescription_id = rx.id)
      from prescriptions rx
      join patient_members m on m.id = rx.patient_member_id
      join patients pa on pa.id = m.patient_id
      left join business_patients bp on bp.business_id = rx.business_id and bp.patient_member_id = rx.patient_member_id
     where rx.business_id = p_business and rx.status = 'issued' and rx.pharmacy_status = 'waiting'
       and rx.issued_at > now() - interval '7 days'
       and exists (select 1 from prescription_items pi where pi.prescription_id = rx.id)
     order by rx.issued_at;
end $$;
revoke all on function sehat_pharmacy_rx_waiting(uuid) from public, anon;
grant execute on function sehat_pharmacy_rx_waiting(uuid) to authenticated;

-- "Not needed" (bought elsewhere), or back to waiting.
create or replace function sehat_pharmacy_rx_mark(p_prescription uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_business uuid;
begin
  if p_status not in ('not_needed', 'waiting') then raise exception 'Not a status the counter sets.' using errcode = '22023'; end if;
  select business_id into v_business from prescriptions where id = p_prescription;
  if v_business is null then raise exception 'No such prescription.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(v_business, false);
  update prescriptions set pharmacy_status = p_status, pharmacy_status_at = now(),
         pharmacy_status_by = sehat_mo_actor_name(v_business)
   where id = p_prescription and pharmacy_status is distinct from 'dispensed';
end $$;
revoke all on function sehat_pharmacy_rx_mark(uuid, text) from public, anon;
grant execute on function sehat_pharmacy_rx_mark(uuid, text) to authenticated;


-- ── 2. The lab accepts an order ─────────────────────────────────────────────
alter table lab_orders add column if not exists accepted_at timestamptz;
alter table lab_orders add column if not exists accepted_by_name text;
alter table lab_orders add column if not exists doctor_seen_at timestamptz;

-- Orders already under way count as accepted.
update lab_orders set accepted_at = coalesce(collected_at, created_at)
 where accepted_at is null and (source = 'desk' or status <> 'ordered');

create or replace function sehat_lab_order_accept_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'desk' and new.accepted_at is null then
      new.accepted_at := now(); new.accepted_by_name := new.created_by_name;
    end if;
  elsif new.accepted_at is null and new.status <> 'ordered' then
    -- Collecting the sample (or anything further) is accepting it.
    new.accepted_at := now(); new.accepted_by_name := coalesce(new.collected_by_name, sehat_mo_actor_name(new.business_id));
  end if;
  return new;
end $$;
drop trigger if exists lab_order_accept_guard on lab_orders;
create trigger lab_order_accept_guard before insert or update on lab_orders
  for each row execute function sehat_lab_order_accept_guard();

create or replace function sehat_push_lab_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_tests text;
begin
  if new.accepted_at is not null then return null; end if;
  select full_name into v_name from patient_members where id = new.patient_member_id;
  perform sehat_queue_push('lab_order', new.business_id,
    sehat_staff_users(new.business_id, array['lab_technician']),
    case when new.priority = 'urgent' then 'URGENT test order' else 'New test order' end,
    sehat_short_name(v_name) || ' · ' || new.order_no || coalesce(' · ' || new.ordered_by_name, ''),
    jsonb_build_object('kind', 'lab_order', 'order_id', new.id));
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_lab_order on lab_orders;
create trigger push_lab_order after insert on lab_orders
  for each row execute function sehat_push_lab_order();

create or replace function sehat_lab_accept(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_business uuid;
begin
  select business_id into v_business from lab_orders where id = p_order;
  if v_business is null then raise exception 'No such order.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(v_business, 'results');
  update lab_orders set accepted_at = now(), accepted_by_name = sehat_mo_actor_name(v_business)
   where id = p_order and accepted_at is null and status <> 'cancelled';
end $$;
revoke all on function sehat_lab_accept(uuid) from public, anon;
grant execute on function sehat_lab_accept(uuid) to authenticated;

-- lab_order_detail is o.* — made again so it carries the new columns.
drop view if exists lab_order_detail;
create view lab_order_detail as
  select o.*,
         pm.full_name as patient_name, pm.age_years as patient_age, pm.gender as patient_gender, pa.phone as patient_phone,
         bp.mrn,
         (select count(*) from lab_order_items i where i.order_id = o.id)::integer as item_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'pending')::integer as pending_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'entered')::integer as entered_count,
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'package_name', i.package_name, 'status', i.status,
                                                       'report_kind', i.report_kind, 'test_id', i.test_id, 'category', i.category,
                                                       'entered_by_name', i.entered_by_name, 'entered_at', i.entered_at) order by i.sort_order)
                     from lab_order_items i where i.order_id = o.id), '[]'::jsonb) as items,
         (select jsonb_build_object('id', r.id, 'report_no', r.report_no, 'version', r.version, 'token', r.public_token,
                                    'approved_by_name', r.approved_by_name, 'approved_at', r.approved_at,
                                    'sent_at', r.sent_at, 'sent_channels', r.sent_channels, 'send_error', r.send_error)
            from lab_reports r where r.order_id = o.id order by r.version desc limit 1) as latest_report
    from lab_orders o
    join patient_members pm on pm.id = o.patient_member_id
    join patients pa on pa.id = pm.patient_id
    left join business_patients bp on bp.business_id = o.business_id and bp.patient_member_id = o.patient_member_id
   where sehat_caller_owns_business(o.business_id);
grant select on lab_order_detail to authenticated;


-- ── 3. The report goes back to the doctor ───────────────────────────────────
create or replace function sehat_push_lab_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare o lab_orders; v_doc uuid; v_name text; v_tests text; v_abn integer;
begin
  select * into o from lab_orders where id = new.order_id;
  if o.id is null or o.ordered_by is null then return null; end if;
  update lab_orders set doctor_seen_at = null where id = o.id;
  select auth_uid into v_doc from practitioners where id = o.ordered_by;
  select full_name into v_name from patient_members where id = o.patient_member_id;
  select string_agg(i.name, ', ' order by i.sort_order) into v_tests from lab_order_items i where i.order_id = o.id;
  select count(*) into v_abn from lab_results r join lab_order_items i on i.id = r.order_item_id
   where i.order_id = o.id and r.flag in ('H', 'L');
  perform sehat_queue_push('lab_report', o.business_id, array[v_doc],
    'Report ready' || case when v_abn > 0 then ' — ' || v_abn || ' out of range' else '' end,
    sehat_short_name(v_name) || ' · ' || left(coalesce(v_tests, ''), 120),
    jsonb_build_object('kind', 'lab_report', 'order_id', o.id, 'patient_member_id', o.patient_member_id));
  return null;
exception when others then return null;
end $$;
drop trigger if exists push_lab_report on lab_reports;
create trigger push_lab_report after insert on lab_reports
  for each row execute function sehat_push_lab_report();

-- The caller's practitioner row at this business, if they have one.
create or replace function sehat_my_practitioner_id(p_business uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from practitioners p
    join business_practitioners bp on bp.practitioner_id = p.id and bp.business_id = p_business
   where p.auth_uid = auth.uid() limit 1;
$$;
revoke all on function sehat_my_practitioner_id(uuid) from public, anon;
grant execute on function sehat_my_practitioner_id(uuid) to authenticated;

-- Reports signed in the last 30 days for tests I ordered, not yet opened.
create or replace function sehat_my_reports_ready(p_business uuid)
returns table (order_id uuid, order_no text, patient_member_id uuid, patient_name text,
               tests text, approved_at timestamptz, report_token uuid, out_of_range integer)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := sehat_my_practitioner_id(p_business);
begin
  if v_me is null or not sehat_caller_is_clinical(p_business) then return; end if;
  return query
    select o.id, o.order_no, o.patient_member_id, m.full_name,
           (select string_agg(i.name, ', ' order by i.sort_order) from lab_order_items i where i.order_id = o.id),
           r.at, r.tok,
           (select count(*)::integer from lab_results x join lab_order_items i on i.id = x.order_item_id
             where i.order_id = o.id and x.flag in ('H', 'L'))
      from lab_orders o
      join patient_members m on m.id = o.patient_member_id
      join lateral (select lr.approved_at as at, lr.public_token as tok from lab_reports lr
                     where lr.order_id = o.id order by lr.version desc limit 1) r on true
     where o.business_id = p_business and o.ordered_by = v_me and o.doctor_seen_at is null
       and o.status <> 'cancelled' and r.at > now() - interval '30 days'
     order by r.at desc
     limit 50;
end $$;
revoke all on function sehat_my_reports_ready(uuid) from public, anon;
grant execute on function sehat_my_reports_ready(uuid) to authenticated;

create or replace function sehat_lab_report_seen(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o lab_orders;
begin
  select * into o from lab_orders where id = p_order;
  if o.id is null or o.ordered_by is distinct from sehat_my_practitioner_id(o.business_id) then return; end if;
  update lab_orders set doctor_seen_at = now() where id = p_order and doctor_seen_at is null;
end $$;
revoke all on function sehat_lab_report_seen(uuid) from public, anon;
grant execute on function sehat_lab_report_seen(uuid) to authenticated;

notify pgrst, 'reload schema';
