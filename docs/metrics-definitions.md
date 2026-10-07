# Sehatsandhi — metric definitions

**Definition version 1** (migration `0209_business_metrics.sql`). Each metric below is computed by the SQL view named next to it; this document and the views must say the same thing. Changing a definition means changing both and bumping `definition_version` (snapshots already frozen keep the old version).

All months are **calendar months in Asia/Kolkata time**. Metrics use internal ids only — no names, phone numbers or health details. Admin tab: **Insights → Business metrics**.

## Who is a patient

One patient = one normalised mobile number (`patients.phone`, `91XXXXXXXXXX`). The same person on WhatsApp, the website and the app is one patient: bookings, app sign-ins (`patient_app_accounts`), WhatsApp contacts, medicine / ambulance / insurance requests and typed messages all resolve to `patients.id`. Anonymous website browsing and WhatsApp button searches are not linked to a person and count only in the funnel.

## Definitions

| Metric | Definition | View |
|---|---|---|
| **Monthly active patients (MAP)** | Unique patients with ≥ 1 of: a booking made, a typed message (WhatsApp or app), a day the app was opened, a medicine order, an ambulance request or an insurance request, in the month. Per district by where it happened; "all" counts each patient once. | `metric_map_monthly` (events: `metric_patient_events`) |
| **Bookings per month** | Appointments **created** in the month, split by status, vertical (doctor / lab / …) and channel (WhatsApp / app / website / desk). | `metric_bookings_monthly` |
| **Completed bookings** | Marked completed, **or** the booked time has passed without being cancelled or marked no-show. | `metric_bookings_monthly.completed` |
| **Active partners** | Live businesses (status *active*) with ≥ 1 booking or ≥ 1 profile view (`doctor_view`) in the month. | `metric_partners_monthly.active` |
| **Paying partners** | Businesses with a payment covering any day of the month (its period, or the month it was paid if it has none). | `metric_partners_monthly.paying` |
| **Revenue** | Money received, **excluding GST, net of refunds**, by month paid and purpose: Razorpay payments (`payments`, status paid), Razorpay wallet top-ups, and offline payments entered by an admin. | `metric_revenue_monthly` (ledger: `revenue_ledger`) |
| **MRR** | Subscription payments spread evenly over the months their period covers. | `metric_mrr_monthly` |
| **Repeat rate** | Of patients whose first (non-cancelled) booking was in the month, % with a second booking within 30 / 90 days. | `metric_repeat_cohorts` |
| **Cohort retention** | Patients whose first activity was in month M; for each later month, how many were active (MAP rules). | `metric_retention_cohorts` |
| **CAC** | Marketing spend for a channel in the month ÷ new patients whose first source maps to that channel in the month (patients from clinics' imported registers excluded). | `metric_cac_monthly` |
| **Partner retention** | Subscription plans whose last covered day fell in the month (and has passed); renewed = a later subscription paid no more than 30 days after that day. Razorpay's `term_end` is the first day *not* covered, so its last day is the day before. | `metric_partner_renewals` (0214) |
| **Conversion funnel** | Searches (WhatsApp searches + website searches + typed messages) → results shown (WhatsApp searches with results + website searches + typed messages understood) → profile views (website profile views / WhatsApp clicks) → booked → completed. | `metric_funnel_monthly` |
| **Time to launch a district** | `first_booking_at − onboarding_started_at` (days). | `metric_districts` |
| **Unmet demand** | Searches that found nobody for that speciality / service in that area (`unmet_demand_log`). | `metric_impact_monthly.unmet_searches` |
| **Unmet demand served** | Known patients (by phone) whose search found nobody in a district in the month — typed WhatsApp messages, the app's Find, the website's booking page — and how many booked there (not cancelled) within 90 days; for a doctor's speciality, a doctor of that speciality. | `metric_unmet_served` (0214) |
| **Source per booking** | An online booking (WhatsApp, app, website) takes the patient's latest known source (`patients.last_source_*`) when it is under 30 days old, else *direct*; desk bookings are *clinic desk*. Bookings before 0214: *unknown*. | `metric_booking_sources` (0214) |
| **Bookings by speciality** | By the booked doctor's speciality; lab bookings *lab*; *not recorded* when no doctor was named. | `metric_bookings_by_speciality` (0214) |
| **Where partners came from** | A business's first source: *field sales* when its phone or email matches a doctor lead; the website campaign its owner arrived from (first day of registration only); else *unknown*. By month registered. | `metric_partner_sources` (0214) |
| **Coupons** | Payments with a coupon (Razorpay's, or entered with an offline payment): count, discount given, revenue ex-GST. | `metric_coupons_monthly` (0214) |
| **Time / money saved** | One optional answer given with a rating — time and money / time / money / no difference. Answers only, nothing medical. | `metric_impact_monthly.saved_*` (0214) |
| **Voice notes** | Typed-message log rows marked voice (`free_text_log.input_kind`); 0 until voice notes reach the bot. | `metric_impact_monthly.voice_messages` (0214) |

## Where a patient came from

`patients.first_source_type` is set **once**, at the first interaction, and never overwritten (except that *unknown* may be replaced by a known source): `meta_ctwa_ad`, `instagram_reel`, `website_organic`, `google`, `sms_campaign`, `doctor_referral`, `patient_referral`, `qr_poster`, `camp`, `direct`, `clinic_register` (imported from a clinic's register — not marketing), `other`, `unknown`. With it: `first_source_detail` (ad / campaign / UTM / referring doctor / QR / camp), `first_channel` (whatsapp / website / app / clinic), `first_pincode`, `first_seen_at`. Each booking also keeps its own `campaign_code`.

Channel mapping for CAC: Meta ads ← `meta_ctwa_ad`, `instagram_reel`; Google ads ← `google`; SMS ← `sms_campaign`; print ← `qr_poster`; camp ← `camp`; everything else → other.

## Impact (access)

Per month (`metric_impact_monthly`): bookings at **rural vs urban** service areas (`service_areas.area_type`), medicine orders, ambulance requests with **median minutes to acceptance and to pick-up**, insurance requests, unmet searches, typed messages and how many were in Hindi (Devanagari). No medical details in any metric.

## Frozen history

`sehat_metrics_snapshot()` runs nightly and, the first time it runs in a new month, freezes last month's headline numbers into `metrics_monthly_snapshot` (month, district, metric_key, value, definition_version). Frozen rows are never edited — not even by admins. If a definition changes, bump the version and recompute into new rows; the old ones stay.

## Districts (0214)

A business registering in a district we do not have adds it by itself (status *onboarding*, onboarding started that day). The district is India Post's for the business's PIN, else what it typed. The first business there going live sets `first_partner_live_at` (status *live*); the first booking sets `first_booking_at`. Dates already entered by an admin are never changed. Still definition version 1: 0214 added metrics, it changed none.
