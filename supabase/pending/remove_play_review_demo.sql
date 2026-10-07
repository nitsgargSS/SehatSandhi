-- READY, NOT APPLIED. Switches off the Google Play reviewer demo (0206) once a
-- Play review is over — or if the app is never submitted. To use it: copy it
-- to supabase/migrations/ as the next number (e.g. 0213_remove_play_review_demo.sql),
-- apply to staging, then prod as usual. Safe to run again.
--
-- What it does — switches off, deletes nothing:
--   • drops the guard: 9416479792 is an ordinary number again (it is a spare
--     SIM of ours; its patient record and the two demo visits stay, marked demo);
--   • the demo clinic → 'suspended' (it was never listed: 'pending'), its note
--     says why; the demo doctor's login is turned off (business_practitioners
--     suspended, can_login_web false); its booking hours removed.
-- After it: on prod, unset the review login secrets if they were set:
--   npx supabase@2.117.0 secrets unset REVIEW_PATIENT_PHONE REVIEW_PATIENT_CODE REVIEW_LOGIN_UNTIL --project-ref ctxkkqqtasegoowuqbmi
do $$
declare t text;
begin
  foreach t in array array['appointments', 'medicine_orders', 'ambulance_requests', 'insurance_leads', 'clinic_messages'] loop
    execute format('drop trigger if exists review_demo_guard on %I', t);
  end loop;
end $$;
drop function if exists sehat_review_demo_guard();

update businesses
   set status = 'suspended',
       verification_notes = 'PLAY STORE REVIEW DEMO (0206) — switched off (remove_play_review_demo). Not a real clinic; do not reactivate.'
 where lower(email) = 'nits.garg+playreview@gmail.com';

update business_practitioners bp
   set status = 'suspended', can_login_web = false
  from businesses b
 where b.id = bp.business_id and lower(b.email) = 'nits.garg+playreview@gmail.com';

delete from availability a
 using businesses b
 where b.id = a.business_id and lower(b.email) = 'nits.garg+playreview@gmail.com';
