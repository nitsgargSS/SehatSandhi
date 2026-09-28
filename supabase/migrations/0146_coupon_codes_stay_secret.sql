-- ============================================================================
-- Sehatsandhi — a coupon code is secret unless it is on the banner
--
-- Independent of 0144/0145: safe to apply on its own, in any order after 0117.
-- Safe to re-run.
--
-- public_read_active_codes let anyone — the anon key included — list every
-- active coupon with its discount. A private code (a family code, a 99% code,
-- a code for one hospital) could be read straight off the REST API by anyone
-- who looked.
--
-- Nothing legitimate needs that. Checkout validates codes in the edge functions
-- (compute-price, razorpay-order → _shared/pricing.ts resolveCoupon), which use
-- the service key and do not pass through RLS. The one browser reader is
-- OfferBanner, and it asks only for show_on_banner codes — which are public by
-- choice. So the public may now see exactly those, and admins see all as before.
-- ============================================================================

drop policy if exists "public_read_active_codes" on discount_codes;
create policy "public_read_active_codes" on discount_codes
  for select using (
    show_on_banner = true
    and is_active = true
    and (valid_from is null or valid_from <= current_date)
    and (valid_until is null or valid_until >= current_date)
  );

notify pgrst, 'reload schema';
