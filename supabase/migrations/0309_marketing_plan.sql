-- ============================================================================
-- 0309 — Marketing plan: WhatsApp Pro and social media without the OPD plan
-- ============================================================================
-- AFTER 0308. Safe to re-run.
--
-- Decided 2 Nov 2026. A clinic or hospital may buy only marketing: WhatsApp
-- Pro (its own number, ₹1,000 a month, priced as today in
-- vertical_term_prices) and/or "Social media & website" (₹1,000 a month: the
-- full website and hosting, on its own domain or /s/<slug>, with its Facebook
-- and Instagram pages on it). It is listed in the app and the WhatsApp bot and
-- takes bookings (both need only status 'active'), and can add the OPD plan,
-- IPD and the rest later.
--
--   businesses.plan_kind   'software' (the OPD plan, as before) or 'marketing'.
--   plan_tiers 'marketing' a ₹0 plan in its own family, so every existing path
--                          — quote, payment, renewal — keeps working: the
--                          subscription is ₹0 and the add-ons and WhatsApp are
--                          what is paid.
--   plan_addons 'social'   ₹1,000, for both plans; never in the bundle discount.
--   businesses.social_addon  whether it is paid for (sehat_business_addons
--                          reports it, so renewals carry it).
--
-- sehat_plan_quote and sehat_apply_plan_addons are 0286's with only the
-- marked changes. sehat_admin_set_plan_kind lets an admin move a business
-- between the two plans.
-- ============================================================================

alter table businesses add column if not exists plan_kind text not null default 'software';
alter table businesses drop constraint if exists businesses_plan_kind_check;
alter table businesses add constraint businesses_plan_kind_check check (plan_kind in ('software', 'marketing'));
alter table businesses add column if not exists social_addon boolean not null default false;

alter table plan_tiers drop constraint if exists plan_tiers_family_check;
alter table plan_tiers add constraint plan_tiers_family_check
  check (family in ('core', 'lab_pathology', 'lab_diagnostic', 'lab_both', 'pharmacy', 'marketing'));
alter table plan_addons drop constraint if exists plan_addons_code_check;
alter table plan_addons add constraint plan_addons_code_check
  check (code in ('ipd', 'pathology', 'diagnostics', 'pharmacy', 'opd', 'social'));

insert into plan_tiers (code, family, label, max_doctors, staff_included, monthly_price, extra_doctor_price, sort_order, is_enabled)
values ('marketing', 'marketing', 'Marketing', 999, 3, 0, 0, 5, true)
on conflict (code) do nothing;
insert into plan_addons (code, label, description, monthly_price, logins_included, sort_order, is_enabled)
values ('social', 'Social media & website',
        'Your full website and hosting — on your own domain, or on Sehatsandhi — with your Facebook and Instagram pages on it',
        1000, 0, 60, true)
on conflict (code) do nothing;

create or replace function sehat_business_addons(p_business uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when b.vertical in ('clinic', 'hospital') then array_remove(array[
           case when b.ipd_module and b.plan_kind <> 'marketing' then 'ipd' end,
           case when 'pathology' = any(coalesce(b.lab_categories, '{}')) and b.lab_module and b.plan_kind <> 'marketing' then 'pathology' end,
           case when (coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology']) and b.lab_module and b.plan_kind <> 'marketing' then 'diagnostics' end,
           case when b.pharmacy_module and b.plan_kind <> 'marketing' then 'pharmacy' end,
           -- 0309
           case when b.social_addon then 'social' end], null)
    when b.vertical = 'lab' then array_remove(array[
           case when b.opd_module and not (coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology']) then 'opd' end,
           case when b.pharmacy_module then 'pharmacy' end], null)
  end
    from businesses b where b.id = p_business;
$$;

-- The quote gains p_kind, so the old signature goes first.
drop function if exists sehat_plan_quote(uuid, integer, text[], text, integer, integer, integer, text);
create or replace function sehat_plan_quote(
  p_business uuid, p_months integer,
  p_addons text[] default null, p_vertical text default null,
  p_doctors integer default null, p_staff integer default null, p_beds integer default null,
  p_lab_kind text default null, p_kind text default null
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
  -- 0309: a clinic or hospital on the marketing plan has no OPD plan to pay for.
  if v_vertical in ('clinic', 'hospital') and coalesce(p_kind, b.plan_kind, 'software') = 'marketing' then v_family := 'marketing';
  elsif v_vertical in ('clinic', 'hospital') then v_family := 'core';
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
  if v_family not in ('pharmacy', 'marketing') then v_doctors := greatest(v_doctors, 1); end if;
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
                     where x in ('ipd', 'pathology', 'diagnostics', 'pharmacy', 'opd', 'social')
                       -- 0278: OPD is an add-on only for a pathology lab (a diagnostic
                       -- centre's plan includes it; a clinic's plan is OPD).
                       -- 0309: social (website and hosting) for a clinic or hospital on either plan.
                       and ((v_family = 'core' and x <> 'opd')
                            or (x = 'social' and v_family in ('core', 'marketing'))
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
    -- 0309: social never counts towards the bundle (no bundle discount on it).
    if a.code = any(v_free) then v_line := 0; elsif a.code <> 'social' then v_paid := v_paid + 1; end if;
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
  v_disc := round((v_addon_sum - coalesce((select sum(case when x.code = any(v_free) then 0 else x.monthly_price end)
                                            from plan_addons x where x.code = 'social' and x.code = any(v_addons) and x.is_enabled), 0)) * v_pct / 100.0);
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
    'tiered_live', s.tiered_live, 'plans_from', b.plans_from, 'family', v_family,
    'plan_kind', case when v_family = 'marketing' then 'marketing' when v_family = 'core' then 'software' end, 'tier', t.code, 'tier_label', t.label,
    'doctors', v_doctors, 'doctors_included', t.max_doctors, 'staff', v_staff, 'staff_included', v_allow, 'beds', v_beds,
    'addons', to_jsonb(v_addons), 'bundle_pct', v_pct,
    'pharmacy_included', v_family = 'core' and 'ipd' = any(v_addons),
    'subscription_monthly', v_core + v_extra_doctors * v_extra_doc_price + v_staff_cost,
    'addons_monthly', v_addon_sum - v_disc,
    'monthly', v_monthly, 'months', p_months, 'factor', v_factor,
    'lines', (select jsonb_agg(l || jsonb_build_object('amount', round((l->>'monthly')::numeric * v_factor))) from jsonb_array_elements(v_lines) l),
    'total', round(v_monthly * v_factor));
end $$;
revoke all on function sehat_plan_quote(uuid, integer, text[], text, integer, integer, integer, text, text) from public;
grant execute on function sehat_plan_quote(uuid, integer, text[], text, integer, integer, integer, text, text) to anon, authenticated, service_role;

create or replace function sehat_apply_plan_addons(p_business uuid, p_addons text[], p_only_raise boolean default false)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  b businesses;
  v_ipd boolean := 'ipd' = any(p_addons);
  v_path boolean := 'pathology' = any(p_addons);
  v_diag boolean := 'diagnostics' = any(p_addons);
  v_pharm boolean := 'pharmacy' = any(p_addons);
  v_social boolean := 'social' = any(p_addons);
  v_slug text;
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
  v_social := v_social or 'social' = any(coalesce(b.free_addons, '{}')) or (p_only_raise and b.social_addon);
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
    -- 0309: the core plan is OPD; the marketing plan has none.
    opd_module = coalesce(b.plan_kind, 'software') <> 'marketing',
    social_addon = v_social,
    ipd_module = v_ipd,
    pharmacy_module = v_pharm,
    pharmacy_module_since = case when v_pharm and not pharmacy_module then now() else pharmacy_module_since end,
    lab_module = cardinality(v_cats) > 0,
    lab_categories = case when cardinality(v_cats) > 0 then v_cats else lab_categories end,
    lab_module_set_by = 'plan'
   where id = p_business;
  -- 0309: social (website and hosting) gives the full website — raised here,
  -- never lowered (an admin gives some sites the full tier without it). A
  -- business with no website yet gets one, its address made from its name.
  if v_social then
    if exists (select 1 from business_sites where business_id = p_business) then
      update business_sites set tier = 'full', updated_at = now() where business_id = p_business and tier <> 'full';
    else
      v_slug := left(trim(both '-' from regexp_replace(lower(coalesce(b.name, '')), '[^a-z0-9]+', '-', 'g')), 40);
      if length(v_slug) < 3 then v_slug := 'clinic-' || left(replace(p_business::text, '-', ''), 8); end if;
      if exists (select 1 from business_sites where slug = v_slug) then v_slug := v_slug || '-' || left(replace(p_business::text, '-', ''), 6); end if;
      insert into business_sites (business_id, slug, is_live, tier) values (p_business, v_slug, true, 'full')
      on conflict (business_id) do nothing;
    end if;
  end if;
end $$;

create or replace function sehat_set_renewal_plan_addons(p_business uuid, p_addons text[])
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()) then
    raise exception 'Only the owner can change the plan.' using errcode = '42501';
  end if;
  update businesses set renewal_plan_addons = array(select distinct x from unnest(coalesce(p_addons, '{}')) x
                                                     where x in ('ipd', 'pathology', 'diagnostics', 'pharmacy', 'social') order by x)
   where id = p_business;
end $$;
revoke all on function sehat_set_renewal_plan_addons(uuid, text[]) from public, anon;
grant execute on function sehat_set_renewal_plan_addons(uuid, text[]) to authenticated;

-- An admin moves a business between the OPD plan and the marketing plan. To
-- marketing: OPD and IPD go off (data stays); to the OPD plan: OPD comes on.
-- What it pays changes at its next renewal, or at once via Plan.
create or replace function sehat_admin_set_plan_kind(p_business uuid, p_kind text)
returns text language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then
    raise exception 'Only a Sehatsandhi admin can change the plan.' using errcode = '42501';
  end if;
  if p_kind not in ('software', 'marketing') then
    raise exception 'Plan must be software or marketing.' using errcode = 'P0001';
  end if;
  update businesses set plan_kind = p_kind,
         opd_module = case when vertical in ('clinic', 'hospital') then p_kind = 'software' else opd_module end,
         ipd_module = case when p_kind = 'marketing' then false else ipd_module end
   where id = p_business;
  return p_kind;
end $$;
revoke all on function sehat_admin_set_plan_kind(uuid, text) from public, anon;
grant execute on function sehat_admin_set_plan_kind(uuid, text) to authenticated;

notify pgrst, 'reload schema';
