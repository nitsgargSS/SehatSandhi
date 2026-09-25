-- ============================================================================
-- Sehatsandhi — signup remembers the plan chosen, for paying later
--
-- Run AFTER 0117. Safe to re-run.
--
-- "Activate on WhatsApp" registers now and pays later from the dashboard. The
-- term and the WhatsApp add-on chosen at signup should be what the dashboard
-- offers when they log in (decided 25 Sep 2026), but registration runs with no
-- session, so the owner-only sehat_set_renewal_preference cannot be called.
--
-- This is the anonymous twin, as narrow as 0084's auto-renew one: only a
-- listing that is still pending, never paid, and under a day old. The worst a
-- stranger holding the id could do is pre-select a different term, which the
-- owner sees and can change before paying.
-- ============================================================================

create or replace function sehat_signup_set_plan_choice(
  p_business uuid, p_months integer, p_whatsapp boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_months not in (1, 6, 12) then raise exception 'Choose 1, 6 or 12 months.'; end if;
  update businesses b
     set renewal_term_months = p_months, renewal_whatsapp = coalesce(p_whatsapp, false)
   where b.id = p_business
     and b.status = 'pending'
     and b.created_at > now() - interval '1 day'
     and not exists (select 1 from payments p where p.business_id = b.id and p.status = 'paid');
end $$;

revoke all on function sehat_signup_set_plan_choice(uuid, integer, boolean) from public;
grant execute on function sehat_signup_set_plan_choice(uuid, integer, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
