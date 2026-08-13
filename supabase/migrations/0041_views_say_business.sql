-- ============================================================================
-- Sehatsandhi — the views that renamed business_id back to doctor_id
--
-- Run AFTER 0040. Safe to re-run.
--
-- 0037 renamed the columns, and Postgres helpfully carried the views along by
-- rewriting their bodies to `business_id AS doctor_id`. So the tables tell the
-- truth and the views quietly undo it: every consumer still had to ask for
-- doctor_id, and a query written against the new name compiled fine and failed
-- at runtime with "column does not exist".
--
-- Found by listing view columns matching '%doctor%' rather than by reading the
-- migration, because the aliases were never written down anywhere — Postgres
-- generated them.
--
-- appointment_detail also gains practitioner_id: an appointment knows which
-- doctor it is with now, and the view a dashboard reads should say so.
-- ============================================================================

drop view if exists appointment_detail;
create view appointment_detail as
 select id,
    patient_phone,
    patient_name,
    patient_age,
    business_id,
    practitioner_id,
    slot_datetime,
    status,
    booked_via,
    confirmation_sent,
    reminder_sent,
    created_at,
    confirmed_at,
    completed_at,
    cancelled_at,
    cancelled_by,
    cancel_reason,
    previous_slot_datetime,
    rescheduled_at,
    rescheduled_by,
    reschedule_count,
    no_show_at,
    updated_at,
    last_actor,
    last_actor_detail,
    reschedule_count > 0 as was_rescheduled,
    (select count(*) from appointment_events e where e.appointment_id = a.id) as event_count,
    (select count(*) from appointments x
      where x.patient_phone = a.patient_phone and x.status = 'no_show') as patient_no_shows
   from appointments a;

drop view if exists appointment_outcomes;
create view appointment_outcomes as
 select business_id,
    count(*) as total,
    count(*) filter (where status = 'completed') as completed,
    count(*) filter (where status = 'no_show') as no_shows,
    count(*) filter (where status = 'cancelled' and cancelled_by = 'patient') as cancelled_by_patient,
    count(*) filter (where status = 'cancelled' and cancelled_by = 'clinic') as cancelled_by_clinic,
    count(*) filter (where reschedule_count > 0) as rescheduled
   from appointments
  group by business_id;

drop view if exists business_daily_stats;
create view business_daily_stats as
 select business_id,
    date_trunc('day', created_at)::date as day,
    count(*) filter (where event_type = 'doctor_impression') as times_listed,
    count(*) filter (where event_type = 'doctor_view') as profile_views,
    count(*) filter (where event_type = 'whatsapp_click') as whatsapp_clicks,
    count(*) filter (where event_type = 'call_click') as call_clicks,
    count(distinct session_id) as unique_visitors
   from site_events e
  where business_id is not null
  group by business_id, (date_trunc('day', created_at)::date);

drop view if exists free_camp_quota;
create view free_camp_quota as
 select business_id,
    date_trunc('quarter', date_from::timestamptz) as quarter,
    count(*) as camps_used
   from camps_offers
  where camp_type = 'free_camp' and status = any (array['approved','completed'])
  group by business_id, (date_trunc('quarter', date_from::timestamptz));

drop view if exists offer_quota;
create view offer_quota as
 select business_id,
    date_trunc('month', date_from::timestamptz) as month,
    count(*) as offers_used
   from camps_offers
  where camp_type = 'special_offer' and status = any (array['approved','completed'])
  group by business_id, (date_trunc('month', date_from::timestamptz));

-- Ratings are of the business — the place a patient was seen. A doctor's own
-- reputation across every place they work is a different question, and one
-- nobody has asked for yet; when they do, it groups this by practitioner
-- through the appointment.
drop view if exists rating_aggregate;
create view rating_aggregate as
 select business_id,
    round(avg(overall_rating), 1) as avg_rating,
    count(*) as total_reviews,
    count(*) filter (where created_at >= (now() - '90 days'::interval)) as reviews_last_90_days,
    round(avg(overall_rating) filter (where created_at >= (now() - '90 days'::interval)), 1) as avg_rating_last_90_days,
    avg(overall_rating) >= 4.5 and count(*) >= 10 as is_top_rated,
    max(created_at) as last_updated
   from ratings
  where is_visible = true
  group by business_id;

grant select on rating_aggregate to anon, authenticated;
grant select on appointment_detail, appointment_outcomes, business_daily_stats,
                free_camp_quota, offer_quota to authenticated;
