-- ============================================================================
-- 0281 — The review demo clinic runs OPD, IPD and WhatsApp while staying hidden
-- ============================================================================
-- "Sehatsandhi Demo Clinic (Play review)" (0206) is 'pending' on purpose: a
-- pending listing is never shown to patients. But OPD and IPD are live only for
-- an ACTIVE business (business_modules, sehat_business_has_module), so the demo
-- had no Patients tab and could not write or send a prescription — which is
-- exactly what Meta's App Review needs to see (28 Oct 2026).
--
-- businesses.is_demo: a business that may use what it has switched on without
-- being active. Set only here, for the one demo; nothing in the product sets it.
-- It stays pending, so it stays out of search.
-- ============================================================================

alter table businesses add column if not exists is_demo boolean not null default false;
comment on column businesses.is_demo is
  '0281: the app-review demo clinic. Its modules work while it stays pending (hidden from patients). Set by migration only.';

update businesses
   set is_demo = true, opd_module = true, ipd_module = true
 where email = 'nits.garg+playreview@gmail.com'
   and name = 'Sehatsandhi Demo Clinic (Play review)';

-- WhatsApp switched on and never billed (0157), on Pro so the reviewer sees
-- the automatic messages and the own-number connect (0261, 0262).
insert into business_wa_accounts (business_id, status, subscription_status, complimentary, plan)
select id, 'live', 'active', true, 'pro' from businesses where is_demo
on conflict (business_id) do update
   set status = 'live', subscription_status = 'active', complimentary = true, plan = 'pro';

-- ── Is a module live? Active and in term — or the demo ──────────────────────

create or replace function sehat_business_has_module(p_business uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case p_code
             when 'opd' then b.opd_module
             when 'ipd' then b.ipd_module
             else false
           end
       and (b.is_demo or (b.status = 'active'
       -- No term recorded is treated as live: businesses created before billing
       -- existed, and admin-activated listings, have never had one.
       and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date)))
      from businesses b where b.id = p_business
  ), false);
$$;

create or replace view business_modules as
  select
    b.id as business_id,
    b.opd_module,
    b.ipd_module,
    b.term_end,
    (b.is_demo or (b.status = 'active'
      and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date))) as term_live,
    (b.opd_module and (b.is_demo or (b.status = 'active'
      and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date)))) as opd_live,
    (b.ipd_module and (b.is_demo or (b.status = 'active'
      and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date)))) as ipd_live
  from businesses b
 where b.id in (select sehat_caller_business_ids());

-- CREATE OR REPLACE keeps these, but say so rather than rely on it (0074).
alter view business_modules set (security_invoker = true);
revoke select on business_modules from anon;
grant select on business_modules to authenticated;

notify pgrst, 'reload schema';
