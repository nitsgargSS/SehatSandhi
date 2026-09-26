-- ============================================================================
-- Sehatsandhi — a doctor added mid-term is paid for pro rata, then renews with
--               the plan; a doctor who leaves stops costing from renewal
--
-- Run AFTER 0139. Safe to re-run.
--
-- Decided 26 Sep 2026:
--
--   Adding   If the new doctor takes the business past the doctors its plan
--            includes (vertical_billing: a hospital includes 1, then ₹1,000 a
--            month each), the doctor is held — status 'pending', awaiting_payment
--            — until the business pays that extra fee for the days left in its
--            current term (doctor-addon-order). Fulfilment then makes the doctor
--            live. From the next renewal the doctor is part of the normal price:
--            renewals count every doctor not suspended (sehat_business_doctor_count).
--            Within the included seats, with no paid term running, or when
--            Sehatsandhi admin adds them, the doctor goes live at once as before.
--
--   Removing Already so (sehat_detach_practitioner): the AFFILIATION is
--            suspended, never the doctor. They keep their profile and other
--            clinics, lose this clinic's dashboard and patients the same moment
--            (sehat_caller_role ignores suspended affiliations, 0138 follows it),
--            drop off its listing, and stop being counted at the next renewal.
--            Nothing is refunded mid-term.
--
-- 0131's "joins a live business" trigger fired only on INSERT, so a doctor
-- brought back after leaving (sehat_attach_practitioner revives the row by
-- UPDATE) was never made live. This replaces it and covers both.
-- ============================================================================

alter table business_practitioners add column if not exists awaiting_payment boolean not null default false;
alter table payments add column if not exists addon_practitioner_id uuid references practitioners(id) on delete set null;

-- What one more doctor costs a month here, before this one is counted.
create or replace function sehat_extra_doctor_monthly(p_business uuid, p_practitioner uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
           when coalesce(vb.extra_doctor_price, 0) > 0
                and (select count(*) from business_practitioners bp
                      where bp.business_id = p_business and bp.role = 'doctor'
                        and bp.status <> 'suspended' and bp.practitioner_id <> p_practitioner)
                    >= coalesce(vb.included_doctors, 0)
           then vb.extra_doctor_price else 0 end
    from businesses b
    left join vertical_billing vb on vb.vertical = b.vertical
   where b.id = p_business
$$;
revoke all on function sehat_extra_doctor_monthly(uuid, uuid) from public, anon;
grant execute on function sehat_extra_doctor_monthly(uuid, uuid) to authenticated;

create or replace function sehat_affiliation_joins_live_business()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b record;
begin
  -- Only a doctor joining (insert) or coming back (suspended → not suspended).
  if new.status = 'suspended' then return new; end if;
  if tg_op = 'UPDATE' and old.status is distinct from 'suspended' then return new; end if;

  select status, term_end into b from businesses where id = new.business_id;
  if b.status is distinct from 'active' then return new; end if;   -- activates with the business (0131)

  if new.role = 'doctor' and not sehat_is_admin()
     and b.term_end is not null and b.term_end > (now() at time zone 'Asia/Kolkata')::date
     and coalesce(sehat_extra_doctor_monthly(new.business_id, new.practitioner_id), 0) > 0 then
    new.status := 'pending';
    new.awaiting_payment := true;
    return new;
  end if;

  new.status := 'active';
  new.awaiting_payment := false;
  update practitioners set status = 'active' where id = new.practitioner_id and status = 'pending';
  return new;
end $$;

drop trigger if exists business_practitioners_join_live on business_practitioners;
create trigger business_practitioners_join_live
  before insert or update of status on business_practitioners
  for each row execute function sehat_affiliation_joins_live_business();

-- 0131 activates a business's pending doctors when it goes live; a doctor
-- awaiting payment stays held.
create or replace function sehat_activate_business_doctors(p_business uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update practitioners p set status = 'active'
   where p.status = 'pending'
     and exists (select 1 from business_practitioners bp
                  where bp.practitioner_id = p.id and bp.business_id = p_business
                    and bp.status <> 'suspended' and not bp.awaiting_payment);
  update business_practitioners set status = 'active'
   where business_id = p_business and status = 'pending' and not awaiting_payment;
end $$;

-- Fulfilment calls this once the pro-rata payment has arrived.
create or replace function sehat_release_paid_doctor(p_business uuid, p_practitioner uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update business_practitioners set status = 'active', awaiting_payment = false
   where business_id = p_business and practitioner_id = p_practitioner and awaiting_payment;
  update practitioners set status = 'active' where id = p_practitioner and status = 'pending';
end $$;
revoke all on function sehat_release_paid_doctor(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
