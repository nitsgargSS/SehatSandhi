-- ============================================================================
-- 0277 — Labs keep their patients; diagnostic centres run an OPD
-- ============================================================================
-- With the lab plans (0272):
--   Pathology Lab — registers its patients and keeps every report under the
--     patient (the Patients tab, without visits and prescriptions).
--   Diagnostic Centre (and with pathology) — the same, plus OPD for its
--     doctors: queue, visits, prescriptions.
-- OPD here is the lab's kind, not a separate purchase: choosing a diagnostic
-- kind switches it on, choosing pathology only switches it off (records are
-- kept either way).
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
    -- 0277: a diagnostic centre's plan includes OPD for its doctors; a
    -- pathology lab keeps patients and their reports, without OPD.
    update businesses set lab_categories = v_cats,
           opd_module = v_cats && array['radiology', 'cardiology']
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

update businesses set opd_module = coalesce(lab_categories, '{}') && array['radiology', 'cardiology']
 where vertical = 'lab' and opd_module is distinct from (coalesce(lab_categories, '{}') && array['radiology', 'cardiology']);

notify pgrst, 'reload schema';
