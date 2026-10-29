-- ============================================================================
-- 0290 — Tests sent to another lab on Sehatsandhi, and the report back
-- ============================================================================
-- Decided 29 Oct 2026 — phase 3 of "the full hospital flow" (plan doc). A
-- hospital with no lab or scanner of its own (or one that does not do this
-- test) sends the order to a pathology lab or diagnostic centre on
-- Sehatsandhi:
--
--   1. The doctor chooses the lab, then tests from that lab's own list at its
--      own prices, and who pays:
--        patient   — at the lab, as any patient of the lab;
--        hospital  — on the hospital's bill (on the stay if admitted); the
--                    hospital settles with the lab (phase 4's ledger).
--   2. The order lands in the lab as an order of its own (source 'referral'),
--      new until the lab accepts it (0288) — or declines it, with a reason the
--      doctor is told. The patient joins the lab's list (source 'referral').
--   3. The lab collects, tests, enters results and signs as for any order; the
--      report goes to the patient as always, and back to the doctor who sent
--      it: Reports ready on their Today tab and a phone notification (0288),
--      and under the patient's Lab tests at the hospital.
--
-- The lab sees what any lab sees of its patient (name, age, sex, phone) and
-- the doctor's note; the hospital sees the order's progress and the report.
-- Which doctor sent it is recorded; nothing is paid to a doctor (decided 29
-- Oct: business to business only).
-- ============================================================================

alter table lab_orders drop constraint if exists lab_orders_source_check;
alter table lab_orders add constraint lab_orders_source_check check (source in ('desk', 'doctor', 'app', 'whatsapp', 'referral'));

alter table lab_orders add column if not exists referral_from_business uuid references businesses(id) on delete set null;
alter table lab_orders add column if not exists referral_from_name text;
alter table lab_orders add column if not exists referral_payer text check (referral_payer is null or referral_payer in ('patient', 'hospital'));
alter table lab_orders add column if not exists referral_amount numeric(12,2);
alter table lab_orders add column if not exists referral_admission_id uuid references admissions(id) on delete set null;
create index if not exists lab_orders_referral_from_idx on lab_orders (referral_from_business, created_at desc) where referral_from_business is not null;

-- ── Which labs, and their tests ─────────────────────────────────────────────
-- Labs and diagnostic centres on Sehatsandhi that take orders: listed and
-- running a lab. Nearest first by city and PIN; a kind narrows to labs that do it.
create or replace function sehat_referral_labs(p_business uuid, p_kind text default null, p_query text default null)
returns table (id uuid, name text, city text, address text, phone text, categories text[], tests integer, same_city boolean)
language plpgsql stable security definer set search_path = public as $$
declare me businesses;
begin
  if not sehat_caller_is_clinical(p_business) then raise exception 'Only clinical staff send tests out.' using errcode = '42501'; end if;
  select * into me from businesses bb where bb.id = p_business;
  return query
    select b.id, b.name, coalesce(b.own_city, b.own_district), b.address, b.phone, b.lab_categories,
           (select count(*)::integer from lab_tests t where t.business_id = b.id and t.is_active
              and (p_kind is null or t.category = p_kind
                   or (p_kind = 'imaging' and t.category in ('radiology', 'cardiology')))),
           (b.own_city is not distinct from me.own_city and b.own_city is not null)
      from businesses b
     where b.id <> p_business and b.status = 'active' and sehat_lab_on(b.id)
       and exists (select 1 from lab_tests t where t.business_id = b.id and t.is_active
                     and (p_kind is null or t.category = p_kind
                          or (p_kind = 'imaging' and t.category in ('radiology', 'cardiology'))))
       and (coalesce(btrim(p_query), '') = '' or b.name ilike '%' || btrim(p_query) || '%'
            or coalesce(b.own_city, '') ilike '%' || btrim(p_query) || '%')
     order by (b.own_city is not distinct from me.own_city and b.own_city is not null) desc,
              (b.own_pin_code is not distinct from me.own_pin_code) desc, b.name
     limit 40;
end $$;
revoke all on function sehat_referral_labs(uuid, text, text) from public, anon;
grant execute on function sehat_referral_labs(uuid, text, text) to authenticated;

-- A lab's tests and packages, at its prices — what the doctor chooses from.
create or replace function sehat_referral_lab_menu(p_business uuid, p_lab uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_caller_is_clinical(p_business) then raise exception 'Only clinical staff send tests out.' using errcode = '42501'; end if;
  if not sehat_lab_on(p_lab) then raise exception 'That lab is not taking orders.' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'tests', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
                                                            'department', t.department, 'price', t.price, 'tat_hours', t.tat_hours)
                                        order by t.category, t.name)
                         from lab_tests t where t.business_id = p_lab and t.is_active), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price) order by p.name)
                            from lab_packages p where p.business_id = p_lab and p.is_active), '[]'::jsonb));
end $$;
revoke all on function sehat_referral_lab_menu(uuid, uuid) from public, anon;
grant execute on function sehat_referral_lab_menu(uuid, uuid) to authenticated;


-- ── Sending ─────────────────────────────────────────────────────────────────
create or replace function sehat_lab_refer(
  p_business uuid, p_member uuid, p_lab uuid,
  p_test_ids uuid[], p_package_ids uuid[],
  p_payer text default 'patient', p_priority text default 'routine', p_note text default null,
  p_visit_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me businesses;
  lab businesses;
  v_doc uuid := sehat_my_practitioner_id(p_business);
  v_doc_name text := sehat_mo_actor_name(p_business);
  v_order uuid;
  v_no text;
  v_amount numeric;
  v_names text;
  v_adm uuid;
begin
  if not (sehat_caller_is_clinical(p_business) and sehat_caller_sees_patient(p_business, p_member)) then
    raise exception 'Only the clinical staff who see this patient can send tests out.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_patients where business_id = p_business and patient_member_id = p_member) then
    raise exception 'That patient is not registered here.' using errcode = 'P0002';
  end if;
  select * into me from businesses where id = p_business;
  select * into lab from businesses where id = p_lab;
  if lab.id is null or lab.id = p_business or lab.status <> 'active' or not sehat_lab_on(lab.id) then
    raise exception 'That lab is not taking orders on Sehatsandhi.' using errcode = 'P0001';
  end if;
  if coalesce(p_payer, '') not in ('patient', 'hospital') then raise exception 'Say who pays: the patient or the hospital.' using errcode = '22023'; end if;
  if p_visit_id is not null and not exists (select 1 from patient_visits v where v.id = p_visit_id and v.business_id = p_business and v.patient_member_id = p_member) then
    raise exception 'That visit is not this patient''s here.' using errcode = 'P0002';
  end if;

  -- The patient joins the lab's list.
  insert into business_patients (business_id, patient_member_id, source)
  values (p_lab, p_member, 'referral')
  on conflict do nothing;

  v_order := sehat_lab_order_insert(p_lab, p_member, p_test_ids, p_package_ids, null, 'lab', null,
    p_priority, p_note, v_doc_name || ', ' || me.name,
    null, null, 'referral', v_doc, v_doc_name, null, auth.uid(), v_doc_name || ' (' || me.name || ')');
  select order_no into v_no from lab_orders where id = v_order;

  -- What the lab charges for it, at its own prices.
  select coalesce(sum(c.amount), 0) into v_amount from patient_charges c
   where c.business_id = p_lab and c.patient_member_id = p_member and c.category = 'lab'
     and c.description like '%(' || v_no || ')' and c.bill_id is null;
  select string_agg(i.name, ', ' order by i.sort_order) into v_names from lab_order_items i where i.order_id = v_order;
  select a.id into v_adm from admissions a where a.business_id = p_business and a.patient_member_id = p_member and a.status = 'admitted' limit 1;

  update lab_orders set referral_from_business = p_business, referral_from_name = me.name, referral_payer = p_payer,
         referral_amount = v_amount, referral_admission_id = case when p_payer = 'hospital' then v_adm end
   where id = v_order;

  -- The hospital pays: nothing to pay at the lab; the tests go on the
  -- hospital's bill (on the stay when the patient is admitted).
  if p_payer = 'hospital' then
    delete from patient_charges c where c.business_id = p_lab and c.patient_member_id = p_member and c.category = 'lab'
       and c.description like '%(' || v_no || ')' and c.bill_id is null;
    insert into patient_charges (business_id, patient_member_id, admission_id, visit_id, category, description, quantity, unit_price, amount,
                                 charged_on, recorded_by)
    values (p_business, p_member, v_adm, p_visit_id, 'lab',
            left('Tests at ' || lab.name || ': ' || coalesce(v_names, '') , 200) || ' (' || v_no || ')',
            1, v_amount, v_amount, (now() at time zone 'Asia/Kolkata')::date, v_doc);
  end if;
  return v_order;
end $$;
revoke all on function sehat_lab_refer(uuid, uuid, uuid, uuid[], uuid[], text, text, text, uuid) from public, anon;
grant execute on function sehat_lab_refer(uuid, uuid, uuid, uuid[], uuid[], text, text, text, uuid) to authenticated;

-- Taking it back: the hospital before the lab has collected, or the lab
-- declining it. Charges not yet billed come off on both sides.
create or replace function sehat_lab_referral_withdraw(p_order uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o lab_orders; v_by_lab boolean; v_doc uuid; v_name text;
begin
  select * into o from lab_orders where id = p_order for update;
  if o.id is null or o.source <> 'referral' then raise exception 'That is not a referred order.' using errcode = 'P0002'; end if;
  v_by_lab := sehat_caller_owns_business(o.business_id);
  if v_by_lab then
    perform sehat_lab_check(o.business_id, 'staff');
  elsif not (o.referral_from_business is not null and sehat_caller_is_clinical(o.referral_from_business)) then
    raise exception 'Not your order.' using errcode = '42501';
  end if;
  if o.status <> 'ordered' then
    raise exception 'The sample is already collected — ask the lab.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why.' using errcode = '22023'; end if;
  if exists (select 1 from patient_charges c where c.category = 'lab' and c.description like '%(' || o.order_no || ')' and c.bill_id is not null
               and c.patient_member_id = o.patient_member_id and c.business_id in (o.business_id, o.referral_from_business)) then
    raise exception 'It is already on a bill — cancel the bill first.' using errcode = 'P0001';
  end if;
  delete from patient_charges c where c.category = 'lab' and c.description like '%(' || o.order_no || ')' and c.bill_id is null
     and c.patient_member_id = o.patient_member_id and c.business_id in (o.business_id, o.referral_from_business);
  update lab_orders set status = 'cancelled',
         cancelled_reason = (case when v_by_lab then 'Declined by the lab: ' else 'Withdrawn by ' || coalesce(o.referral_from_name, 'the hospital') || ': ' end) || btrim(p_reason)
   where id = p_order;
  -- A lab that declines tells the doctor who sent it.
  if v_by_lab and o.ordered_by is not null then
    select auth_uid into v_doc from practitioners where id = o.ordered_by;
    select full_name into v_name from patient_members where id = o.patient_member_id;
    perform sehat_queue_push('lab_report', o.referral_from_business, array[v_doc], 'Test order declined',
      sehat_short_name(v_name) || ' · ' || (select name from businesses where id = o.business_id) || ': ' || btrim(p_reason),
      jsonb_build_object('kind', 'lab_report', 'order_id', o.id, 'patient_member_id', o.patient_member_id));
  end if;
end $$;
revoke all on function sehat_lab_referral_withdraw(uuid, text) from public, anon;
grant execute on function sehat_lab_referral_withdraw(uuid, text) to authenticated;


-- ── The hospital's view ─────────────────────────────────────────────────────
create or replace function sehat_referred_tests(p_business uuid, p_member uuid default null)
returns table (order_id uuid, order_no text, lab_id uuid, lab_name text, lab_phone text, patient_member_id uuid, patient_name text,
               tests text, status text, priority text, payer text, amount numeric, ordered_by_name text, note text,
               created_at timestamptz, accepted_at timestamptz, collected_at timestamptz, cancelled_reason text,
               report_no text, report_token uuid, approved_at timestamptz, out_of_range integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_caller_is_clinical(p_business) or sehat_caller_is_business(p_business)) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  return query
    select o.id, o.order_no, b.id, b.name, b.phone, o.patient_member_id, m.full_name,
           (select string_agg(i.name, ', ' order by i.sort_order) from lab_order_items i where i.order_id = o.id),
           o.status, o.priority, o.referral_payer, o.referral_amount, o.ordered_by_name, o.notes,
           o.created_at, o.accepted_at, o.collected_at, o.cancelled_reason,
           r.report_no, r.public_token, r.approved_at,
           (select count(*)::integer from lab_results x join lab_order_items i on i.id = x.order_item_id
             where i.order_id = o.id and x.flag in ('H', 'L'))
      from lab_orders o
      join businesses b on b.id = o.business_id
      join patient_members m on m.id = o.patient_member_id
      left join lateral (select lr.report_no, lr.public_token, lr.approved_at from lab_reports lr
                          where lr.order_id = o.id order by lr.version desc limit 1) r on true
     where o.referral_from_business = p_business
       and (p_member is null or o.patient_member_id = p_member)
       and (p_member is not null or o.created_at > now() - interval '60 days')
       and (sehat_caller_is_business(p_business) or sehat_caller_sees_patient(p_business, o.patient_member_id))
     order by o.created_at desc
     limit 300;
end $$;
revoke all on function sehat_referred_tests(uuid, uuid) from public, anon;
grant execute on function sehat_referred_tests(uuid, uuid) to authenticated;

-- Reports ready (0288) includes reports of tests this doctor sent out.
create or replace function sehat_my_reports_ready(p_business uuid)
returns table (order_id uuid, order_no text, patient_member_id uuid, patient_name text,
               tests text, approved_at timestamptz, report_token uuid, out_of_range integer)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := sehat_my_practitioner_id(p_business);
begin
  if v_me is null or not sehat_caller_is_clinical(p_business) then return; end if;
  return query
    select o.id, o.order_no, o.patient_member_id, m.full_name,
           (select string_agg(i.name, ', ' order by i.sort_order) from lab_order_items i where i.order_id = o.id)
             || case when o.referral_from_business = p_business then ' — ' || b.name else '' end,
           r.at, r.tok,
           (select count(*)::integer from lab_results x join lab_order_items i on i.id = x.order_item_id
             where i.order_id = o.id and x.flag in ('H', 'L'))
      from lab_orders o
      join businesses b on b.id = o.business_id
      join patient_members m on m.id = o.patient_member_id
      join lateral (select lr.approved_at as at, lr.public_token as tok from lab_reports lr
                     where lr.order_id = o.id order by lr.version desc limit 1) r on true
     where (o.business_id = p_business or o.referral_from_business = p_business)
       and o.ordered_by = v_me and o.doctor_seen_at is null
       and o.status <> 'cancelled' and r.at > now() - interval '30 days'
     order by r.at desc
     limit 50;
end $$;

create or replace function sehat_lab_report_seen(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o lab_orders;
begin
  select * into o from lab_orders where id = p_order;
  if o.id is null or o.ordered_by is distinct from sehat_my_practitioner_id(coalesce(o.referral_from_business, o.business_id)) then return; end if;
  update lab_orders set doctor_seen_at = now() where id = p_order and doctor_seen_at is null;
end $$;

-- lab_order_detail is o.* — made again for the new columns.
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

notify pgrst, 'reload schema';
