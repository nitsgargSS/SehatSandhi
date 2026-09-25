-- ============================================================================
-- Sehatsandhi — WhatsApp add-on: 7 days' grace, then the tab locks
--
-- Run AFTER 0121. Safe to re-run.
--
-- From the WhatsApp marketing plan v3 (25 Sep 2026):
--
--   active  — the add-on's paid term has not ended          → normal access
--   grace   — ended, within grace_days (7)                  → normal access,
--             plus a banner naming the day it deactivates
--   locked  — past the grace period                         → the WhatsApp tab
--             shows only a renewal screen
--   none    — never bought                                  → the tab offers it
--
-- The end of the term is business_wa_accounts.next_billing_date, which
-- fulfilment sets to the paid term's end whenever the add-on is bought. A
-- subscription an admin set by hand with no date stays active until they end
-- it. Nothing is deleted or reset on a lock: wallet, opted-in patients and past
-- broadcasts are all there on renewal. Sending was already refused past the
-- grace period (0117's sehat_wa_broadcast_blocker); this adds the screen.
--
-- Also, per plan v3: the WhatsApp fee is priced per business type and term in
-- vertical_term_prices (0117), so 0116's two fee columns are dead. Dropped
-- rather than left to mislead.
-- ============================================================================

alter table whatsapp_marketing_settings drop column if exists monthly_subscription_paise;
alter table whatsapp_marketing_settings drop column if exists onboarding_fee_paise;
alter table whatsapp_marketing_settings drop column if exists onboarding_fee_label;

create or replace function sehat_wa_access(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a business_wa_accounts;
  v_grace integer;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_state text;
  v_locks date;
begin
  if not (sehat_caller_owns_business(p_business) or sehat_is_admin()) then
    raise exception 'not your business' using errcode = '42501';
  end if;
  select coalesce(grace_days, 7) into v_grace from whatsapp_marketing_settings where id;
  select * into a from business_wa_accounts where business_id = p_business;

  if a.business_id is null or a.subscription_status = 'inactive' then
    v_state := 'none';
  elsif a.next_billing_date is null or a.next_billing_date >= v_today then
    v_state := 'active';
  elsif a.next_billing_date + v_grace >= v_today then
    v_state := 'grace';
  else
    v_state := 'locked';
  end if;
  if a.next_billing_date is not null then v_locks := a.next_billing_date + v_grace + 1; end if;

  return jsonb_build_object(
    'state', v_state,
    'expires_on', a.next_billing_date,
    'locks_on', v_locks,
    'grace_days', v_grace);
end $$;

revoke all on function sehat_wa_access(uuid) from public, anon;
grant execute on function sehat_wa_access(uuid) to authenticated;

notify pgrst, 'reload schema';
