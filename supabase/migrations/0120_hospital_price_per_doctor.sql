-- ============================================================================
-- Sehatsandhi — hospitals: the subscription covers one doctor, ₹1,000 each after
--
-- Run AFTER 0119. Safe to re-run.
--
-- Decided 25 Sep 2026, replacing 0119's "3 included, ₹500 each after": a
-- hospital pays the business price (₹2,000 a month to start, the same list as a
-- clinic) for its first doctor, and ₹1,000 a month for every doctor after that.
-- The WhatsApp add-on stays one fee per hospital — one number for the whole
-- business, however many doctors it has.
--
-- Admin can change both numbers in Billing → Prices by business type.
-- ============================================================================

update vertical_billing
   set included_doctors = 1, extra_doctor_price = 1000
 where vertical = 'hospital'
   and (included_doctors, extra_doctor_price) in ((3, 300), (3, 500), (0, 0));

notify pgrst, 'reload schema';
