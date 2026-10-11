-- ============================================================================
-- 0237 — A clinic needs no WhatsApp number of its own to broadcast
-- ============================================================================
-- AFTER 0236. Safe to re-run.
--
-- 0116 was built for each clinic having its own WhatsApp number, set up by
-- Sehatsandhi and marked 'live' before the clinic could send. Since 9 Oct 2026
-- every clinic sends from Sehatsandhi's one number for clinics, with its name
-- in the message — and no clinic's account is ever 'live'. The check that
-- waited for it ("Your WhatsApp number is not live yet") stopped every clinic.
-- Now only a clinic Sehatsandhi has marked 'suspended' is stopped; the plan,
-- the wallet and the terms decide the rest, as before.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sehat_wa_broadcast_blocker(p_business uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (select * from whatsapp_marketing_settings where id),
       a as (select * from business_wa_accounts where business_id = p_business)
  select case
    when not (select sending_enabled from s)
      then 'Sending starts once WhatsApp is connected. Nothing has been charged.'
    when not exists (select 1 from a) or (select subscription_status from a) = 'inactive'
      then 'Add WhatsApp to your plan to send broadcasts.'
    -- 0237: clinics send from Sehatsandhi's shared number, so there is no
    -- number of their own to be "live". Only a clinic we have suspended is stopped.
    when (select status from a) = 'suspended'
      then 'WhatsApp sending is suspended for this clinic. Please contact Sehatsandhi.'
    when (select subscription_status from a) = 'paused'
      then 'WhatsApp is paused for this clinic.'
    when (select next_billing_date from a) is not null
         and (select next_billing_date from a) + (select grace_days from s) < current_date
      then 'Your WhatsApp add-on has ended. Renew your plan with WhatsApp to send broadcasts.'
    when (select subscription_status from a) = 'past_due'
         and (select past_due_since from a) + make_interval(days => (select grace_days from s)) <= now()
      then 'Your WhatsApp fee is unpaid, so broadcasts are paused until it is paid.'
    when (select terms_accepted_at from a) is null
         or (select terms_version from a) is distinct from (select terms_version from s)
      then 'Read and accept the WhatsApp messaging terms to send broadcasts.'
    else null
  end;
$function$;

notify pgrst, 'reload schema';
