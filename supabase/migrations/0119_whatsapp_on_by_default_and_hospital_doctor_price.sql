-- ============================================================================
-- Sehatsandhi — WhatsApp ticked by default; ₹500 per extra hospital doctor
--
-- Run AFTER 0118. Safe to re-run.
--
-- Decided 25 Sep 2026:
--
--   • The WhatsApp add-on is ticked by default, like autopay: at signup and on
--     the dashboard's Plan tab. A business unticks it to leave it out.
--     renewal_whatsapp becomes three-valued so the dashboard can tell "never
--     chose" (null → offered ticked) from "chose no" (false → stays unticked).
--     The renewal price still only includes WhatsApp for a business that chose
--     it (true); null is not a yes.
--   • Hospitals: each doctor after the 3 included is ₹500 a month (was ₹300).
--     Admin can change it in Billing → Prices by business type.
-- ============================================================================

alter table businesses alter column renewal_whatsapp drop not null;
alter table businesses alter column renewal_whatsapp set default null;

-- Nobody chose "no" before today: 0117 defaulted everyone to false. Only an
-- order placed since 0117 (it carries line_items) recorded a real choice.
update businesses b set renewal_whatsapp = null
 where renewal_whatsapp = false
   and not exists (select 1 from payments p where p.business_id = b.id and p.line_items is not null);

update vertical_billing set extra_doctor_price = 500
 where vertical = 'hospital' and extra_doctor_price = 300;

notify pgrst, 'reload schema';
