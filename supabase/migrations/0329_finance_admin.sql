-- ============================================================================
-- 0329 — Treatment on EMI: the admin side (step 5)
-- ============================================================================
-- AFTER 0328. Safe to re-run. Plan: docs/2026-11-finance-emi-phase1.md.
--
--   sehat_admin_lender_create(...)    a lender's account: a business with vertical
--                                     'lender' (active, so its owner can log in by
--                                     WhatsApp code on its phone like any business)
--                                     and a draft profile, status 'pending'. Patients
--                                     see it only after sehat_admin_lender_set
--                                     approves it (0326: needs the LSP agreement date).
--   sehat_admin_finance_switch(on)    site_settings 'finance_enabled'. Admins only
--                                     (not managers).
--   sehat_finance_expire_stale()      cases with no movement for 15 days before a
--                                     sanction → 'expired'; daily at 02:45 IST.
--   sehat_admin_finance_commission()  loans paid out in a period, per lender, with
--                                     the commission at each lender's agreed rate.
--
-- Admins read every finance table directly (0326's RLS); managers read none.
-- ============================================================================

create or replace function sehat_admin_lender_create(p_name text, p_phone text, p_email text,
                                                     p_legal_name text, p_entity_type text default 'nbfc')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_legal_name, '')) = '' then
    raise exception 'Name and legal name are needed.' using errcode = '22023';
  end if;
  if v_phone !~ '^[6-9]\d{9}$' then
    raise exception 'A 10-digit WhatsApp mobile number is needed — the lender logs in with a code sent to it.' using errcode = '22023';
  end if;
  if coalesce(p_entity_type, 'nbfc') not in ('bank', 'nbfc') then raise exception 'Type is bank or NBFC.' using errcode = '22023'; end if;
  insert into businesses (name, vertical, status, phone, email)
  values (btrim(p_name), 'lender', 'active', v_phone, nullif(lower(btrim(coalesce(p_email, ''))), ''))
  returning id into v_id;
  insert into lender_profiles (business_id, legal_name, entity_type, status)
  values (v_id, btrim(p_legal_name), coalesce(p_entity_type, 'nbfc'), 'pending');
  return v_id;
end $$;
revoke all on function sehat_admin_lender_create(text, text, text, text, text) from public, anon;
grant execute on function sehat_admin_lender_create(text, text, text, text, text) to authenticated;

create or replace function sehat_admin_finance_switch(p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  insert into site_settings (key, value) values ('finance_enabled', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
revoke all on function sehat_admin_finance_switch(boolean) from public, anon;
grant execute on function sehat_admin_finance_switch(boolean) to authenticated;

-- ── Expiry: 15 days without movement, before any sanction ───────────────────
create or replace function sehat_finance_expire_stale()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from finance_cases
            where status in ('requested', 'hospital_confirmed', 'shared', 'offered')
              and updated_at < now() - interval '15 days'
            for update skip locked loop
    update finance_cases set status = 'expired', closed_reason = 'no action in 15 days', updated_at = now() where id = r.id;
    update finance_case_lenders set status = 'withdrawn', updated_at = now() where case_id = r.id and status in ('shared', 'offered');
    perform sehat_finance_log(r.id, null, 'system', 'expired', 'No action in 15 days');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_finance_expire_stale() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'finance-expiry';
    perform cron.schedule('finance-expiry', '15 21 * * *', 'select sehat_finance_expire_stale()');   -- 02:45 IST
  end if;
end $$;

-- ── Commission: loans paid out in a period, per lender ──────────────────────
create or replace function sehat_admin_finance_commission(p_from date, p_to date)
returns table (lender_id uuid, legal_name text, commission_pct numeric, loans integer, paid_value numeric, commission numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  return query
    select lp.business_id, lp.legal_name, lp.commission_pct,
           count(l.id)::integer, coalesce(sum(l.disbursed_amount), 0),
           round(coalesce(sum(l.disbursed_amount), 0) * coalesce(lp.commission_pct, 0) / 100, 2)
      from lender_profiles lp
      join finance_case_lenders l on l.lender_id = lp.business_id and l.status = 'disbursed'
                                 and l.disbursed_on between p_from and p_to
     group by lp.business_id, lp.legal_name, lp.commission_pct
     order by 5 desc;
end $$;
revoke all on function sehat_admin_finance_commission(date, date) from public, anon;
grant execute on function sehat_admin_finance_commission(date, date) to authenticated;

notify pgrst, 'reload schema';
