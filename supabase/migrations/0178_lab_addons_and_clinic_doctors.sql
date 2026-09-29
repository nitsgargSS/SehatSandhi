-- ============================================================================
-- Sehatsandhi — in-clinic test add-ons; clinics pay for extra doctors, up to 3
--
-- Run AFTER 0177. Safe to re-run.
--
-- Decided 29 Sep 2026:
--
--   ADD-ONS (clinics and hospitals; a lab is its kind instead, 0177)
--   • Heart tests & X-ray — ECG, 2D echo, TMT and X-ray: FREE. The owner or a
--     manager switches it on from Plan → Add-ons. X-ray moves into this group
--     (catalogue category 'cardiology'): a general physician may have an X-ray
--     machine as a cardiologist has an echo. Radiology labs keep X-ray — their
--     kind is radiology + cardiology.
--   • Pathology — ₹1,000/month + GST. Radiology (ultrasound, CT, MRI,
--     mammography) — ₹1,000/month + GST. Bought mid-term pro rata for the rest
--     of the term (lab-addon-order), then renewed with the plan (computePrice
--     adds them from businesses.renewal_addons).
--   • Prices live in addon_prices and are edited in the Sehatsandhi admin.
--
--   DOCTORS
--   • A clinic pays for extra doctors as a hospital does: 1 included, then
--     ₹1,000/month each, pro rata mid-term (0140). Both editable per type in
--     the admin's type pricing.
--   • A clinic has at most 3 doctors (owner-doctor included). More than that is
--     a hospital. Refused by a trigger, whichever way the doctor arrives.
--     Existing clinics over 3 keep their doctors; they just cannot add more.
-- ============================================================================

-- ── Add-on prices ───────────────────────────────────────────────────────────
create table if not exists addon_prices (
  code text primary key check (code in ('pathology', 'radiology', 'cardiology')),
  label text not null,
  monthly_price integer not null default 0 check (monthly_price >= 0),   -- rupees before GST
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into addon_prices (code, label, monthly_price, sort_order) values
  ('cardiology', 'Heart tests & X-ray (ECG, 2D echo, TMT, X-ray)', 0, 1),
  ('pathology',  'Pathology (blood, urine and stool tests)', 1000, 2),
  ('radiology',  'Radiology (ultrasound, CT, MRI, mammography)', 1000, 3)
on conflict (code) do nothing;

alter table addon_prices enable row level security;
drop policy if exists "anyone_reads_addon_prices" on addon_prices;
create policy "anyone_reads_addon_prices" on addon_prices for select using (true);
grant select on addon_prices to anon, authenticated;
revoke insert, update, delete on addon_prices from anon, authenticated;

create or replace function sehat_admin_set_addon_price(p_code text, p_monthly_price integer, p_enabled boolean default true)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if coalesce(p_monthly_price, -1) < 0 then raise exception 'Enter a price of 0 or more.' using errcode = 'P0001'; end if;
  update addon_prices set monthly_price = p_monthly_price, is_enabled = coalesce(p_enabled, true),
         updated_by = (select email from auth.users where id = auth.uid()), updated_at = now()
   where code = p_code;
  if not found then raise exception 'No such add-on.' using errcode = 'P0002'; end if;
end $$;
revoke all on function sehat_admin_set_addon_price(text, integer, boolean) from public, anon;
grant execute on function sehat_admin_set_addon_price(text, integer, boolean) to authenticated;

-- ── What a business has, and what it renews ─────────────────────────────────
-- lab_categories (0177) is what is ON. renewal_addons is what the next plan
-- payment charges for: the paid ones a business has bought and kept.
alter table businesses add column if not exists renewal_addons text[] not null default '{}';
-- What a payment bought, for fulfilment and the invoice.
alter table payments add column if not exists addon_codes text[] not null default '{}';

-- ── X-ray joins the free heart-tests group ──────────────────────────────────
update lab_catalogue set category = 'cardiology' where name ilike 'X-Ray%' and category <> 'cardiology';
update lab_tests t set category = 'cardiology'
  from lab_catalogue c
 where t.catalogue_code = c.code and c.name ilike 'X-Ray%' and t.category <> 'cardiology';

-- ── Switching kinds on and off (0177's function, now aware of prices) ───────
-- A lab: owner/manager sets its one kind (unchanged).
-- A clinic/hospital: owner/manager may switch on free kinds, and switch off
-- anything. A paid kind comes on only through payment (fulfilment) or an admin.
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
           lab_module_set_by = coalesce((select email from auth.users where id = auth.uid()), 'owner')
     where id = p_business;
  end if;
  return (select jsonb_build_object('lab_categories', lab_categories, 'lab_module', lab_module or vertical = 'lab',
                                    'renewal_addons', renewal_addons)
            from businesses where id = p_business);
end $$;
revoke all on function sehat_set_lab_tests(uuid, text[]) from public, anon;
grant execute on function sehat_set_lab_tests(uuid, text[]) to authenticated;

-- Fulfilment (service role) switches on what was paid for, and renews it.
drop function if exists sehat_grant_paid_addons(uuid);
create or replace function sehat_grant_paid_addons(p_payment_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p record;
begin
  select business_id, addon_codes into p from payments where id = p_payment_id and status = 'paid';
  if p.business_id is null or cardinality(p.addon_codes) = 0 then return; end if;
  update businesses
     set lab_categories = array(select distinct c from unnest(coalesce(lab_categories, '{}') || p.addon_codes) c order by c),
         lab_module = true,
         renewal_addons = array(select distinct c from unnest(renewal_addons || p.addon_codes) c order by c),
         lab_module_set_by = 'payment'
   where id = p.business_id and vertical <> 'lab';
end $$;
revoke all on function sehat_grant_paid_addons(uuid) from public, anon, authenticated;

-- ── Clinics: 1 doctor included, ₹1,000 per extra (editable in admin) ───────
update vertical_billing set included_doctors = 1, extra_doctor_price = 1000
 where vertical = 'clinic' and included_doctors = 0 and extra_doctor_price = 0;

-- ── Clinics: at most 3 doctors ──────────────────────────────────────────────
create or replace function sehat_clinic_doctor_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if new.role not in ('doctor', 'owner') or new.status = 'suspended' then return new; end if;
  -- Only when this row BECOMES a doctor here: joined, came back, or promoted.
  if tg_op = 'UPDATE' and old.role in ('doctor', 'owner') and old.status <> 'suspended' then return new; end if;
  if (select vertical from businesses where id = new.business_id) is distinct from 'clinic' then return new; end if;
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
drop trigger if exists b_clinic_doctor_cap on business_practitioners;
create trigger b_clinic_doctor_cap before insert or update of role, status on business_practitioners
  for each row execute function sehat_clinic_doctor_cap();

notify pgrst, 'reload schema';
