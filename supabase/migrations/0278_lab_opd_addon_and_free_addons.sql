-- ============================================================================
-- 0278 — OPD for a pathology lab is an add-on; an admin can give any add-on free
-- ============================================================================
-- A Pathology Lab plan keeps patients and their reports (0277). Its own OPD —
-- queue, visits, prescriptions, a consultation fee — is now an add-on (₹1,000
-- a month to start, editable in the admin, counted in the bundle discount).
-- A Diagnostic Centre's plan includes OPD, and a clinic's plan IS OPD.
--
-- Some labs and clinics get an add-on free, decided one by one: an admin sets
-- businesses.free_addons. A free add-on is switched on at once, priced ₹0 on
-- the quote ("free for you"), left out of the bundle count, and never switched
-- off by a renewal that did not include it.
--
-- And uploaded report files — the scan, X-ray film or PDF a lab uploads (0169)
-- — now appear in the patient's own records (My health) beside the signed
-- reports, as lab_files: sent on WhatsApp before, but not kept for the patient.
-- ============================================================================

alter table plan_addons drop constraint if exists plan_addons_code_check;
alter table plan_addons add constraint plan_addons_code_check check (code in ('ipd', 'pathology', 'diagnostics', 'pharmacy', 'opd'));
insert into plan_addons (code, label, description, monthly_price, logins_included, sort_order)
values ('opd', 'OPD', 'For a pathology lab: queue, visits, prescriptions and consultation fees for your doctors', 1000, 0, 50)
on conflict (code) do nothing;

alter table businesses add column if not exists free_addons text[] not null default '{}';

-- What a business has on now, as add-on codes (0272, and labs since 0278).
create or replace function sehat_business_addons(p_business uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when b.vertical in ('clinic', 'hospital') then array_remove(array[
           case when b.ipd_module then 'ipd' end,
           case when 'pathology' = any(coalesce(b.lab_categories, '{}')) and b.lab_module then 'pathology' end,
           case when (coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology']) and b.lab_module then 'diagnostics' end,
           case when b.pharmacy_module then 'pharmacy' end], null)
    when b.vertical = 'lab' then array_remove(array[
           case when b.opd_module and not (coalesce(b.lab_categories, '{}') && array['radiology', 'cardiology']) then 'opd' end,
           case when b.pharmacy_module then 'pharmacy' end], null)
  end
    from businesses b where b.id = p_business;
$$;

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
    if not sehat_is_admin() and (select tiered_live from plan_settings where id)
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

-- An admin gives (or takes back) add-ons free for one business.
create or replace function sehat_admin_set_free_addons(p_business uuid, p_addons text[])
returns text[] language plpgsql volatile security definer set search_path = public as $$
declare
  v text[] := array(select distinct x from unnest(coalesce(p_addons, '{}')) x
                     where x in ('ipd', 'pathology', 'diagnostics', 'pharmacy', 'opd') order by x);
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  update businesses set free_addons = v where id = p_business;
  if not found then raise exception 'No such business.' using errcode = 'P0002'; end if;
  -- Switch on what is now free; nothing is switched off here (a renewal does that).
  perform sehat_apply_plan_addons(p_business, v, true);
  return v;
end $$;
revoke all on function sehat_admin_set_free_addons(uuid, text[]) from public, anon;
grant execute on function sehat_admin_set_free_addons(uuid, text[]) to authenticated;

-- ── The patient's own records: uploaded report files too ──
create or replace function sehat_my_records()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.full_name, 'relation', m.relation,
        'age', coalesce(date_part('year', age(current_date, m.date_of_birth))::integer, m.age_years), 'gender', m.gender) order by m.is_self desc, m.full_name)
      from patient_members m where m.id in (select sehat_my_members())), '[]'),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'member_id', v.patient_member_id, 'date', v.visit_date,
        'clinic', b.name, 'business_id', v.business_id, 'doctor', pr.full_name, 'complaint', v.chief_complaint,
        'diagnosis', v.diagnosis, 'advice', v.advice, 'follow_up', v.follow_up_due) order by v.visit_date desc nulls last)
      from patient_visits v join businesses b on b.id = v.business_id left join practitioners pr on pr.id = v.practitioner_id
      where v.patient_member_id in (select sehat_my_members()) and v.business_id is not null), '[]'),
    'prescriptions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'member_id', x.patient_member_id, 'no', x.prescription_no,
        'clinic', x.clinic_name, 'doctor', x.prescriber_name, 'date', x.issued_at, 'diagnosis', x.diagnosis) order by x.issued_at desc)
      from prescriptions x where x.patient_member_id in (select sehat_my_members()) and x.status = 'issued'), '[]'),
    'lab_reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'member_id', o.patient_member_id, 'no', r.report_no,
        'clinic', b.name, 'by', r.approved_by_name, 'date', r.approved_at) order by r.approved_at desc)
      from lab_reports r join lab_orders o on o.id = r.order_id join businesses b on b.id = r.business_id
      where o.patient_member_id in (select sehat_my_members())
        and r.version = (select max(r2.version) from lab_reports r2 where r2.order_id = r.order_id)), '[]'),
    -- 0278: report files a lab uploaded (scans, X-ray images, PDFs), while the lab keeps them.
    'lab_files', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'member_id', u.patient_member_id, 'title', u.title,
        'clinic', b.name, 'date', coalesce(u.report_date::timestamptz, u.created_at), 'mime', u.mime_type) order by u.created_at desc)
      from lab_uploaded_reports u join businesses b on b.id = u.business_id
      where u.patient_member_id in (select sehat_my_members())
        and (u.expires_on is null or u.expires_on >= current_date)), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'member_id', x.patient_member_id, 'no', x.bill_no,
        'clinic', x.clinic_name, 'date', x.issued_at, 'amount', x.net_payable, 'type', x.bill_type) order by x.issued_at desc)
      from patient_bills x where x.patient_member_id in (select sehat_my_members()) and x.status = 'issued'), '[]'),
    'discharges', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'member_id', x.patient_member_id, 'no', x.summary_no,
        'clinic', x.clinic_name, 'doctor', x.doctor_name, 'date', x.discharged_at, 'diagnosis', x.discharge_diagnosis) order by x.discharged_at desc)
      from discharge_summaries x where x.patient_member_id in (select sehat_my_members()) and x.status = 'issued'), '[]'),
    'clinics', coalesce((select jsonb_agg(c order by c ->> 'last_seen' desc nulls last) from (
        select jsonb_build_object('business_id', b.id, 'name', b.name, 'phone', b.phone, 'address', b.address,
          'last_seen', max(bp.last_seen_at),
          'unread', (select count(*) from clinic_messages cm where cm.business_id = b.id and cm.patient_phone = v_phone
                       and cm.sender = 'clinic' and cm.read_by_patient_at is null)) c
          from business_patients bp join businesses b on b.id = bp.business_id
         where bp.patient_member_id in (select sehat_my_members()) and bp.status = 'active'
         group by b.id, b.name, b.phone, b.address) t), '[]'),
    'site', sehat_site_url());
end $$;
revoke all on function sehat_my_records() from public, anon;
grant execute on function sehat_my_records() to authenticated;

create or replace function sehat_my_open(p_kind text, p_id uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_token text; v_mine boolean;
begin
  if p_kind = 'rx' then
    select public_token::text, patient_member_id in (select sehat_my_members()) into v_token, v_mine from prescriptions where id = p_id and status = 'issued';
    if v_mine then update prescriptions set token_expires_at = greatest(coalesce(token_expires_at, now()), now() + interval '30 days') where id = p_id; end if;
  elsif p_kind = 'lab' then
    select r.public_token::text, o.patient_member_id in (select sehat_my_members()) into v_token, v_mine
      from lab_reports r join lab_orders o on o.id = r.order_id where r.id = p_id;
    if v_mine then update lab_reports set token_expires_at = greatest(token_expires_at, now() + interval '30 days') where id = p_id; end if;
  elsif p_kind = 'bill' then
    select public_token::text, patient_member_id in (select sehat_my_members()) into v_token, v_mine from patient_bills where id = p_id and status = 'issued';
    if v_mine then update patient_bills set token_expires_at = greatest(coalesce(token_expires_at, now()), now() + interval '30 days') where id = p_id; end if;
  elsif p_kind = 'ds' then
    select public_token::text, patient_member_id in (select sehat_my_members()) into v_token, v_mine from discharge_summaries where id = p_id and status = 'issued';
    if v_mine then update discharge_summaries set token_expires_at = greatest(coalesce(token_expires_at, now()), now() + interval '30 days') where id = p_id; end if;
  elsif p_kind = 'file' then
    -- 0278: an uploaded report file; its link lasts as long as the lab keeps the file.
    select public_token::text, patient_member_id in (select sehat_my_members()) into v_token, v_mine
      from lab_uploaded_reports where id = p_id and (expires_on is null or expires_on >= current_date);
    if coalesce(v_mine, false) and v_token is not null then return sehat_site_url() || '/lab/file/' || v_token; end if;
  else
    raise exception 'Unknown record.' using errcode = '22023';
  end if;
  if not coalesce(v_mine, false) or v_token is null then raise exception 'That record is not on your number.' using errcode = '42501'; end if;
  return sehat_site_url() || '/' || p_kind || '/' || v_token;
end $$;
revoke all on function sehat_my_open(text, uuid) from public, anon;
grant execute on function sehat_my_open(text, uuid) to authenticated;

notify pgrst, 'reload schema';
