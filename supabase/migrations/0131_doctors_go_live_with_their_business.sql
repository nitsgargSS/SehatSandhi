-- ============================================================================
-- Sehatsandhi — a live business's doctors are live too
--
-- Run AFTER 0130. Safe to re-run.
--
-- Found 26 Sep 2026: new clinics were paid and active, yet the WhatsApp bot and
-- the website never listed their doctors. Both read public_practitioner_
-- businesses, which requires the practitioner AND the affiliation to be
-- 'active'. Registration creates both as 'pending', and nothing ever moved
-- them on — payment and admin approval activate the business only, and there
-- is no screen that activates a doctor. So since 0037 every newly registered
-- doctor has been invisible. (Seed data was inserted active, which hid it.)
--
-- Now a doctor goes live with the business:
--   • when a business becomes active (paid, or approved by admin), its pending
--     affiliations and pending practitioners are activated;
--   • a doctor attached to a business that is already active starts active.
-- A suspended affiliation or practitioner is never touched: suspending is how
-- admin takes a doctor down, and this must not undo it.
--
-- Security definer, owned by the migration role, so the practitioner status
-- write passes sehat_guard_practitioner_claims (0077) as a Sehatsandhi action.
-- ============================================================================

create or replace function sehat_activate_business_doctors(p_business uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update practitioners p set status = 'active'
   where p.status = 'pending'
     and exists (select 1 from business_practitioners bp
                  where bp.practitioner_id = p.id and bp.business_id = p_business
                    and bp.status <> 'suspended');
  update business_practitioners set status = 'active'
   where business_id = p_business and status = 'pending';
end $$;

revoke all on function sehat_activate_business_doctors(uuid) from public, anon, authenticated;

create or replace function sehat_business_went_live()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    perform sehat_activate_business_doctors(new.id);
  end if;
  return new;
end $$;

drop trigger if exists businesses_doctors_go_live on businesses;
create trigger businesses_doctors_go_live
  after update of status on businesses
  for each row execute function sehat_business_went_live();

create or replace function sehat_affiliation_joins_live_business()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending'
     and exists (select 1 from businesses b where b.id = new.business_id and b.status = 'active') then
    new.status := 'active';
    update practitioners set status = 'active' where id = new.practitioner_id and status = 'pending';
  end if;
  return new;
end $$;

drop trigger if exists business_practitioners_join_live on business_practitioners;
create trigger business_practitioners_join_live
  before insert on business_practitioners
  for each row execute function sehat_affiliation_joins_live_business();

-- Everyone already stuck behind an active business.
do $$
declare r record;
begin
  for r in select id from businesses where status = 'active' loop
    perform sehat_activate_business_doctors(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
