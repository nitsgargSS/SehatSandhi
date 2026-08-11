-- ============================================================================
-- Sehatsandhi — the functions and views that still spoke of `doctors`
--
-- Run AFTER 0038. Safe to re-run.
--
-- 0037 dropped the table with CASCADE, which takes dependent VIEWS but not
-- function bodies: PL/pgSQL is not parsed until it runs, so five functions kept
-- a reference to a table that no longer exists and would have failed at the
-- worst possible moment. Two of them, sehat_issue_invoice and
-- sehat_active_pricing_plan, sit directly on the payment path — a business
-- would have paid and then not been given an invoice.
--
-- Found by asking the database rather than by grepping: every function whose
-- pg_get_functiondef still matched the dropped tables, and every view that
-- failed a `select ... limit 1`.
-- ============================================================================

-- ── appointment_events, the last table carrying the old name ───────────────

alter table appointment_events rename column doctor_id to business_id;

alter table appointment_events
  add column if not exists practitioner_id uuid references practitioners(id) on delete set null;

comment on column appointment_events.practitioner_id is
  'Which doctor the appointment was with, copied from the appointment so the '
  'history survives the affiliation being suspended.';

-- ── The pricing plan in force ──────────────────────────────────────────────
-- Seat counting is per business: a plan with 50 seats means 50 businesses.

-- Identical to 0006's, except that seats are counted in `businesses`. The admin
-- override and the starts_at/ends_at window are load-bearing — dropping them
-- would silently disable plan switching from admin.
create or replace function sehat_active_pricing_plan()
returns pricing_plans
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_override text;
  v_plan pricing_plans;
begin
  select override_plan_code into v_override from pricing_settings where id;

  if v_override is not null then
    select * into v_plan from pricing_plans where code = v_override;
    if found then return v_plan; end if;
  end if;

  select p.* into v_plan
    from pricing_plans p
   where p.is_enabled
     and (p.starts_at is null or p.starts_at <= now())
     and (p.ends_at   is null or p.ends_at   >  now())
     and (p.max_signups is null
          or (select count(*) from businesses b where b.pricing_plan_code = p.code) < p.max_signups)
   order by p.sequence, p.code
   limit 1;

  return v_plan;   -- null when nothing is configured; callers fall back to tiers
end $$;

-- Rebuild the two views that read it. active_pricing_plan is `select * from`
-- the function, so its column list is fixed at creation and it has to be
-- recreated after the function changes shape — the note in 0020 learned this
-- the hard way.
drop view if exists pricing_plan_status;
drop view if exists active_pricing_plan;

create view active_pricing_plan as
  select * from sehat_active_pricing_plan();

grant select on active_pricing_plan to anon, authenticated;

create view pricing_plan_status as
select
  p.*,
  (select count(*) from businesses b
    where b.pricing_plan_code = p.code)                            as signups_used,
  (select count(*) from businesses b
    where b.pricing_plan_code = p.code
      and b.status = 'active'
      and (b.term_end is null or b.term_end >= current_date))      as active_enrolled,
  (select count(*) from businesses b
    where b.pricing_plan_code = p.code
      and b.term_end is not null
      and b.term_end < current_date)                               as expired_enrolled,
  (select max(b.locked_at) from businesses b
    where b.pricing_plan_code = p.code)                            as last_signup_at,
  case when p.max_signups is null then null
       else greatest(p.max_signups - (select count(*) from businesses b
                                       where b.pricing_plan_code = p.code), 0)
  end                                                              as seats_left,
  ((select count(*) from businesses b where b.pricing_plan_code = p.code) = 0)
                                                                   as can_delete,
  (select code from active_pricing_plan)                           as active_code,
  (p.code = (select code from active_pricing_plan))                as is_currently_active
from pricing_plans p
order by p.sequence, p.code;

revoke all on pricing_plan_status from anon, authenticated;

-- ── Invoicing ──────────────────────────────────────────────────────────────
-- The buyer is the business. Its name on the invoice is the business's name,
-- which is now one column instead of coalesce(clinic_name, name).

create or replace function sehat_issue_invoice(p_payment_id uuid)
returns invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing invoices;
  v_pay payments;
  v_biz businesses;
  v_ts tax_settings;
  v_inv invoices;
  v_recipient_state text;
  v_place text;
  v_taxable numeric(12,2);
  v_rate numeric(5,2);
  v_tax numeric(12,2);
  v_cgst numeric(12,2) := 0;
  v_sgst numeric(12,2) := 0;
  v_igst numeric(12,2) := 0;
begin
  select * into v_existing from invoices where payment_id = p_payment_id;
  if found then return v_existing; end if;

  select * into v_pay from payments where id = p_payment_id;
  if not found then raise exception 'no such payment: %', p_payment_id; end if;
  if v_pay.status <> 'paid' then
    raise exception 'payment % is % — only a paid payment gets an invoice', p_payment_id, v_pay.status;
  end if;

  select * into v_ts from tax_settings where id;
  select * into v_biz from businesses where id = v_pay.business_id;

  -- Prefer the breakdown the order function already computed and charged, so
  -- the invoice can never disagree with the money that moved.
  v_rate    := coalesce(v_pay.gst_rate, 0);
  v_taxable := coalesce(v_pay.taxable_value, v_pay.amount, 0);
  v_tax     := coalesce(v_pay.tax_total, 0);
  v_cgst    := coalesce(v_pay.cgst_amount, 0);
  v_sgst    := coalesce(v_pay.sgst_amount, 0);
  v_igst    := coalesce(v_pay.igst_amount, 0);

  v_recipient_state := coalesce(v_biz.state_code, v_ts.state_code);
  v_place := coalesce(v_pay.place_of_supply, v_recipient_state);

  insert into invoices (
    invoice_number, invoice_date, fy,
    business_id, payment_id,
    supplier_legal_name, supplier_trade_name, supplier_gstin, supplier_state_code, supplier_address,
    recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_phone, recipient_email,
    sac_code, description, period_start, period_end, months, pin_codes,
    taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, tax_total, total_amount,
    place_of_supply, reverse_charge
  ) values (
    sehat_next_invoice_number(current_date), current_date, sehat_financial_year(current_date),
    v_pay.business_id, p_payment_id,
    v_ts.legal_name, v_ts.trade_name, v_ts.gstin, v_ts.state_code,
    concat_ws(', ', v_ts.registered_address, v_ts.city, v_ts.pin_code),
    coalesce(v_biz.gst_legal_name, v_biz.name),
    v_biz.gstin, v_recipient_state,
    coalesce(v_biz.billing_address, v_biz.address), v_biz.phone, v_biz.email,
    v_ts.sac_code, v_ts.service_description,
    v_pay.term_start, v_pay.term_end, v_pay.period_months, v_pay.pin_codes,
    v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_tax, coalesce(v_pay.amount, 0),
    v_place, false
  )
  returning * into v_inv;

  return v_inv;
end $$;

-- ── The appointment trigger ────────────────────────────────────────────────
-- Now names the practitioner when there is one. "Your appointment with
-- Dr. Mehra" beats "your appointment with Apollo Hospital" when the patient is
-- seeing a person.

create or replace function sehat_appointment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  v_doctor_name text;
  v_slot_changed boolean := new.slot_datetime is distinct from old.slot_datetime;
  v_status_changed boolean := new.status is distinct from old.status;
begin
  if not v_slot_changed and not v_status_changed then
    return new;
  end if;

  -- A slot move is a reschedule even when the status is untouched; a status
  -- change to cancelled during a move is still a cancellation.
  v_event := case
    when v_status_changed and new.status = 'cancelled' then 'cancelled'
    when v_status_changed and new.status = 'no_show'   then 'no_show'
    when v_status_changed and new.status = 'completed' then 'completed'
    when v_status_changed and new.status = 'confirmed' then 'confirmed'
    when v_slot_changed then 'rescheduled'
    else 'updated'
  end;

  insert into appointment_events (
    appointment_id, business_id, practitioner_id, event, actor, actor_detail,
    from_status, to_status, from_slot, to_slot, reason
  ) values (
    new.id, new.business_id, new.practitioner_id, v_event,
    coalesce(new.last_actor, 'system'), new.last_actor_detail,
    old.status, new.status, old.slot_datetime, new.slot_datetime,
    new.cancel_reason
  );

  -- Only events the other party actually needs to act on. 'completed' and
  -- 'no_show' are record-keeping: messaging a patient to say they did not turn
  -- up is a bad message to send, and one nobody can do anything about.
  if v_event not in ('cancelled', 'rescheduled', 'confirmed') then
    return new;
  end if;

  -- Name the doctor when the booking has one, the business otherwise. This used
  -- to be coalesce(clinic_name, name) off the listing, which was the best it
  -- could do when a listing was the only thing an appointment pointed at.
  select coalesce(
           (select p.full_name from practitioners p where p.id = new.practitioner_id),
           b.name)
    into v_doctor_name
    from businesses b where b.id = new.business_id;

  -- Tell the party who did NOT make the change. A clinic cancelling must reach
  -- the patient; a patient cancelling must reach the clinic.
  if coalesce(new.last_actor, 'system') = 'patient' then
    insert into notification_outbox (appointment_id, recipient, phone, event, payload)
    select new.id, 'clinic', b.phone, v_event,
           jsonb_build_object('patient_name', new.patient_name, 'doctor_name', v_doctor_name,
                              'old_slot', old.slot_datetime, 'new_slot', new.slot_datetime,
                              'reason', new.cancel_reason)
      from businesses b where b.id = new.business_id;
  else
    insert into notification_outbox (appointment_id, recipient, phone, event, payload)
    values (new.id, 'patient', new.patient_phone, v_event,
            jsonb_build_object('patient_name', new.patient_name, 'doctor_name', v_doctor_name,
                               'old_slot', old.slot_datetime, 'new_slot', new.slot_datetime,
                               'reason', new.cancel_reason));
  end if;

  return new;
end $$;

-- ── Reporting ──────────────────────────────────────────────────────────────

-- Dropped rather than replaced: Postgres refuses to change a set-returning
-- function's result type in place, even when the columns are identical, because
-- the OUT parameters are part of its identity.
drop function if exists sehat_demand_report(integer);
drop function if exists sehat_platform_report(integer);

-- Signature unchanged — admin/Dashboard.tsx calls this by name and reads these
-- exact columns. Only where "is this area served" comes from changes.
create or replace function sehat_demand_report(p_days integer default 90)
returns table (
  pin_code text,
  area_name text,
  speciality text,
  searches integer,
  searchers integer,
  active_listings integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from date := current_date - greatest(1, least(coalesce(p_days, 90), 365));
begin
  if not sehat_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select e.pin_code,
         coalesce(sa.area_name, e.pin_code),
         e.speciality,
         count(*)::integer,
         count(distinct e.session_id)::integer,
         -- An area is served when an active business covers it AND — where the
         -- patient searched for a speciality — somebody there actually
         -- practises it. The old version compared the search against
         -- doctors.speciality, which for a listing was the vertical: a pharmacy
         -- in the pincode made a cardiology search look answered.
         (select count(*) from businesses b
           where b.status = 'active' and e.pin_code = any(b.pin_codes)
             and (e.speciality is null or exists (
                   select 1 from business_practitioners bp
                     join practitioners p on p.id = bp.practitioner_id
                    where bp.business_id = b.id and bp.status = 'active'
                      and p.status = 'active' and p.speciality = e.speciality)))::integer
    from site_events e
    left join service_areas sa on sa.pin_code = e.pin_code
   where e.event_type = 'search' and e.pin_code is not null and e.created_at >= v_from
   group by e.pin_code, sa.area_name, e.speciality
   order by count(*) desc;
end $$;

-- Same columns as before; `new_listings` now counts businesses.
create or replace function sehat_platform_report(p_days integer default 30)
returns table (
  day date, visitors integer, page_views integer, searches integer,
  profile_views integer, whatsapp_clicks integer, business_leads integer,
  new_listings integer, bookings integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from date := current_date - greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not sehat_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  with days as (
    select generate_series(v_from, current_date, interval '1 day')::date as d
  ),
  ev as (
    select date_trunc('day', created_at)::date as d,
           count(distinct session_id)                                as visitors,
           count(*) filter (where event_type = 'page_view')           as pages,
           count(*) filter (where event_type = 'search')              as searches,
           count(*) filter (where event_type = 'doctor_view')         as views,
           count(*) filter (where event_type = 'whatsapp_click')      as taps,
           count(*) filter (where event_type = 'business_lead')       as leads
      from site_events where created_at >= v_from group by 1
  ),
  li as (
    select date_trunc('day', created_at)::date as d, count(*) as n
      from businesses where created_at >= v_from group by 1
  ),
  ap as (
    select date_trunc('day', created_at)::date as d, count(*) as n
      from appointments where created_at >= v_from group by 1
  )
  select days.d,
         coalesce(ev.visitors, 0)::integer, coalesce(ev.pages, 0)::integer,
         coalesce(ev.searches, 0)::integer, coalesce(ev.views, 0)::integer,
         coalesce(ev.taps, 0)::integer,     coalesce(ev.leads, 0)::integer,
         coalesce(li.n, 0)::integer,        coalesce(ap.n, 0)::integer
    from days
    left join ev on ev.d = days.d
    left join li on li.d = days.d
    left join ap on ap.d = days.d
   order by days.d;
end $$;

-- Grants die with the function, so they are restated here.
grant execute on function sehat_demand_report(integer) to authenticated;
grant execute on function sehat_platform_report(integer) to authenticated;
