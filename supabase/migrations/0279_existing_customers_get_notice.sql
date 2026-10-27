-- ============================================================================
-- 0279 — Existing customers: their plan stays until a month's notice has run
-- ============================================================================
-- When the plans by doctors (0272) go live, a business that is already paying
-- keeps what it has, at the price it pays, until its next renewal — and that
-- renewal is priced by the plans only if it is at least a month (notice_days)
-- after it was told. So each paying business gets
--   plans_from = the later of its term end and (go-live + notice_days)
-- and until that date everything about it is priced and switched exactly as
-- before (no paid add-ons, its pharmacy switch, the 3-doctor clinic rule).
-- A business that registers after go-live is on the plans from its first day.
--
-- Telling them: the owner's Plan screen shows "your plan stays until …, then
-- <plan> at ₹…/month" (from the quote), and a plan_change_notice row is
-- queued in billing_notifications with the new price for each business, which
-- the admin can export. NOTE: nothing sends billing_notifications today — the
-- daily cron only queues them.
-- ============================================================================

alter table plan_settings add column if not exists notice_days integer not null default 30 check (notice_days between 0 and 365);
alter table businesses add column if not exists plans_from date;
alter table businesses add column if not exists plan_notice_at timestamptz;

alter table billing_notifications drop constraint if exists billing_notifications_kind_check;
alter table billing_notifications add constraint billing_notifications_kind_check
  check (kind in ('renewal_reminder', 'pre_debit_notice', 'renewal_charged', 'renewal_failed', 'plan_change_notice')) not valid;

-- Is this business priced and switched by the plans — for its next term?
create or replace function sehat_plans_apply(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select tiered_live from plan_settings where id), false)
     and coalesce((select b.plans_from is null
                       or b.plans_from <= greatest((now() at time zone 'Asia/Kolkata')::date, coalesce(b.term_end, (now() at time zone 'Asia/Kolkata')::date))
                     from businesses b where b.id = p_business), true)
$$;
grant execute on function sehat_plans_apply(uuid) to anon, authenticated, service_role;

-- …and today: mid-term switches (the pharmacy, in-clinic tests, an extra
-- doctor, the clinic doctor rule) follow the old rules until plans_from.
create or replace function sehat_plans_apply_now(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select tiered_live from plan_settings where id), false)
     and coalesce((select b.plans_from is null or b.plans_from <= (now() at time zone 'Asia/Kolkata')::date
                     from businesses b where b.id = p_business), true)
$$;
grant execute on function sehat_plans_apply_now(uuid) to anon, authenticated, service_role;

-- Give every paying business its notice. Run once, when the plans go live.
create or replace function sehat_plans_give_notice()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_days integer := (select notice_days from plan_settings where id);
  n integer;
begin
  update businesses b
     set plans_from = greatest(b.term_end, v_today + v_days),
         plan_notice_at = now()
   where b.plan_notice_at is null
     and b.term_end is not null and b.term_end >= v_today
     and b.status = 'active'
     and b.vertical in ('clinic', 'hospital', 'lab', 'pharmacy');
  get diagnostics n = row_count;

  insert into billing_notifications (business_id, kind, term_end, days_before, amount, email, phone, payload)
  select b.id, 'plan_change_notice', b.term_end, (b.plans_from - v_today),
         (q->>'monthly')::numeric, b.email, b.phone,
         jsonb_build_object('business_name', b.name, 'plans_from', b.plans_from, 'tier', q->>'tier_label',
                            'monthly', q->>'monthly', 'old_monthly', b.locked_monthly_price, 'lines', q->'lines')
    from businesses b
    cross join lateral (select sehat_plan_quote(b.id, 1) q) z
   where b.plan_notice_at >= now() - interval '1 minute' and q is not null
  on conflict do nothing;
  return n;
end $$;
revoke all on function sehat_plans_give_notice() from public, anon, authenticated;

-- The admin's list: who is moving, when, from what to what.
create or replace function sehat_admin_plan_transition()
returns table (business_id uuid, name text, vertical text, phone text, email text, term_end date, plans_from date,
               old_monthly integer, new_monthly numeric, tier text, addons jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
  select b.id, b.name, b.vertical, b.phone, b.email, b.term_end, b.plans_from, b.locked_monthly_price,
         (q->>'monthly')::numeric, q->>'tier_label', q->'addons'
    from businesses b cross join lateral (select sehat_plan_quote(b.id, 1) q) z
   where b.plan_notice_at is not null
   order by b.plans_from, b.name;
end $$;
revoke all on function sehat_admin_plan_transition() from public, anon;
grant execute on function sehat_admin_plan_transition() to authenticated;

create or replace function sehat_plan_quote(
  p_business uuid, p_months integer,
  p_addons text[] default null, p_vertical text default null,
  p_doctors integer default null, p_staff integer default null, p_beds integer default null,
  p_lab_kind text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s plan_settings;
  b businesses;
  v_vertical text;
  v_family text;
  t plan_tiers;
  top plan_tiers;
  v_doctors integer;
  v_staff integer;
  v_beds integer;
  v_addons text[];
  v_factor numeric;
  v_lines jsonb := '[]'::jsonb;
  v_core numeric := 0;
  v_extra_doctors integer := 0;
  v_extra_doc_price numeric := 0;
  v_allow integer;
  v_packs integer := 0;
  v_staff_cost numeric := 0;
  v_addon_sum numeric := 0;
  v_pct numeric := 0;
  v_disc numeric := 0;
  a plan_addons;
  v_line numeric;
  v_monthly numeric;
  v_free text[] := '{}';
  v_paid integer := 0;
begin
  select * into s from plan_settings where id;
  if p_business is not null then select * into b from businesses where id = p_business; end if;
  v_vertical := coalesce(b.vertical, p_vertical);
  v_factor := case p_months when 1 then 1 when 6 then s.months6_factor when 12 then s.months12_factor else p_months end;

  -- Which plan family.
  if v_vertical in ('clinic', 'hospital') then v_family := 'core';
  elsif v_vertical = 'pharmacy' then v_family := 'pharmacy';
  elsif v_vertical = 'lab' then
    v_family := coalesce(p_lab_kind, case
      when 'pathology' = any(coalesce(b.lab_categories, '{}')) and (coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology']) then 'lab_both'
      when coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology'] then 'lab_diagnostic'
      else 'lab_pathology' end);
  else
    return null;
  end if;

  -- Counts: the business's own unless given.
  v_doctors := coalesce(p_doctors,
    (select count(*) from business_practitioners bp where bp.business_id = p_business and bp.role in ('doctor', 'owner')
        and bp.status <> 'suspended' and exists (select 1 from practitioners p where p.id = bp.practitioner_id))::integer, 0);
  if v_family <> 'pharmacy' then v_doctors := greatest(v_doctors, 1); end if;
  v_staff := coalesce(p_staff,
    (select count(*) from business_practitioners bp where bp.business_id = p_business
        and bp.role not in ('doctor', 'owner') and bp.status <> 'suspended')::integer, 0);
  v_beds := coalesce(p_beds, (select count(*) from beds x where x.business_id = p_business and x.is_active)::integer, 0);

  -- The plan.
  if v_family = 'core' then
    select * into t from plan_tiers where family = 'core' and is_enabled and max_doctors >= v_doctors order by max_doctors limit 1;
    select * into top from plan_tiers where family = 'core' and is_enabled order by max_doctors desc limit 1;
    if t.code is null then
      t := top;
      v_extra_doctors := v_doctors - top.max_doctors;
      v_extra_doc_price := top.extra_doctor_price;
    end if;
  else
    select * into t from plan_tiers where family = v_family and is_enabled order by sort_order limit 1;
    v_extra_doctors := greatest(0, v_doctors - t.max_doctors);
    v_extra_doc_price := t.extra_doctor_price;
  end if;
  if t.code is null then return null; end if;

  v_core := t.monthly_price;
  v_lines := v_lines || jsonb_build_object('kind', 'plan', 'label', t.label || case when v_family = 'core' then ' — up to ' || t.max_doctors || ' doctors' else '' end,
                                           'monthly', t.monthly_price);
  if v_extra_doctors > 0 and v_extra_doc_price > 0 then
    v_lines := v_lines || jsonb_build_object('kind', 'doctors', 'label', v_extra_doctors || ' more doctor' || case when v_extra_doctors = 1 then '' else 's' end
                                             || ' × ₹' || v_extra_doc_price, 'monthly', v_extra_doctors * v_extra_doc_price);
  end if;

  -- Add-ons (clinics and hospitals; a lab or store can add the pharmacy only).
  v_addons := array(select distinct x from unnest(coalesce(p_addons, sehat_business_addons(p_business), '{}')) x
                     where x in ('ipd', 'pathology', 'diagnostics', 'pharmacy', 'opd')
                       -- 0278: OPD is an add-on only for a pathology lab (a diagnostic
                       -- centre's plan includes it; a clinic's plan is OPD).
                       and ((v_family = 'core' and x <> 'opd')
                            or (x = 'pharmacy' and v_family like 'lab%')
                            or (x = 'opd' and v_family = 'lab_pathology'))
                     order by x);
  -- 0278: add-ons an admin has given this business free.
  if p_business is not null then v_free := coalesce(b.free_addons, '{}'); end if;
  v_allow := t.staff_included;
  for a in select * from plan_addons where code = any(v_addons) and is_enabled order by sort_order loop
    v_line := a.monthly_price;
    if a.code = 'ipd' and v_beds > s.ipd_beds_included then v_line := v_line + (v_beds - s.ipd_beds_included) * s.ipd_bed_price; end if;
    if a.code = any(v_free) then v_line := 0; else v_paid := v_paid + 1; end if;
    v_addon_sum := v_addon_sum + v_line;
    v_allow := v_allow + a.logins_included;
    v_lines := v_lines || jsonb_build_object('kind', 'addon', 'code', a.code,
      'label', a.label || case when a.code = 'ipd' then ' — ' || greatest(v_beds, 0) || ' beds' || case when v_beds > s.ipd_beds_included
                 then ' (' || s.ipd_beds_included || ' included, ' || (v_beds - s.ipd_beds_included) || ' × ₹' || s.ipd_bed_price || ')' else '' end else '' end
                 || case when a.code = any(v_free) then ' — free for you' else '' end,
      'free', a.code = any(v_free),
      'monthly', v_line);
  end loop;
  -- The bundle counts the add-ons paid for, not those given free.
  v_pct := case when v_paid >= 3 then s.bundle3_pct when v_paid = 2 then s.bundle2_pct else 0 end;
  v_disc := round(v_addon_sum * v_pct / 100.0);
  if v_disc > 0 then
    v_lines := v_lines || jsonb_build_object('kind', 'bundle', 'label', 'Bundle discount — ' || trim_scale(v_pct) || '% off ' || v_paid || ' add-ons',
                                             'monthly', -v_disc);
  end if;

  -- Staff beyond what the plan and add-ons include.
  if v_staff > v_allow then
    v_packs := ceil((v_staff - v_allow)::numeric / s.staff_pack_size);
    v_staff_cost := v_packs * s.staff_pack_price;
    v_lines := v_lines || jsonb_build_object('kind', 'staff', 'label', (v_staff - v_allow) || ' staff over the ' || v_allow || ' included — '
                                             || v_packs || ' × ' || s.staff_pack_size || ' logins', 'monthly', v_staff_cost);
  end if;

  if v_extra_doc_price = 0 then v_extra_doctors := 0; end if;
  v_monthly := v_core + v_extra_doctors * v_extra_doc_price + v_addon_sum - v_disc + v_staff_cost;
  return jsonb_build_object(
    -- 0279: live for THIS business — an existing customer keeps the old
    -- pricing until its notice has run (plans_from).
    'live', s.tiered_live and (p_business is null or sehat_plans_apply(p_business)),
    'tiered_live', s.tiered_live, 'plans_from', b.plans_from, 'family', v_family, 'tier', t.code, 'tier_label', t.label,
    'doctors', v_doctors, 'doctors_included', t.max_doctors, 'staff', v_staff, 'staff_included', v_allow, 'beds', v_beds,
    'addons', to_jsonb(v_addons), 'bundle_pct', v_pct,
    'subscription_monthly', v_core + v_extra_doctors * v_extra_doc_price + v_staff_cost,
    'addons_monthly', v_addon_sum - v_disc,
    'monthly', v_monthly, 'months', p_months, 'factor', v_factor,
    'lines', (select jsonb_agg(l || jsonb_build_object('amount', round((l->>'monthly')::numeric * v_factor))) from jsonb_array_elements(v_lines) l),
    'total', round(v_monthly * v_factor));
end $$;
revoke all on function sehat_plan_quote(uuid, integer, text[], text, integer, integer, integer, text) from public;
grant execute on function sehat_plan_quote(uuid, integer, text[], text, integer, integer, integer, text) to anon, authenticated, service_role;

create or replace function sehat_business_renewal_price(p_business uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  b businesses;
  v_months integer;
  v_price integer;
  v_q jsonb;
begin
  select * into b from businesses where id = p_business;
  if b.id is null then return null; end if;
  if b.renewal_price is not null then return b.renewal_price; end if;
  v_months := coalesce(b.renewal_term_months, b.months_paid, 1);

  if sehat_plans_apply(p_business) then
    v_q := sehat_plan_quote(p_business, v_months, b.renewal_plan_addons);
    if v_q is not null then
      select (v_q->>'total')::integer + case when not b.renewal_whatsapp then 0
                                             when b.renewal_whatsapp_plan = 'pro' then coalesce(p.whatsapp_pro_price, p.whatsapp_price * 2)
                                             else p.whatsapp_price end
        into v_price
        from vertical_term_prices p where p.vertical = b.vertical and p.months = v_months and p.is_enabled;
      return coalesce(v_price, (v_q->>'total')::integer);
    end if;
  end if;

  select p.subscription_price + case when not b.renewal_whatsapp then 0
                                      when b.renewal_whatsapp_plan = 'pro' then coalesce(p.whatsapp_pro_price, p.whatsapp_price * 2)
                                      else p.whatsapp_price end
    into v_price
    from vertical_term_prices p
   where p.vertical = b.vertical and p.months = v_months and p.is_enabled;
  if v_price is not null then return v_price; end if;

  if to_regclass('public.plan_terms') is not null then
    execute 'select price from plan_terms where plan_code = $1 and months = $2 and is_enabled'
      into v_price using b.pricing_plan_code, v_months;
    if v_price is not null then return v_price; end if;
  end if;

  return b.locked_monthly_price * v_months;
end $$;

create or replace function sehat_set_lab_tests(p_business uuid, p_categories text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_vertical text;
  v_have text[];
  v_cats text[] := array(select distinct c from unnest(coalesce(p_categories, '{}')) c where c is not null order by c);
  v_new_paid text[];
begin
  if not (sehat_caller_manages_business(p_business) or sehat_is_admin()) then
    raise exception 'Only the owner or a manager can change this.' using errcode = '42501';
  end if;
  if not v_cats <@ array['pathology','radiology','cardiology']::text[] then
    raise exception 'Unknown kind of test.' using errcode = 'P0001';
  end if;
  select vertical, coalesce(lab_categories, '{}') into v_vertical, v_have from businesses where id = p_business;
  if v_vertical is null then raise exception 'No such business.' using errcode = 'P0002'; end if;

  if v_vertical = 'lab' then
    if cardinality(v_cats) = 0 then
      raise exception 'Choose what kind of lab this is.' using errcode = 'P0001';
    end if;
    -- 0277: a diagnostic centre's plan includes OPD for its doctors; a
    -- pathology lab keeps patients and their reports, without OPD.
    -- 0278: a diagnostic centre's plan includes OPD. A pathology lab keeps
    -- OPD only as an add-on — given free, or paid for (it stays until the
    -- term ends if the lab stops being a diagnostic centre mid-term only when
    -- it was bought or given).
    update businesses set lab_categories = v_cats,
           opd_module = case
             when v_cats && array['radiology', 'cardiology'] then true
             when v_have && array['radiology', 'cardiology'] then 'opd' = any(coalesce(free_addons, '{}'))
             else opd_module end
     where id = p_business;
  else
    -- 0275: with the plans live, Pathology and Diagnostics are add-ons, bought
    -- from Plan; the owner can still switch one off (it then stops renewing).
    if not sehat_is_admin() and sehat_plans_apply_now(p_business)
       and exists (select 1 from unnest(v_cats) c where not (c = any(v_have))) then
      raise exception 'Pathology and Diagnostics are add-ons now — add them from Plan → Add-ons.' using errcode = '42501';
    end if;
    if not sehat_is_admin() then
      v_new_paid := array(select c from unnest(v_cats) c
                           where not (c = any(v_have))
                             and coalesce((select monthly_price from addon_prices a where a.code = c), 0) > 0);
      if cardinality(v_new_paid) > 0 then
        raise exception 'That add-on is paid — add it from Plan → Add-ons.' using errcode = '42501';
      end if;
    end if;
    update businesses
       set lab_categories = v_cats,
           lab_module = cardinality(v_cats) > 0,
           -- Switched off: stop renewing it too.
           renewal_addons = array(select a from unnest(renewal_addons) a where a = any(v_cats)),
           renewal_plan_addons = case when renewal_plan_addons is null then null else array(select a from unnest(renewal_plan_addons) a
                                   where a not in ('pathology', 'diagnostics')
                                      or (a = 'pathology' and 'pathology' = any(v_cats))
                                      or (a = 'diagnostics' and v_cats && array['radiology', 'cardiology'])) end,
           lab_module_set_by = coalesce((select email from auth.users where id = auth.uid()), 'owner')
     where id = p_business;
  end if;
  return (select jsonb_build_object('lab_categories', lab_categories, 'lab_module', lab_module or vertical = 'lab',
                                    'renewal_addons', renewal_addons)
            from businesses where id = p_business);
end $$;

create or replace function sehat_set_pharmacy_module(p_business uuid, p_on boolean)
returns boolean language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()) then
    raise exception 'Only the owner can change this.' using errcode = '42501';
  end if;
  if (select vertical from businesses where id = p_business) not in ('clinic', 'hospital') then
    raise exception 'In-house dispensing is for clinics and hospitals.' using errcode = 'P0001';
  end if;
  -- 0275: with the plans live the pharmacy is an add-on, bought from Plan.
  if coalesce(p_on, false) and not sehat_is_admin() and sehat_plans_apply_now(p_business)
     and not (select pharmacy_module from businesses where id = p_business) then
    raise exception 'The pharmacy is an add-on now — add it from Plan → Add-ons.' using errcode = '42501';
  end if;
  if not coalesce(p_on, false) then
    update businesses set renewal_plan_addons = array_remove(renewal_plan_addons, 'pharmacy') where id = p_business;
  end if;
  update businesses
     set pharmacy_module = coalesce(p_on, false),
         pharmacy_module_since = case when coalesce(p_on, false) and not pharmacy_module then now() else pharmacy_module_since end,
         pharmacy_module_set_by = coalesce((select email from auth.users where id = auth.uid()), 'owner')
   where id = p_business;
  return coalesce(p_on, false);
end $$;

create or replace function sehat_extra_doctor_monthly(p_business uuid, p_practitioner uuid)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_others integer;
  v_now jsonb;
  v_then jsonb;
begin
  -- Doctors here besides the one joining.
  select count(*) into v_others from business_practitioners bp
   where bp.business_id = p_business and bp.role in ('doctor', 'owner') and bp.status <> 'suspended'
     and bp.practitioner_id <> p_practitioner and exists (select 1 from practitioners p where p.id = bp.practitioner_id);

  if sehat_plans_apply_now(p_business) then
    v_now := sehat_plan_quote(p_business, 1, null, null, greatest(v_others, 1));
    v_then := sehat_plan_quote(p_business, 1, null, null, greatest(v_others + 1, 1));
    if v_now is not null and v_then is not null then
      return greatest(0, (v_then->>'monthly')::numeric - (v_now->>'monthly')::numeric);
    end if;
  end if;

  -- Before the plans (0140): one price per doctor beyond those included.
  return (select case
           when coalesce(vb.extra_doctor_price, 0) > 0
                and (select count(*) from business_practitioners bp
                      where bp.business_id = p_business and bp.role = 'doctor'
                        and bp.status <> 'suspended' and bp.practitioner_id <> p_practitioner)
                    >= coalesce(vb.included_doctors, 0)
           then vb.extra_doctor_price else 0 end
    from businesses b
    left join vertical_billing vb on vb.vertical = b.vertical
   where b.id = p_business);
end $$;

create or replace function sehat_clinic_doctor_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if new.role not in ('doctor', 'owner') or new.status = 'suspended' then return new; end if;
  -- Only when this row BECOMES a doctor here: joined, came back, or promoted.
  if tg_op = 'UPDATE' and old.role in ('doctor', 'owner') and old.status <> 'suspended' then return new; end if;
  if (select vertical from businesses where id = new.business_id) is distinct from 'clinic' then return new; end if;
  -- 0274: with the plans by doctors live, a clinic simply moves up a plan.
  if sehat_plans_apply_now(new.business_id) then return new; end if;
  select count(*) into v_count from business_practitioners bp
   where bp.business_id = new.business_id and bp.role in ('doctor', 'owner') and bp.status <> 'suspended'
     and bp.practitioner_id <> new.practitioner_id
     and exists (select 1 from practitioners p where p.id = bp.practitioner_id);
  if v_count >= 3 then
    raise exception 'A clinic can have up to 3 doctors. For more, register as a hospital — message us on WhatsApp and we will move you across.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function sehat_admin_set_plan_pricing(p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  x jsonb;
  v_was boolean := (select tiered_live from plan_settings where id);
  v_who text := (select email from auth.users where id = auth.uid());
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p ? 'settings' then
    update plan_settings set
      tiered_live = coalesce((p->'settings'->>'tiered_live')::boolean, tiered_live),
      months6_factor = coalesce((p->'settings'->>'months6_factor')::numeric, months6_factor),
      months12_factor = coalesce((p->'settings'->>'months12_factor')::numeric, months12_factor),
      staff_pack_size = coalesce((p->'settings'->>'staff_pack_size')::integer, staff_pack_size),
      staff_pack_price = coalesce((p->'settings'->>'staff_pack_price')::integer, staff_pack_price),
      bundle2_pct = coalesce((p->'settings'->>'bundle2_pct')::numeric, bundle2_pct),
      bundle3_pct = coalesce((p->'settings'->>'bundle3_pct')::numeric, bundle3_pct),
      ipd_beds_included = coalesce((p->'settings'->>'ipd_beds_included')::integer, ipd_beds_included),
      ipd_bed_price = coalesce((p->'settings'->>'ipd_bed_price')::integer, ipd_bed_price),
      updated_at = now(), updated_by = v_who
     where id;
  end if;
  if p ? 'settings' then
    update plan_settings set notice_days = coalesce((p->'settings'->>'notice_days')::integer, notice_days) where id;
  end if;
  for x in select * from jsonb_array_elements(coalesce(p->'tiers', '[]'::jsonb)) loop
    update plan_tiers set
      monthly_price = coalesce((x->>'monthly_price')::integer, monthly_price),
      max_doctors = coalesce((x->>'max_doctors')::integer, max_doctors),
      staff_included = coalesce((x->>'staff_included')::integer, staff_included),
      extra_doctor_price = coalesce((x->>'extra_doctor_price')::integer, extra_doctor_price),
      is_enabled = coalesce((x->>'is_enabled')::boolean, is_enabled),
      updated_at = now()
     where code = x->>'code';
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'addons', '[]'::jsonb)) loop
    update plan_addons set
      monthly_price = coalesce((x->>'monthly_price')::integer, monthly_price),
      logins_included = coalesce((x->>'logins_included')::integer, logins_included),
      is_enabled = coalesce((x->>'is_enabled')::boolean, is_enabled),
      updated_at = now()
     where code = x->>'code';
  end loop;
  -- 0279: going live gives every paying customer its notice (once).
  if not coalesce(v_was, false) and (select tiered_live from plan_settings where id) then
    perform sehat_plans_give_notice();
  end if;
end $$;
revoke all on function sehat_admin_set_plan_pricing(jsonb) from public, anon;
grant execute on function sehat_admin_set_plan_pricing(jsonb) to authenticated;

-- Already live here (the sandbox): give the notice now.
do $$ begin
  if (select tiered_live from plan_settings where id) then perform sehat_plans_give_notice(); end if;
end $$;

notify pgrst, 'reload schema';
