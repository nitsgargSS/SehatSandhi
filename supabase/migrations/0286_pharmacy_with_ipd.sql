-- ============================================================================
-- 0286 — The pharmacy comes with IPD
-- ============================================================================
-- Decided 29 Oct 2026. A hospital that admits patients needs its pharmacy —
-- the ward sends to it, it issues to the stay (0270, 0284) — so IPD is now
-- "IPD + Pharmacy": the IPD add-on switches the pharmacy on, and with IPD on
-- the plan the Pharmacy add-on is neither charged nor counted towards the
-- bundle discount. A clinic on OPD alone can still add the Pharmacy by itself
-- (₹1,000 a month). Stopping IPD takes the pharmacy with it unless the
-- Pharmacy add-on is bought on its own; the stock and bills stay, as always.
--
-- Clinics and hospitals running IPD today get their pharmacy switched on.
-- ============================================================================

update plan_addons
   set label = 'IPD + Pharmacy',
       description = 'Admissions, beds and wards, nursing charts, discharge — with the pharmacy included: stock, bills, ward issues'
 where code = 'ipd';
update plan_addons
   set description = 'Stock and batches, GST bills, dues, purchases. Included with IPD.'
 where code = 'pharmacy';

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
  -- 0286: IPD includes the pharmacy — with IPD on the plan the pharmacy is
  -- neither charged nor counted towards the bundle.
  if v_family = 'core' and 'ipd' = any(v_addons) then
    v_addons := array_remove(v_addons, 'pharmacy');
  end if;
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
    'pharmacy_included', v_family = 'core' and 'ipd' = any(v_addons),
    'subscription_monthly', v_core + v_extra_doctors * v_extra_doc_price + v_staff_cost,
    'addons_monthly', v_addon_sum - v_disc,
    'monthly', v_monthly, 'months', p_months, 'factor', v_factor,
    'lines', (select jsonb_agg(l || jsonb_build_object('amount', round((l->>'monthly')::numeric * v_factor))) from jsonb_array_elements(v_lines) l),
    'total', round(v_monthly * v_factor));
end $$;
revoke all on function sehat_plan_quote(uuid, integer, text[], text, integer, integer, integer, text) from public;
grant execute on function sehat_plan_quote(uuid, integer, text[], text, integer, integer, integer, text) to anon, authenticated, service_role;

create or replace function sehat_apply_plan_addons(p_business uuid, p_addons text[], p_only_raise boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  b businesses;
  v_ipd boolean := 'ipd' = any(p_addons);
  v_path boolean := 'pathology' = any(p_addons);
  v_diag boolean := 'diagnostics' = any(p_addons);
  v_pharm boolean := 'pharmacy' = any(p_addons);
  v_cats text[];
begin
  select * into b from businesses where id = p_business;
  if b.id is null then return; end if;
  if b.vertical not in ('clinic', 'hospital') then
    -- A lab may add the pharmacy. A Diagnostic Centre's plan includes OPD for
    -- its doctors, and every lab keeps its patients' records (0272).
    if b.vertical = 'lab' then
      -- 0278: OPD is included for a diagnostic centre, an add-on for a pathology lab.
      update businesses set
        pharmacy_module = v_pharm or (p_only_raise and pharmacy_module) or 'pharmacy' = any(coalesce(free_addons, '{}')),
        opd_module = (coalesce(lab_categories, '{}') && array['radiology', 'cardiology'])
                     or 'opd' = any(p_addons) or (p_only_raise and opd_module) or 'opd' = any(coalesce(free_addons, '{}'))
       where id = p_business;
    end if;
    return;
  end if;
  -- 0278: what an admin gave free stays on whatever is paid for.
  v_ipd := v_ipd or 'ipd' = any(coalesce(b.free_addons, '{}'));
  v_path := v_path or 'pathology' = any(coalesce(b.free_addons, '{}'));
  v_diag := v_diag or 'diagnostics' = any(coalesce(b.free_addons, '{}'));
  v_pharm := v_pharm or 'pharmacy' = any(coalesce(b.free_addons, '{}'));
  if p_only_raise then
    v_ipd := v_ipd or b.ipd_module;
    v_pharm := v_pharm or b.pharmacy_module;
    v_path := v_path or ('pathology' = any(coalesce(b.lab_categories, '{}')) and b.lab_module);
    v_diag := v_diag or ((coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology']) and b.lab_module);
  end if;
  -- 0286: the pharmacy comes with IPD.
  v_pharm := v_pharm or v_ipd;
  v_cats := array_remove(array[case when v_path then 'pathology' end, case when v_diag then 'radiology' end, case when v_diag then 'cardiology' end], null);
  update businesses set
    opd_module = true,          -- the core plan is OPD
    ipd_module = v_ipd,
    pharmacy_module = v_pharm,
    pharmacy_module_since = case when v_pharm and not pharmacy_module then now() else pharmacy_module_since end,
    lab_module = cardinality(v_cats) > 0,
    lab_categories = case when cardinality(v_cats) > 0 then v_cats else lab_categories end,
    lab_module_set_by = 'plan'
   where id = p_business;
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
     and not (select pharmacy_module or ipd_module from businesses where id = p_business) then
    raise exception 'The pharmacy is an add-on now — add it from Plan → Add-ons, or take IPD, which includes it.' using errcode = '42501';
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

update businesses
   set pharmacy_module = true,
       pharmacy_module_since = now(),
       pharmacy_module_set_by = 'plan: included with IPD (0286)'
 where vertical in ('clinic', 'hospital') and ipd_module and not pharmacy_module;

notify pgrst, 'reload schema';
