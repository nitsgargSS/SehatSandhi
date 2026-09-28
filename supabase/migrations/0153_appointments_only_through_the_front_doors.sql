-- ============================================================================
-- Sehatsandhi — appointments are made only through the booking functions
--
-- Run AFTER 0152. Safe to re-run.
--
-- allow_insert_appointments was `with check (true)`, and anon held INSERT: anyone
-- with the public key could write any row into appointments through the REST
-- API — any clinic, any doctor, any time, any status, bypassing slot capacity
-- checks that live in the booking functions, and filling a clinic's day with
-- fake patients.
--
-- Nothing legitimate uses it. Bookings arrive through SECURITY DEFINER
-- functions, which do not need the caller to hold INSERT:
--   bot_book_appointment / bot_book_at   the WhatsApp bot
--   sehat_desk_book (0152)                the clinic's desk
-- and service-role code (edge functions, scripts) bypasses RLS and grants.
-- Clinics keep UPDATE on their own bookings (clinic_updates_appointments).
-- ============================================================================

drop policy if exists "allow_insert_appointments" on appointments;
revoke insert on appointments from anon, authenticated;

notify pgrst, 'reload schema';
