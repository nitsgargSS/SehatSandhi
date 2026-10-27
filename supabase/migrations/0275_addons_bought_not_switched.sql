-- ============================================================================
-- 0275 — Once the plans are live, add-ons are bought, not switched on
-- ============================================================================
-- Until now an owner could switch on the in-house pharmacy and the clinic's
-- heart tests for free. With the plans by doctors (0272) live, Pharmacy,
-- Pathology and Diagnostics are paid add-ons: switched on by paying for them
-- (plan-addon-order, or the renewal). Switching one OFF is still the owner's
-- choice at any time — it hides the tab, keeps every record, and stops it
-- renewing. Nothing changes while the plans are not live.
-- ============================================================================

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
    update businesses set lab_categories = v_cats where id = p_business;
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
  if coalesce(p_on, false) and not sehat_is_admin() and (select tiered_live from plan_settings where id)
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

notify pgrst, 'reload schema';
