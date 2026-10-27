-- ============================================================================
-- 0272 — Plans by the number of doctors, and paid add-ons
-- ============================================================================
-- Decided 27 Oct 2026. Until now every business paid one price (₹2,000 a
-- month) with OPD, IPD, the lab's cardiology tests and the pharmacy free. Now:
--
--   CORE (clinics and hospitals): the plan follows the number of doctors —
--     Clinic ≤ 2 (₹2,000), Polyclinic ≤ 4 (₹3,000), Multi-speciality ≤ 8
--     (₹5,000), Hospital ≤ 15 (₹8,000), then ₹400 for each doctor beyond.
--     Each includes staff logins (3 / 6 / 12 / 25); every 5 more cost ₹250.
--   ADD-ONS: IPD ₹2,000 with 20 beds (₹75 a bed beyond), Pathology ₹1,500,
--     Diagnostics ₹3,000, Pharmacy ₹1,000. Pathology and Diagnostics each
--     bring 2 more logins for their technicians. Two add-ons: 10% off the
--     add-ons; three or more: 20% off.
--   LABS AND STORES: Pathology Lab ₹2,000, Diagnostic Centre ₹4,000 (with OPD
--     for its doctors), Diagnostic + Pathology ₹5,000, Pharmacy ₹1,500.
--   TERMS: 6 months costs 5 months' price, 12 months costs 9.
--
-- Every number is a row here, edited in the admin panel.
--
-- One function prices it all — sehat_plan_quote — from the business's own
-- doctors, staff and beds, so the checkout, the plan screen and the renewal
-- reminder can never disagree. Nothing changes until an admin switches the new
-- model on (plan_settings.tiered_live): until then pricing is exactly as before.
-- ============================================================================

create table if not exists plan_settings (
  id boolean primary key default true check (id),
  tiered_live boolean not null default false,
  months6_factor numeric(5,2) not null default 5,
  months12_factor numeric(5,2) not null default 9,
  staff_pack_size integer not null default 5 check (staff_pack_size > 0),
  staff_pack_price integer not null default 250 check (staff_pack_price >= 0),
  bundle2_pct numeric(5,2) not null default 10 check (bundle2_pct between 0 and 100),
  bundle3_pct numeric(5,2) not null default 20 check (bundle3_pct between 0 and 100),
  ipd_beds_included integer not null default 20 check (ipd_beds_included >= 0),
  ipd_bed_price integer not null default 75 check (ipd_bed_price >= 0),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into plan_settings (id) values (true) on conflict do nothing;

create table if not exists plan_tiers (
  code text primary key,
  -- core: clinics and hospitals, chosen by doctors; the rest: one plan each.
  family text not null check (family in ('core', 'lab_pathology', 'lab_diagnostic', 'lab_both', 'pharmacy')),
  label text not null,
  max_doctors integer not null check (max_doctors >= 0),
  staff_included integer not null check (staff_included >= 0),
  monthly_price integer not null check (monthly_price >= 0),
  -- For the top core plan: each doctor beyond its cap. For the one-plan
  -- families: each doctor beyond max_doctors.
  extra_doctor_price integer not null default 0 check (extra_doctor_price >= 0),
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into plan_tiers (code, family, label, max_doctors, staff_included, monthly_price, extra_doctor_price, sort_order) values
  ('clinic',          'core',           'Clinic',                 2,  3, 2000,   0, 10),
  ('polyclinic',      'core',           'Polyclinic',             4,  6, 3000,   0, 20),
  ('multispeciality', 'core',           'Multi-speciality',       8, 12, 5000,   0, 30),
  ('hospital',        'core',           'Hospital',              15, 25, 8000, 400, 40),
  ('lab_pathology',   'lab_pathology',  'Pathology Lab',          1,  5, 2000, 500, 50),
  ('lab_diagnostic',  'lab_diagnostic', 'Diagnostic Centre',      2,  5, 4000, 500, 60),
  ('lab_both',        'lab_both',       'Diagnostic + Pathology', 2,  8, 5000, 500, 70),
  ('pharmacy',        'pharmacy',       'Pharmacy',               0,  5, 1500,   0, 80)
on conflict (code) do nothing;

create table if not exists plan_addons (
  code text primary key check (code in ('ipd', 'pathology', 'diagnostics', 'pharmacy')),
  label text not null,
  description text,
  monthly_price integer not null check (monthly_price >= 0),
  -- Staff logins it brings (lab technicians).
  logins_included integer not null default 0 check (logins_included >= 0),
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into plan_addons (code, label, description, monthly_price, logins_included, sort_order) values
  ('ipd', 'IPD', 'Wards and beds, admissions, drug chart, deposits, surgeries, discharge and the IPD bill', 2000, 0, 10),
  ('pathology', 'Pathology', 'Blood, urine and stool tests: orders, samples, home collection, results and signed reports, packages', 1500, 2, 20),
  ('diagnostics', 'Diagnostics', 'X-ray, ultrasound, CT, MRI, mammography, ECG, echo, TMT, Holter, PFT, EEG, NCV — and your own tests', 3000, 2, 30),
  ('pharmacy', 'Pharmacy', 'Stock and batches, GST bills, dues, purchases, issue to IPD', 1000, 0, 40)
on conflict (code) do nothing;

alter table plan_settings enable row level security;
alter table plan_tiers enable row level security;
alter table plan_addons enable row level security;
-- Prices are public: the website and the sign-up show them.
grant select on plan_settings, plan_tiers, plan_addons to anon, authenticated;
drop policy if exists anyone_reads_plan_settings on plan_settings;
create policy anyone_reads_plan_settings on plan_settings for select using (true);
drop policy if exists anyone_reads_plan_tiers on plan_tiers;
create policy anyone_reads_plan_tiers on plan_tiers for select using (true);
drop policy if exists anyone_reads_plan_addons on plan_addons;
create policy anyone_reads_plan_addons on plan_addons for select using (true);

-- ── What a business has switched on, as add-on codes ───────────────────────
create or replace function sehat_business_addons(p_business uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
           case when b.ipd_module then 'ipd' end,
           case when 'pathology' = any(coalesce(b.lab_categories, '{}')) and b.lab_module then 'pathology' end,
           case when (coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology']) and b.lab_module then 'diagnostics' end,
           case when b.pharmacy_module then 'pharmacy' end], null)
    from businesses b where b.id = p_business and b.vertical in ('clinic', 'hospital');
$$;

-- ── The quote ───────────────────────────────────────────────────────────────
-- p_addons null: what the business has on now. Counts default to the
-- business's own; the hints are for sign-up, before there is a business.
-- Returns null for business types this model does not price (insurance,
-- ambulance) — their pricing is unchanged.
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
                     where x in ('ipd', 'pathology', 'diagnostics', 'pharmacy')
                       and (v_family = 'core' or (x = 'pharmacy' and v_family like 'lab%'))
                     order by x);
  v_allow := t.staff_included;
  for a in select * from plan_addons where code = any(v_addons) and is_enabled order by sort_order loop
    v_line := a.monthly_price;
    if a.code = 'ipd' and v_beds > s.ipd_beds_included then v_line := v_line + (v_beds - s.ipd_beds_included) * s.ipd_bed_price; end if;
    v_addon_sum := v_addon_sum + v_line;
    v_allow := v_allow + a.logins_included;
    v_lines := v_lines || jsonb_build_object('kind', 'addon', 'code', a.code,
      'label', a.label || case when a.code = 'ipd' then ' — ' || greatest(v_beds, 0) || ' beds' || case when v_beds > s.ipd_beds_included
                 then ' (' || s.ipd_beds_included || ' included, ' || (v_beds - s.ipd_beds_included) || ' × ₹' || s.ipd_bed_price || ')' else '' end else '' end,
      'monthly', v_line);
  end loop;
  v_pct := case when cardinality(v_addons) >= 3 then s.bundle3_pct when cardinality(v_addons) = 2 then s.bundle2_pct else 0 end;
  v_disc := round(v_addon_sum * v_pct / 100.0);
  if v_disc > 0 then
    v_lines := v_lines || jsonb_build_object('kind', 'bundle', 'label', 'Bundle discount — ' || trim_scale(v_pct) || '% off ' || cardinality(v_addons) || ' add-ons',
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
    'live', s.tiered_live, 'family', v_family, 'tier', t.code, 'tier_label', t.label,
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

-- ── Admins edit the numbers ─────────────────────────────────────────────────
-- p: { settings: {...}, tiers: [{code, monthly_price, max_doctors, staff_included, extra_doctor_price, is_enabled}], addons: [{code, monthly_price, logins_included, is_enabled}] }
create or replace function sehat_admin_set_plan_pricing(p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  x jsonb;
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
end $$;
revoke all on function sehat_admin_set_plan_pricing(jsonb) from public, anon;
grant execute on function sehat_admin_set_plan_pricing(jsonb) to authenticated;

notify pgrst, 'reload schema';
