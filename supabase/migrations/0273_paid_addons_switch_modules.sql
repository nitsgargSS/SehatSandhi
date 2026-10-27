-- ============================================================================
-- 0273 — What is paid for is what is on (with the plans of 0272)
-- ============================================================================
-- A payment now records the add-ons it bought (payments.plan_addons) and the
-- plan it was priced at (payments.plan_tier). When it is fulfilled:
--   - an add-on bought is switched on at once (a business never waits for
--     something it has paid for);
--   - an add-on NOT bought is switched off only when the paid term starts
--     (businesses.next_addons / next_addons_from, applied every morning) —
--     so nobody loses days already paid for, and a renewal paid early does not
--     take anything away early.
-- Switching a module off hides its tab; it never deletes anything.
--
-- The renewal price follows the plans too, once they are live, so the reminder
-- quotes what the checkout will charge.
-- ============================================================================

alter table payments add column if not exists plan_addons text[];
alter table payments add column if not exists plan_tier text;
alter table businesses add column if not exists next_addons text[];
alter table businesses add column if not exists next_addons_from date;
-- What the owner has chosen for the next renewal (null: what is on now).
alter table businesses add column if not exists renewal_plan_addons text[];

-- Set the module switches to exactly these add-ons. Clinics and hospitals
-- only; a lab's kind and a store's pharmacy are fixed by what they are.
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
      update businesses set
        pharmacy_module = v_pharm or (p_only_raise and pharmacy_module),
        opd_module = opd_module or (coalesce(lab_categories, '{}') && array['radiology', 'cardiology'])
       where id = p_business;
    end if;
    return;
  end if;
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
revoke all on function sehat_apply_plan_addons(uuid, text[], boolean) from public, anon, authenticated;
grant execute on function sehat_apply_plan_addons(uuid, text[], boolean) to service_role;

-- On payment: switch on what was bought now; what was left out goes when the
-- paid term starts.
create or replace function sehat_fulfil_plan_addons(p_payment uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p payments;
begin
  select * into p from payments where id = p_payment and status = 'paid';
  if p.id is null or p.plan_addons is null or p.business_id is null then return; end if;
  perform sehat_apply_plan_addons(p.business_id, p.plan_addons, true);
  update businesses set next_addons = p.plan_addons, next_addons_from = coalesce(p.term_start, current_date),
                        renewal_plan_addons = p.plan_addons
   where id = p.business_id;
  if coalesce(p.term_start, current_date) <= (now() at time zone 'Asia/Kolkata')::date then
    perform sehat_apply_plan_addons(p.business_id, p.plan_addons, false);
    update businesses set next_addons = null, next_addons_from = null where id = p.business_id;
  end if;
end $$;
revoke all on function sehat_fulfil_plan_addons(uuid) from public, anon, authenticated;
grant execute on function sehat_fulfil_plan_addons(uuid) to service_role;

-- Every morning: terms that started today take their add-ons exactly.
create or replace function sehat_apply_due_plan_addons()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id, next_addons from businesses
            where next_addons is not null and next_addons_from <= (now() at time zone 'Asia/Kolkata')::date loop
    perform sehat_apply_plan_addons(r.id, r.next_addons, false);
    update businesses set next_addons = null, next_addons_from = null where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_apply_due_plan_addons() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'apply-plan-addons';
  -- 00:35 UTC is 6:05 in India, before anyone opens the dashboard.
  perform cron.schedule('apply-plan-addons', '35 0 * * *', $job$ select sehat_apply_due_plan_addons() $job$);
end $$;

-- The owner chooses the add-ons for the next renewal.
create or replace function sehat_set_renewal_plan_addons(p_business uuid, p_addons text[])
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_caller_is_owner(p_business) or sehat_is_admin()) then
    raise exception 'Only the owner can change the plan.' using errcode = '42501';
  end if;
  update businesses set renewal_plan_addons = array(select distinct x from unnest(coalesce(p_addons, '{}')) x
                                                     where x in ('ipd', 'pathology', 'diagnostics', 'pharmacy') order by x)
   where id = p_business;
end $$;
revoke all on function sehat_set_renewal_plan_addons(uuid, text[]) from public, anon;
grant execute on function sehat_set_renewal_plan_addons(uuid, text[]) to authenticated;

-- Renewal reminders quote the plan, once the plans are live.
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

  if (select tiered_live from plan_settings where id) then
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

notify pgrst, 'reload schema';
